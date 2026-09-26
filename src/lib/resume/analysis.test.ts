import { describe, expect, it } from "vitest";
import { analyzeDocument, CATEGORY_LABEL, type AnalysisCategory } from "./analysis";
import type { DocEntry, ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const entry = (id: string, heading: string, meta: string, bullets: string[], subheading = ""): DocEntry => ({ id, sourceItemId: null, heading, subheading, meta, origin: "user", bullets: bullets.map((b, i) => line(`${id}-${i}`, b)) });

const doc = (): ResumeDoc => ({
  version: 1,
  header: { name: "Sample Student", contact: ["sample@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [
      entry("e1", "Software Intern", "Jun 2025 – Aug 2025", [
        "Responsible for various things on the help desk website",
        "Built cloud applications for the team",
        "Fixed bugs",
        "Built a reporting dashboard that summarizes ticket volume by week and sends the summary to every manager in the company along with charts and detailed notes about unusual changes that the team should review every single week",
        "Built importers for course data",
        "Built scripts for grade exports",
      ]),
      entry("e2", "Tutor", "", []),
    ] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [entry("p1", "Study Buddy", "2025", ["Built a tutor matching site for students"])] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, SQL, Kubernetes")] },
  ],
});

const has = (items: ReturnType<typeof analyzeDocument>["items"], category: AnalysisCategory, re: RegExp) => items.some((i) => i.category === category && re.test(`${i.title} ${i.detail}`));

describe("full-resume analysis", () => {
  const { items, counts } = analyzeDocument(doc());

  it("covers every category the editor promises", () => {
    expect(Object.keys(CATEGORY_LABEL)).toHaveLength(9);
    for (const c of ["weak", "repetitive", "vague", "missing_context", "too_long", "too_short", "unclear_technical", "missing_evidence"] as AnalysisCategory[]) {
      expect(counts[c], c).toBeGreaterThan(0);
    }
  });

  it("finds weak, vague, long and short bullets, and repeated openers", () => {
    expect(has(items, "weak", /weak phrase/i)).toBe(true);
    expect(has(items, "vague", /various|things/i)).toBe(true);
    expect(has(items, "too_long", /Long \(/)).toBe(true);
    expect(has(items, "too_short", /Very short/)).toBe(true);
    expect(has(items, "repetitive", /start with “built”/)).toBe(true);
  });

  it("flags technical wording with no specifics ('cloud applications') without guessing a technology", () => {
    const u = items.find((i) => i.category === "unclear_technical" && /cloud applications/.test(i.detail))!;
    expect(u.detail).toMatch(/cloud applications/);
    expect(u.suggestion).toMatch(/only if it's true/i);
  });

  it("flags missing context: an entry with no description, and no dates", () => {
    expect(has(items, "missing_context", /no description/i)).toBe(true);
    expect(has(items, "missing_context", /No dates/)).toBe(true);
  });

  it("flags skills that are listed but never shown (weak evidence) — recommends adding a bullet only if true", () => {
    const k = items.find((i) => i.category === "missing_evidence" && /Kubernetes/.test(i.title))!;
    expect(k.suggestion).toMatch(/only if you really did/i);
  });

  it("recommends Quantify for a missing measurable result and never supplies a number", () => {
    const q = items.find((i) => i.category === "missing_evidence" && /measurable/i.test(i.title))!;
    expect(q.suggestion).toMatch(/Quantify/);
    for (const i of items.filter((x) => x.category !== "formatting")) expect(i.suggestion).not.toMatch(/\d/); // (formatting hints may show an example date format)
  });

  it("only recommends — it never contains or produces replacement text", () => {
    for (const i of items) expect(Object.keys(i).sort().filter((k) => !["category", "title", "detail", "suggestion", "where", "ref"].includes(k))).toEqual([]);
  });

  it("is deterministic and does not mutate the document", () => {
    const d = doc();
    const before = JSON.stringify(d);
    expect(analyzeDocument(d)).toEqual(analyzeDocument(doc()));
    expect(JSON.stringify(d)).toBe(before);
  });

  it("reports formatting problems from the ATS checks (inconsistent date formats)", () => {
    const d = doc();
    d.sections[0].entries[0].meta = "06/2025";
    d.sections[1].entries[0].meta = "Jan 2025 – May 2025";
    expect(analyzeDocument(d).counts.formatting).toBeGreaterThan(0);
  });
});
