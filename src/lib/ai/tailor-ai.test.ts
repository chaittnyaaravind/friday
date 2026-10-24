/**
 * The AI tailoring pass end to end, with only the model call faked: real fact guard, real lint, real signing, real
 * validation. What it must do: rewrite toward job terms the evidence supports, keep only rewrites that add nothing and
 * read clean, sign what it keeps, and leave every other line exactly as the student wrote it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildResume } from "@/lib/resume/generate";
import type { CandidateItem, ResumeDoc, Section } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

vi.mock("server-only", () => ({}));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), isAiConfigured: () => true }));
const model = vi.hoisted(() => ({ bullets: new Map<string, string[]>(), summary: [] as string[] }));
vi.mock("./tasks", () => ({
  structured: vi.fn(async ({ system, user }: { system: string; user: string }) => {
    if (system.includes("professional summary")) return { suggestions: model.summary.map((text) => ({ text })), missingEvidence: [] };
    const bullet = /<bullet>([\s\S]*?)<\/bullet>/.exec(user)?.[1] ?? "";
    return { suggestions: (model.bullets.get(bullet) ?? []).map((text) => ({ text })), missingEvidence: [] };
  }),
}));
process.env.AI_SIGNING_SECRET = "test-signing-secret-0123456789";
const { aiTailor, chooseLines } = await import("./tailor-ai");
const { verifyAiText } = await import("./sign");
const { _clearAiCache } = await import("./resume");

let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
} as CandidateItem);
const ITEMS = [
  item("personal", { field: "name", value: "Sam Student" }),
  item("education", { school: "San José State University", degree: "B.A. Communication Studies", start: "Aug 2024", end: "May 2028", gpa: null, details: [] }),
  item("experience", { title: "Front Desk Volunteer", organization: "Santa Clara County Library", location: "San Jose, CA", start: "Jun 2025", end: "Present", bullets: [
    "Greeted visitors and answered questions at the front desk",
    "Helped with the library's customer service email inbox",
    "Shelved returned books",
  ] }),
  item("skill", { name: "Microsoft Office", group: "Software" }),
];
const at = (doc: ResumeDoc, text: string) => doc.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets)).find((b) => b.text.startsWith(text));

beforeEach(() => {
  _clearAiCache();
  model.bullets.clear();
  model.summary = [];
});

describe("chooseLines", () => {
  it("targets lines whose own evidence supports a job term they don't yet say, and weak openings; never 'user' lines", () => {
    const doc = buildResume(ITEMS);
    const picks = chooseLines(doc, ["customer service", "Kubernetes"], new Map(ITEMS.map((i) => [i.id, i])), 6);
    // "customer service" is in a sibling bullet of the same entry, so the first bullet may be rewritten toward it;
    // Kubernetes appears nowhere in the evidence, so it is never a target.
    expect(picks.map((p) => p.before)).toContain("Greeted visitors and answered questions at the front desk");
    expect(picks.every((p) => !p.keywords.includes("Kubernetes") || p.op === "improve")).toBe(true);
    expect(picks.find((p) => p.before.startsWith("Helped with"))?.op).toBe("improve"); // weak opening, keyword already said
  });
});

describe("aiTailor", () => {
  it("keeps a clean rewrite that adds nothing, signs it, and the document still verifies", async () => {
    const doc = buildResume(ITEMS);
    model.bullets.set("Greeted visitors and answered questions at the front desk", ["Greeted visitors and answered questions at the front desk as part of the library's customer service"]);
    model.summary = ["Communication Studies student at San José State University who greets visitors and answers questions at a library front desk"];
    const r = await aiTailor(doc, { userId: "u1", keywords: ["customer service"], items: ITEMS });
    const line = at(r.doc, "Greeted visitors")!;
    expect(line.text).toContain("customer service");
    expect(line.origin).toBe("ai");
    expect(verifyAiText("u1", line.text, line.ai!.basis, line.ai!.sig)).toBe(true);
    expect(r.doc.sections[0].kind).toBe("summary");
    expect(r.changes.map((c) => c.where)).toEqual(["Summary", expect.stringContaining("Front Desk Volunteer")]);
    expect(validateDoc(r.doc, ITEMS).ok).toBe(true);
  });

  it("drops a rewrite that invents a number, a scope claim or a tool, and one that reads AI-written", async () => {
    const doc = buildResume(ITEMS);
    model.bullets.set("Greeted visitors and answered questions at the front desk", [
      "Greeted 200+ visitors daily at the front desk",            // number not in the evidence → rejected by the guard
      "Led the front desk team answering visitor questions",       // scope upgrade → needs confirmation, never auto-applied
      "Utilized Zendesk to answer visitor questions at the front desk", // tool not in the evidence → rejected
      "Greeted visitors at the front desk, ensuring seamless customer service", // AI tells → dropped by the lint
    ]);
    model.bullets.set("Helped with the library's customer service email inbox", ["Answered the library's customer service email inbox"]);
    const r = await aiTailor(doc, { userId: "u1", keywords: ["customer service"], items: ITEMS });
    expect(at(r.doc, "Greeted visitors")!.text).toBe("Greeted visitors and answered questions at the front desk");
    expect(at(r.doc, "Greeted visitors")!.origin).toBe("profile");
    expect(at(r.doc, "Answered the library")?.origin).toBe("ai"); // the clean one still applies
    expect(r.changes).toHaveLength(1);
    expect(validateDoc(r.doc, ITEMS).ok).toBe(true);
  });

  it("with nothing usable, returns the document unchanged and says why", async () => {
    const doc = buildResume(ITEMS);
    const r = await aiTailor(doc, { userId: "u1", keywords: ["customer service"], items: ITEMS });
    expect(r.doc).toEqual(doc);
    expect(r.note).toMatch(/fact check/);
  });
});

describe("editor: humanize and human-first ordering", () => {
  it("of two equally safe rewrites, the one without AI tells is offered first", async () => {
    const { generateResumeEdit } = await import("./resume");
    const doc = buildResume(ITEMS);
    const ref = doc.sections.flatMap((s) => s.entries.map((e) => ({ s, e }))).map(({ s, e }) => ({ sectionId: s.id, entryId: e.id, lineId: e.bullets[0]?.id })).find((r) => r.lineId)!;
    const { lineContext, basisOf } = await import("@/lib/resume/edits");
    const ctx = lineContext(doc, ref as never)!;
    model.bullets.set(ctx.text, ["Greeted visitors at the front desk, ensuring a seamless experience", "Greeted visitors and answered their questions at the front desk"]);
    const p = await generateResumeEdit({ op: "humanize", target: { kind: "line", ...(ref as { sectionId: string; entryId: string; lineId: string }) }, ctx, evidence: basisOf(ctx) });
    expect(p.suggestions[0].text).toBe("Greeted visitors and answered their questions at the front desk");
  });
});

describe("pickRewrite", () => {
  const base = { id: "p", op: "ats" as const, target: { kind: "summary" as const }, original: "x", basis: "Helped students debug code", missingEvidence: [], rejected: [], via: "ai" as const };
  const sug = (text: string, riskLevel: "none" | "medium" = "none") => ({ id: text, text, reason: "", newFacts: [], requiresUserConfirmation: riskLevel !== "none", requiresConfirmation: riskLevel !== "none", newClaims: [], riskLevel, evidence: [] });
  it("prefers a clean, safe option that uses a target term", async () => {
    const { pickRewrite } = await import("./tailor-ai");
    const p = { ...base, suggestions: [sug("Assisted students with debugging code"), sug("Provided technical support to students debugging code")] };
    expect(pickRewrite(p, "bullet", ["technical support"])).toBe("Provided technical support to students debugging code");
    expect(pickRewrite(p, "bullet")).toBe("Assisted students with debugging code");
  });
  it("never picks a risky or AI-sounding option, even if it uses the term", async () => {
    const { pickRewrite } = await import("./tailor-ai");
    const p = { ...base, suggestions: [sug("Led technical support for students", "medium"), sug("Utilized technical support skills to help students"), sug("Helped students debug code in lab")] };
    expect(pickRewrite(p, "bullet", ["technical support"])).toBe("Helped students debug code in lab");
  });
});
