import { describe, expect, it } from "vitest";
import { buildResume } from "./generate";
import { buildTailoringReport, compareDocs, reportSummary } from "./report";
import { buildTailored, tailorProposal, type TailorJob } from "./tailor";
import { applyTerminology } from "./terminology";
import type { CandidateItem, ResumeDoc, Section } from "./types";

let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `it-${++n}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const exp = (title: string, org: string, bullets: string[]) => item("experience", { title, organization: org, location: "San Jose, CA", start: "Jun 2025", end: "Aug 2025", bullets });

const ITEMS: CandidateItem[] = [
  item("personal", { field: "name", value: "Sam Student" }),
  item("education", { school: "San José State University", degree: "B.S. Computer Science", start: "Aug 2023", end: "May 2027", gpa: null, details: [] }),
  exp("Backend Intern", "Acme", ["Built REST API services in nodejs and deployed them to k8s", "Migrated reporting tables to Postgres"]),
  exp("Library Assistant", "SJSU Library", ["Helped students find sources", "Maintained the help desk queue"]),
  item("project", { name: "Tracker", technologies: ["Python", "SQL"], date: "2025", link: null, bullets: ["Built a job tracker in Python"] }),
  item("skill", { name: "Python", group: "Languages" }), item("skill", { name: "SQL", group: "Languages" }), item("skill", { name: "Java", group: "Languages" }),
  item("skill", { name: "nodejs", group: "Backend" }), item("skill", { name: "k8s", group: "DevOps" }), item("skill", { name: "Postgres", group: "Databases" }),
];
const JOB: TailorJob = {
  id: "job-1", title: "Software Engineering Intern", company: "Example Co",
  description: "Minimum qualifications\n• Node.js\n• Kubernetes\n• Docker\n• Rust\nYou will build services with Node.js on Kubernetes.",
  requirements: ["Node.js", "Kubernetes", "Docker", "Rust"],
};

const baseline = () => buildResume(ITEMS);

describe("compareDocs — by content, never by random ids", () => {
  it("two separate builds of the same profile are identical (their section and line ids differ)", () => {
    const a = baseline();
    const b = baseline();
    expect(a.sections[0].id).not.toBe(b.sections[0].id);
    expect(compareDocs(a, b)).toEqual([]);
  });
  it("skills listed in a different order are 'reordered', not 'reworded'", () => {
    const tailored = buildResume(ITEMS, { prioritySkills: ["nodejs", "Postgres"] });
    const changes = compareDocs(baseline(), tailored);
    expect(changes.find((c) => c.title === "Skills")).toMatchObject({ changes: ["reordered"], detail: expect.stringMatching(/most relevant skills are listed first/) });
  });
  it("an entry left out of a section is named", () => {
    const libraryId = ITEMS.find((i) => (i.data as { title?: string }).title === "Library Assistant")!.id;
    const changes = compareDocs(baseline(), buildResume(ITEMS, { exclude: new Set([libraryId]) }));
    expect(changes.find((c) => c.title === "Experience")).toMatchObject({ changes: ["entries removed"], detail: "Left out: Library Assistant." });
  });
  it("a whole section that disappears is 'left out'", () => {
    const projectId = ITEMS.find((i) => i.section === "project")!.id;
    const changes = compareDocs(baseline(), buildResume(ITEMS, { exclude: new Set([projectId]) }));
    expect(changes).toContainEqual({ title: "Projects", changes: ["left out"], detail: "The whole Projects section is not on this version." });
  });
  it("entries in a different order are 'reordered'", () => {
    const ranked = buildResume(ITEMS, { rank: new Map(ITEMS.filter((i) => (i.data as { organization?: string }).organization === "Acme").map((i) => [i.id, 10])) });
    const reversed = buildResume(ITEMS, { rank: new Map(ITEMS.filter((i) => (i.data as { organization?: string }).organization === "SJSU Library").map((i) => [i.id, 10])) });
    expect(compareDocs(ranked, reversed).find((c) => c.title === "Experience")?.changes).toContain("reordered");
  });
  it("sections in a different order are reported as such", () => {
    const b = baseline();
    const t = { ...b, sections: [...b.sections].reverse() };
    expect(compareDocs(b, t).some((c) => c.title === "Section order")).toBe(true);
  });
  it("tidied wording is 'reworded' — and says it is only capitalisation, punctuation and spacing", () => {
    const b = baseline();
    const t = baseline();
    t.sections.find((s) => s.kind === "experience")!.entries[0].bullets[0].text = "built rest api services in nodejs and deployed them to k8s!!";
    expect(compareDocs(b, t).find((c) => c.title === "Experience")).toMatchObject({ changes: ["reworded"], detail: expect.stringMatching(/capitalisation, punctuation, spacing/) });
  });
  it("an ATS spelling change is 'spelling' ONLY — it is not mistaken for a rewrite", () => {
    const { doc } = applyTerminology(baseline(), JOB.description);
    const changes = compareDocs(baseline(), doc);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c.changes).toEqual(["spelling"]);
  });
});

describe("buildTailoringReport", () => {
  const proposal = tailorProposal(ITEMS, JOB);
  const tailoredBase = buildTailored(ITEMS, proposal, []);
  const { doc: tailored, changes: terminology } = applyTerminology(tailoredBase, [JOB.title, JOB.description].join("\n"));
  const report = buildTailoringReport({ job: JOB, baseline: { doc: baseline(), source: "profile", versionId: null }, tailored, items: ITEMS, proposal, terminology });

  it("lists every job requirement with its status and the evidence on the resume", () => {
    expect(report.requirements.map((r) => r.name).sort()).toEqual(expect.arrayContaining(["Docker", "Kubernetes", "Node.js", "Rust"]));
    const node = report.requirements.find((r) => r.name === "Node.js")!;
    expect(["matched", "weak", "unclear"]).toContain(node.status);
    expect(node.evidence.length).toBeGreaterThan(0);
    expect(report.counts.matched + report.counts.weak + report.counts.unclear + report.counts.missing).toBe(report.requirements.length);
  });
  it("names the missing requirements — and the tailored resume does NOT contain them", () => {
    expect(report.missing).toEqual(expect.arrayContaining(["Docker", "Rust"]));
    const text = JSON.stringify(tailored);
    expect(text).not.toMatch(/Docker|Rust/);
    expect(report.notes.join(" ")).toMatch(/NOT added: .*Docker/);
  });
  it("records every ATS terminology change with the line before and after", () => {
    expect(report.terminology.length).toBeGreaterThan(0);
    expect(report.terminology).toEqual(terminology);
    expect(report.terminology.some((t) => t.from === "nodejs" && t.to === "Node.js")).toBe(true);
    expect(report.notes.join(" ")).toMatch(/None adds a skill/);
  });
  it("lists what changed by section, forwards the proposal's wording/reorder/exclusions, and says what it was compared with", () => {
    expect(report.changedSections.length).toBeGreaterThan(0);
    expect(report.wording).toEqual(proposal.changes.wording);
    expect(report.reordered).toEqual(proposal.changes.reorder);
    expect(report.baseline).toEqual({ source: "profile", versionId: null });
    expect(report.notes.join(" ")).toMatch(/not set a master resume/);
  });
  it("reports zero unsupported claims for a truthful resume, with the number of lines that were checked", () => {
    expect(report.unsupported).toEqual([]);
    expect(report.verification.ok).toBe(true);
    expect(report.verification.linesChecked).toBeGreaterThan(5);
  });
  it("with a master resume as the baseline it says so and does not nag", () => {
    const r = buildTailoringReport({ job: JOB, baseline: { doc: baseline(), source: "master", versionId: "master-1" }, tailored, items: ITEMS, proposal, terminology });
    expect(r.baseline).toEqual({ source: "master", versionId: "master-1" });
    expect(r.notes.join(" ")).not.toMatch(/not set a master/);
  });
  it("an invented claim is recorded as unsupported, and the report says to review it", () => {
    const bad = JSON.parse(JSON.stringify(tailored)) as ResumeDoc;
    bad.sections.find((s) => s.kind === "experience")!.entries[0].bullets[0].text = "Built REST API services in Rust and cut latency 40%";
    const r = buildTailoringReport({ job: JOB, baseline: { doc: baseline(), source: "profile", versionId: null }, tailored: bad, items: ITEMS, proposal, terminology: [] });
    expect(r.verification.ok).toBe(false);
    expect(r.unsupported.map((u) => u.claim)).toEqual(expect.arrayContaining(["Rust", "40%"]));
    expect(r.notes.join(" ")).toMatch(/without supporting evidence/);
  });
  it("is plain JSON: it survives being stored and read back unchanged", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it("has a one-line summary with the headline numbers", () => {
    expect(reportSummary(report)).toMatch(/^\d+ matched, \d+ to strengthen, \d+ missing; \d+ sections? changed; \d+ spelling changes?; 0 unsupported claims\.$/);
  });
});
