import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { beforeAll, describe, expect, it } from "vitest";
import { renderDocx, renderPdf } from "./export";
import { extractResumeText } from "./extract";
import { buildResume, docToText } from "./generate";
import { parseResumeText } from "./parse";
import { buildTailored, tailorProposal, type TailorJob } from "./tailor";
import type { CandidateItem, ParsedFact, ResumeDoc, Section } from "./types";
import { claimsIn, unsupportedClaims, validateDoc } from "./validate";

const toItems = (facts: ParsedFact[]): CandidateItem[] =>
  facts.map((f, i) => ({
    id: `item-${i}`, section: f.section, position: i, data: f.data as never, source: "uploaded_resume", source_text: f.sourceText,
    source_resume_id: "r1", status: f.status, note: f.note ?? null, created_at: "", updated_at: "",
  }));
const userItem = (section: Section, data: unknown): CandidateItem => ({
  id: `user-${section}`, section, position: 99, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_added", note: null, created_at: "", updated_at: "",
});
const skillNames = (doc: ResumeDoc) => doc.sections.filter((s) => s.kind === "skills").flatMap((s) => s.lines.flatMap((l) => l.text.replace(/^[^:]*:\s*/, "").split(/,\s*/)));

let pdfBytes: Uint8Array;
let pdfText: string;
let docxText: string;
let items: CandidateItem[];

beforeAll(async () => {
  pdfBytes = new Uint8Array(readFileSync("test/fixtures/sample-resume.pdf"));
  pdfText = await extractResumeText(pdfBytes, "pdf");
  docxText = await extractResumeText(new Uint8Array(readFileSync("test/fixtures/sample-resume.docx")), "docx");
  items = toItems(parseResumeText(pdfText).facts);
});

const job: TailorJob = {
  id: "job-1",
  title: "Software Engineering Intern",
  company: "Example Co",
  description: "Minimum qualifications\n• Python\n• React\n• AWS\nYou will build services with Python and React on AWS. Data Structures knowledge helps.",
  requirements: ["Python", "React", "AWS"],
};

describe("parser (local, no AI)", () => {
  it("1. a skill the resume states explicitly appears in the profile and the resume", () => {
    const java = items.find((i) => i.section === "skill" && (i.data as { name: string }).name === "Java");
    expect(java?.status).toBe("explicit");
    expect(java?.source_text).toBe("Languages: Java, Python, JavaScript, TypeScript, SQL");
    expect(skillNames(buildResume(items))).toContain("Java");
  });

  it("2. a skill the resume never mentions never appears", () => {
    const noReact = parseResumeText("Sam Park\nsam@example.com\nSKILLS\nJava, Python, SQL\nEXPERIENCE\nTutor, SJSU Learning Center  Jan 2025 – Present\n• Tutored students in Java").facts;
    expect(JSON.stringify(noReact).toLowerCase()).not.toContain("react");
    expect(skillNames(buildResume(toItems(noReact)))).not.toContain("React");
  });

  it("6. an unrecognized section goes to Uncategorized, needs confirmation, and stays out of the resume", () => {
    const hobbies = items.filter((i) => i.section === "other");
    expect(hobbies.map((h) => (h.data as { text: string }).text)).toContain("Rock climbing, film photography");
    expect(hobbies.every((h) => h.status === "requires_confirmation")).toBe(true);
    expect(docToText(buildResume(items))).not.toContain("Rock climbing");
  });

  it("technologies only mentioned in bullets need confirmation instead of becoming skills", () => {
    const jest = items.find((i) => i.section === "skill" && (i.data as { name: string }).name === "Jest");
    expect(jest?.status).toBe("requires_confirmation");
    expect(skillNames(buildResume(items))).not.toContain("Jest");
  });

  it("parses PDF and DOCX of the same resume to the same facts", () => {
    const strip = (fs: ParsedFact[]) => fs.map((f) => `${f.section}|${JSON.stringify(f.data)}|${f.status}`).sort();
    expect(strip(parseResumeText(docxText).facts)).toEqual(strip(parseResumeText(pdfText).facts));
  });

  it("extracts contact, education, experience and projects exactly", () => {
    const get = (s: Section) => items.filter((i) => i.section === s).map((i) => i.data);
    expect(get("personal")).toEqual(expect.arrayContaining([{ field: "name", value: "Jordan Lee" }, { field: "email", value: "jordan.lee@example.com" }]));
    expect(get("education")[0]).toMatchObject({ school: "San José State University", degree: "B.S. Computer Science", gpa: "3.62", start: "Aug 2023", end: "May 2027" });
    expect(get("experience")).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Software Engineering Intern", organization: "Bright Harbor Labs", start: "Jun 2025", end: "Aug 2025" })]));
    expect(get("project")[0]).toMatchObject({ name: "CampusEats", technologies: ["React", "Node.js", "PostgreSQL", "Docker"], link: null });
  });

  it("8. parsing never modifies the original uploaded bytes", async () => {
    const before = createHash("sha256").update(pdfBytes).digest("hex");
    await extractResumeText(pdfBytes, "pdf");
    expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(before);
    expect(createHash("sha256").update(readFileSync("test/fixtures/sample-resume.pdf")).digest("hex")).toBe(before);
  });
});

