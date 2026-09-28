/** The application packet. What is proven: the approval is bound to exact content, blockers stop it, nothing is invented, and nothing here submits. */
import { describe, expect, it } from "vitest";
import { buildResume } from "@/lib/resume/generate";
import type { CandidateItem, Section } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import {
  approvalState, assessPacket, buildPacket, canHandOff, confirmationsNeeded, documentsAsked, packetHash, readiness, validateApproval,
  type Packet, type PacketInput, type PacketProfile,
} from "./packet";
import { submissionPolicy } from "./policy";

const NOW = Date.parse("2026-09-27T20:00:00Z"); // 2026-09-27 in Pacific time

let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `it-${++n}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const ITEMS: CandidateItem[] = [
  item("personal", { field: "name", value: "Sam Student" }),
  item("experience", { title: "Library Assistant", organization: "SJSU Library", location: "San Jose, CA", start: "Jan 2026", end: "May 2026", bullets: ["Helped students find sources"] }),
  item("skill", { name: "Python", group: "Languages" }),
];
const doc = buildResume(ITEMS);
const PROFILE: PacketProfile = {
  name: "Sam Student", email: "sam@example.edu", phone: null, location: "San Jose, CA", university: "San José State University", major: "Computer Science", graduationYear: 2027, gpa: 3.6,
  workAuthorization: "f1", availability: null, github: null, linkedin: null, portfolio: null,
};
const input = (over: Partial<PacketInput> = {}): PacketInput => ({
  job: { id: "job-1", title: "Student Assistant", company: "SJSU Library", status: "active", deadline: "2026-10-15", applyUrl: "https://example.edu/apply/1", source: "sjsu_page", official: true },
  description: "Help students at the desk.",
  profile: PROFILE,
  resume: { versionId: "v-1", label: "Resume — SJSU Library", kind: "tailored", doc, verified: validateDoc(doc, ITEMS) },
  coverLetter: null,
  eligibility: { verdict: "clear", headline: "No blockers found", checks: [], disclaimer: "" },
  extra: [],
  builtAt: "2026-09-27T20:00:00Z",
  ...over,
});
const packet = (over: Partial<PacketInput> = {}) => buildPacket(input(over));
const codes = (p: Packet, sev?: string) => assessPacket(p, NOW).filter((i) => !sev || i.severity === sev).map((i) => i.code);

describe("buildPacket — nothing is invented", () => {
  it("copies profile answers as they are and marks anything absent as MISSING, never filled in", () => {
    const p = packet();
    const get = (k: string) => p.answers.find((a) => a.key === k)!;
    expect(get("name")).toMatchObject({ value: "Sam Student", source: "profile" });
    expect(get("graduation").value).toBe("2027");
    expect(get("gpa").value).toBe("3.60");
    expect(get("work_authorization").value).toBe("F-1 student visa");
    expect(get("phone")).toEqual({ key: "phone", label: "Phone", value: null, source: "missing" });
    expect(get("github").source).toBe("missing");
  });
  it("blank or whitespace-only values count as missing", () => {
    const p = packet({ profile: { ...PROFILE, phone: "   ", major: "" } });
    expect(p.answers.find((a) => a.key === "phone")?.source).toBe("missing");
    expect(p.answers.find((a) => a.key === "major")?.source).toBe("missing");
  });
  it("carries the resume as the exact text the student would send, and which version it is", () => {
    const p = packet();
    expect(p.resume).toMatchObject({ versionId: "v-1", label: "Resume — SJSU Library" });
    expect(p.resume!.text).toContain("Helped students find sources");
  });
  it("has no cover letter unless the student has one — it never writes one itself", () => {
    expect(packet().coverLetter).toBeNull();
    expect(packet({ coverLetter: { text: "  Dear team,  ", origin: "student" } }).coverLetter).toEqual({ text: "Dear team,", origin: "student" });
    expect(packet({ coverLetter: { text: "   ", origin: "student" } }).coverLetter).toBeNull();
  });
});

describe("documentsAsked — what the POSTING says", () => {
  it("finds a required cover letter and marks it missing until one exists", () => {
    const d = documentsAsked("Applicants must submit a resume and cover letter.", false);
    expect(d).toEqual([expect.objectContaining({ kind: "cover_letter", required: true, state: "missing" })]);
    expect(documentsAsked("Applicants must submit a resume and cover letter.", true)[0].state).toBe("in_packet");
  });
  it("finds documents FRIDAY cannot prepare and says the student provides them", () => {
    const d = documentsAsked("Please attach an unofficial transcript and two references.", false);
    expect(d.map((x) => x.kind)).toEqual(["transcript", "references"]);
    expect(d.every((x) => x.state === "you_provide" && x.required)).toBe(true);
  });
  it("a passing mention is not marked required", () => {
    expect(documentsAsked("Our team keeps a portfolio of open-source tools.", false)[0]).toMatchObject({ kind: "portfolio", required: false });
  });
  it("finds nothing when the posting asks for nothing", () => {
    expect(documentsAsked("Help students at the desk.", false)).toEqual([]);
    expect(documentsAsked(null, false)).toEqual([]);
  });
});

describe("packetHash — the approval is bound to exact content", () => {
  const base = packet();
  it("is stable, and ignores build time, eligibility notes and posting hints", () => {
    expect(packetHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(packetHash(packet({ builtAt: "2030-01-01T00:00:00Z" }))).toBe(packetHash(base));
    expect(packetHash(packet({ eligibility: null }))).toBe(packetHash(base));
    expect(packetHash(packet({ description: "Applicants must submit a cover letter." }))).toBe(packetHash(base));
  });
  it("changes when ANY part of what would be sent changes", () => {
    const h = packetHash(base);
    expect(packetHash(packet({ coverLetter: { text: "Hello", origin: "student" } }))).not.toBe(h);
    expect(packetHash(packet({ profile: { ...PROFILE, phone: "408-555-0100" } }))).not.toBe(h);
    expect(packetHash(packet({ extra: [{ question: "Why us?", answer: "Because." }] }))).not.toBe(h);
    expect(packetHash(packet({ job: { ...input().job, applyUrl: "https://example.edu/apply/2" } }))).not.toBe(h);
    expect(packetHash(packet({ resume: { ...input().resume!, versionId: "v-2" } }))).not.toBe(h);
    const edited = JSON.parse(JSON.stringify(doc));
    edited.sections.find((s: { kind: string }) => s.kind === "experience").entries[0].bullets[0].text = "Helped students find sources and books";
    expect(packetHash(packet({ resume: { ...input().resume!, doc: edited } }))).not.toBe(h);
  });
  it("is independent of key order", () => {
    const reordered = { ...base, job: Object.fromEntries(Object.entries(base.job).reverse()) } as Packet;
    expect(packetHash(reordered)).toBe(packetHash(base));
  });
});

describe("assessPacket — blockers", () => {
  it("a complete, open packet has no blockers and no confirmations, only the policy note", () => {
    const p = packet();
    expect(codes(p, "block")).toEqual([]);
    expect(codes(p, "confirm")).toEqual([]);
    expect(codes(p, "info")).toEqual(["source_policy"]);
    expect(readiness(assessPacket(p, NOW), [])).toBe("ready_for_approval");
  });
  it("blocks a closed, archived or non-active job", () => {
    for (const status of ["closed", "archived", "draft"]) expect(codes(packet({ job: { ...input().job, status } }), "block")).toContain("job_not_open");
  });
  it("blocks after the deadline — and not ON the deadline day (Pacific dates)", () => {
    expect(codes(packet({ job: { ...input().job, deadline: "2026-09-26" } }), "block")).toContain("deadline_passed");
    expect(codes(packet({ job: { ...input().job, deadline: "2026-09-27" } }), "block")).not.toContain("deadline_passed");
    expect(codes(packet({ job: { ...input().job, deadline: null } }), "block")).not.toContain("deadline_passed");
  });
  it("blocks with no apply link and with no resume", () => {
    expect(codes(packet({ job: { ...input().job, applyUrl: null } }), "block")).toContain("no_apply_url");
    expect(codes(packet({ resume: null }), "block")).toContain("missing_resume");
  });
  it("blocks a resume that has claims without evidence, and says how many", () => {
    const bad = { ...input().resume!, verified: { ok: false, issues: [{ where: "x", text: "t", claim: "Rust", reason: "no evidence" }] } };
    const p = packet({ resume: bad });
    expect(codes(p, "block")).toContain("resume_unverified");
    expect(assessPacket(p, NOW).find((i) => i.code === "resume_unverified")!.message).toMatch(/^1 line on this resume has no supporting evidence/);
  });
  it("blocks when the name or email is missing — it will not guess them", () => {
    expect(codes(packet({ profile: { ...PROFILE, email: null } }), "block")).toContain("missing_email");
    expect(codes(packet({ profile: { ...PROFILE, name: null } }), "block")).toContain("missing_name");
  });
  it("blocks while a reported question has no answer, and clears once the STUDENT answers it", () => {
    const q = { question: "Describe a time you led a team." };
    expect(codes(packet({ extra: [{ ...q, answer: null }] }), "block")).toContain("unexpected_question");
    expect(codes(packet({ extra: [{ ...q, answer: "  " }] }), "block")).toContain("unexpected_question");
    expect(codes(packet({ extra: [{ ...q, answer: "I led the desk rota." }] }), "block")).not.toContain("unexpected_question");
  });
  it("blocks when the posting requires a cover letter and there is none", () => {
    const description = "You must include a cover letter with your application.";
    expect(codes(packet({ description }), "block")).toContain("cover_letter_missing");
    expect(codes(packet({ description, coverLetter: { text: "Dear team", origin: "student" } }), "block")).not.toContain("cover_letter_missing");
  });
  it("a document only the student can supply is information, not a blocker", () => {
    const p = packet({ description: "You must submit an unofficial transcript." });
    expect(codes(p, "block")).toEqual([]);
    expect(codes(p, "info")).toContain("you_provide_transcript");
  });
});

describe("assessPacket — confirmations the student must tick", () => {
  it("asks for a tick on eligibility 'verify' and 'blocked' verdicts, using the verdict's own headline", () => {
    const verify = packet({ eligibility: { verdict: "verify", headline: "Verify before applying", checks: [], disclaimer: "" } });
    const blocked = packet({ eligibility: { verdict: "blocked", headline: "Likely blocked: U.S. citizenship required", checks: [], disclaimer: "" } });
    expect(codes(verify, "confirm")).toEqual(["eligibility_verify"]);
    expect(codes(blocked, "confirm")).toEqual(["eligibility_blocked"]);
    expect(codes(blocked, "block")).toEqual([]);
  });
  it("asks for a tick when work authorization is not on the profile", () => {
    expect(codes(packet({ profile: { ...PROFILE, workAuthorization: null } }), "confirm")).toEqual(["authorization_unclear"]);
  });
  it("asks for a tick on an AI-drafted cover letter, but not a student-written one", () => {
    expect(codes(packet({ coverLetter: { text: "Dear team", origin: "ai_draft" } }), "confirm")).toEqual(["ai_cover_letter"]);
    expect(codes(packet({ coverLetter: { text: "Dear team", origin: "student" } }), "confirm")).toEqual([]);
  });
  it("readiness follows the ticks, and a blocker beats any tick", () => {
    const p = packet({ profile: { ...PROFILE, workAuthorization: null } });
    const issues = assessPacket(p, NOW);
    expect(readiness(issues, [])).toBe("needs_confirmation");
    expect(readiness(issues, ["authorization_unclear"])).toBe("ready_for_approval");
    expect(readiness(assessPacket(packet({ profile: { ...PROFILE, workAuthorization: null }, resume: null }), NOW), ["authorization_unclear"])).toBe("blocked");
    expect(confirmationsNeeded(issues)).toEqual(["authorization_unclear"]);
  });
});

describe("approval and hand-off", () => {
  const p = packet();
  const approval = { contentHash: packetHash(p), acknowledged: [], approvedAt: "2026-09-27T20:05:00Z" };

  it("validateApproval accepts the exact hash of a ready packet", () => {
    expect(validateApproval(p, packetHash(p), [], NOW)).toEqual({ ok: true, contentHash: packetHash(p) });
  });
  it("refuses a hash that is not the stored content's — the client is never trusted", () => {
    expect(validateApproval(p, "0".repeat(64), [], NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/not what is now saved/) });
  });
  it("refuses while a blocker stands, and while a confirmation is unticked", () => {
    const noResume = packet({ resume: null });
    expect(validateApproval(noResume, packetHash(noResume), [], NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/Choose the resume/) });
    const auth = packet({ profile: { ...PROFILE, workAuthorization: null } });
    expect(validateApproval(auth, packetHash(auth), [], NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/Tick each confirmation/) });
    expect(validateApproval(auth, packetHash(auth), ["authorization_unclear"], NOW).ok).toBe(true);
  });
  it("an approval is valid only for the content it was given for — after ANY change it is stale", () => {
    expect(approvalState(p, approval)).toEqual({ state: "approved", approvedAt: "2026-09-27T20:05:00Z" });
    const changed = packet({ coverLetter: { text: "Added afterwards", origin: "student" } });
    expect(approvalState(changed, approval)).toMatchObject({ state: "stale" });
    expect(approvalState(p, null)).toEqual({ state: "none" });
  });
  it("hand-off needs an approval that matches", () => {
    expect(canHandOff(p, null, NOW)).toEqual({ ok: false, reason: "Approve the packet first." });
    expect(canHandOff(packet({ coverLetter: { text: "New", origin: "student" } }), approval, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/changed after you approved/) });
    expect(canHandOff(p, approval, NOW)).toEqual({ ok: true });
  });
  it("hand-off RE-CHECKS at the moment of the click: an approved packet for a job that has since closed, or passed its deadline, is refused", () => {
    const closed = { ...p, job: { ...p.job, status: "closed" } };
    expect(canHandOff(closed, { ...approval, contentHash: packetHash(closed) }, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/no longer listed as open/) });
    expect(canHandOff(p, approval, Date.parse("2026-10-16T19:00:00Z"))).toMatchObject({ ok: false, reason: expect.stringMatching(/deadline .*has passed/) });
  });
});

describe("submission policy — FRIDAY never submits", () => {
  it("is assisted-only for every source, and says it has not been verified that any source allows automation", () => {
    for (const s of [null, "greenhouse", "lever", "workday", "sjsu_page", "handshake_import", "adzuna"]) {
      const pol = submissionPolicy(s);
      expect(pol).toMatchObject({ mode: "assisted_only", automated: false });
      expect(pol.reason).toMatch(/does not submit applications/);
      expect(pol.reason).toMatch(/not been checked/);
    }
  });
  it("the packet module offers no way to submit: no network call and no submit function", async () => {
    const mod = await import("./packet");
    expect(Object.keys(mod).filter((k) => /submit|send|post|fetch/i.test(k))).toEqual([]);
    const src = (await import("node:fs")).readFileSync(new URL("./packet.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|puppeteer|playwright/i);
  });
});