describe("tailoring", () => {
  it("3. a job requirement is never added to the user's skills", () => {
    const p = tailorProposal(items, job);
    expect(p.skills.find((s) => s.name === "AWS")?.status).toBe("not_in_profile");
    expect(p.changes.needsConfirmation.join(" ")).toContain("AWS is required — it's mentioned in your Certifications, but isn't a confirmed skill");
    const doc = buildTailored(items, p, []);
    expect(skillNames(doc)).not.toContain("AWS");
    expect(p.skills.find((s) => s.name === "Python")?.status).toBe("confirmed");
  });

  it("4. a skill the user adds manually can appear", () => {
    const withAws = [...items, userItem("skill", { name: "AWS", group: null })];
    expect(skillNames(buildResume(withAws))).toContain("AWS");
    expect(tailorProposal(withAws, job).skills.find((s) => s.name === "AWS")?.status).toBe("confirmed");
  });

  it("10. a tailored resume changes order and wording only — never factual claims", () => {
    const base = buildResume(items);
    const tailored = buildTailored(items, tailorProposal(items, job), []);
    const claims = (d: ResumeDoc) => new Set(claimsIn(docToText(d)).map((c) => c.toLowerCase()));
    expect([...claims(tailored)].every((c) => claims(base).has(c))).toBe(true);
    expect(docToText(tailored).split("\n").map((l) => l.replace(/^([^:]*:\s*)(.*)$/, (_, a, b) => a + b.split(", ").sort().join(", "))).sort())
      .toEqual(docToText(base).split("\n").map((l) => l.replace(/^([^:]*:\s*)(.*)$/, (_, a, b) => a + b.split(", ").sort().join(", "))).sort());
    expect(skillNames(tailored)[0]).toBe("Python"); // matched skill moved to the front
    expect(validateDoc(tailored, items).ok).toBe(true);
  });
});

describe("truth layer", () => {
  it("5. an invented metric is rejected", () => {
    const doc = buildResume(items);
    const exp = doc.sections.find((s) => s.kind === "experience")!.entries[0];
    exp.bullets.push({ id: "x", text: "Reduced API latency by 40% for 1,000 users", origin: "ai", sourceItemId: exp.sourceItemId });
    const r = validateDoc(doc, items);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.claim)).toEqual(expect.arrayContaining(["40%", "1000"]));
    expect(unsupportedClaims("Improved performance by 30%", "Created a Java project for class.")).toEqual(["30%"]);
  });

  it("an invented technology in generated text is rejected; the user's own text is allowed", () => {
    const doc = buildResume(items);
    const proj = doc.sections.find((s) => s.kind === "projects")!.entries[1];
    proj.bullets.push({ id: "y", text: "Deployed on Kubernetes", origin: "ai", sourceItemId: proj.sourceItemId });
    expect(validateDoc(doc, items).issues.some((i) => i.claim === "Kubernetes")).toBe(true);
    proj.bullets[proj.bullets.length - 1].origin = "user";
    expect(validateDoc(doc, items).ok).toBe(true);
  });

  it("the generated resume validates cleanly and only uses confirmed facts", () => {
    expect(validateDoc(buildResume(items), items)).toEqual({ ok: true, issues: [] });
  });
});

describe("export + no-AI", () => {
  it("7. the resume system works with no Anthropic key and never imports the AI client", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const doc = buildResume(toItems(parseResumeText(pdfText).facts));
      expect((await renderPdf(doc)).byteLength).toBeGreaterThan(1000);
      for (const f of ["parse", "extract", "generate", "tailor", "validate", "export", "profile", "types", "schemas"]) {
        expect(readFileSync(`src/lib/resume/${f}.ts`, "utf8")).not.toMatch(/@\/lib\/ai|@anthropic-ai/);
      }
    } finally {
      if (key) process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it("9. exported PDF and DOCX contain approved information only", async () => {
    const doc = buildResume(items);
    const pdf = (await extractText(await renderPdf(doc), { mergePages: true })).text;
    const docx = (await mammoth.extractRawText({ buffer: await renderDocx(doc) })).value;
    for (const out of [pdf, docx]) {
      expect(out).toContain("Jordan Lee");
      expect(out).toContain("Bright Harbor Labs");
      expect(out).toContain("Java");
      expect(out).toContain("AWS Certified Cloud Practitioner"); // explicit certification kept
      expect(out).not.toContain("Rock climbing"); // unconfirmed (Uncategorized) left out
      expect(out.slice(out.search(/SKILLS/i))).not.toMatch(/\bJest\b|\bBash\b/); // unconfirmed skills not listed
    }
    // Every word of the export comes from the reviewed document (nothing hidden or extra).
    const tok = (s: string) => s.split(/\s+/).map((w) => w.replace(/^[(|,.:]+|[)|,.:]+$/g, "")).filter((w) => w && !/^[|•–—()·:]+$/.test(w));
    const docWords = new Set(tok(docToText(doc)));
    const extra = tok(pdf).filter((w) => !docWords.has(w));
    expect(extra).toEqual([]);
  });
});

describe("version compare", () => {
  it("diffs lines without losing or inventing any", async () => {
    const { diffLines } = await import("./diff");
    const d = diffLines(["a", "b", "c"], ["a", "c", "d"]);
    expect(d).toEqual([{ kind: "same", text: "a" }, { kind: "removed", text: "b" }, { kind: "same", text: "c" }, { kind: "added", text: "d" }]);
  });
});

describe("numeric claims match whole numbers", () => {
  it("does not treat '2' as backed by '2025' and keeps magnitude words", async () => {
    const { unsupportedClaims } = await import("./validate");
    expect(unsupportedClaims("Served 2 million users", "Jun 2025 – Aug 2025 intern")).toEqual(["2million"]);
    expect(unsupportedClaims("GPA: 3.62", '{"gpa":"3.62"}')).toEqual([]);
    expect(unsupportedClaims("Helped 20+ students", "Helped 20+ students weekly")).toEqual([]);
  });
});

describe("tailoring never promotes a skill from elsewhere", () => {
  it("notes AWS in a certification but keeps it out of skills", async () => {
    const { tailorProposal, buildTailored } = await import("./tailor");
    const p = tailorProposal(items, { id: "j", title: "Cloud Intern", company: "X", description: "Experience with AWS and Java required.", requirements: ["AWS", "Java"] });
    const aws = p.skills.find((s) => s.name === "AWS");
    expect(aws?.status).toBe("not_in_profile");
    expect(aws?.mentionedIn).toBe("Certifications");
    const doc = buildTailored(items, p, []);
    const skills = doc.sections.find((s) => s.kind === "skills")!.lines.map((l) => l.text).join(" ");
    expect(skills).not.toMatch(/\bAWS\b/);
  });
});
