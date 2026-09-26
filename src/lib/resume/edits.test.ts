import { describe, expect, it } from "vitest";
import { applySuggestion, canApply, factDigest, findRepeats, findWeakBullets, lineContext, localProposal, screenSuggestions, basisOf, type LineRef } from "./edits";
import type { CandidateItem, ResumeDoc } from "./types";
import { validateDoc } from "./validate";

const item: CandidateItem = {
  id: "exp1", section: "experience", position: 0, data: { title: "Intern", organization: "Campus IT", location: null, start: "Jun 2025", end: "Aug 2025", bullets: ["Worked on a website for students", "Fixed bugs in the help desk tool"] } as never,
  source: "uploaded_resume", source_text: "Worked on a website for students", source_resume_id: "r", status: "explicit", note: null, created_at: "", updated_at: "",
};

const doc = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["ada@example.com"], origin: "user" },
  sections: [{
    id: "s-exp", kind: "experience", title: "Experience", lines: [],
    entries: [{
      id: "e1", sourceItemId: "exp1", heading: "Intern", subheading: "Campus IT", meta: "Jun 2025 – Aug 2025", origin: "profile",
      bullets: [
        { id: "b1", text: "Worked on a website for students", origin: "profile", sourceItemId: "exp1" },
        { id: "b2", text: "Fixed bugs in the help desk tool", origin: "profile", sourceItemId: "exp1" },
      ],
    }],
  }],
});
const ref: LineRef = { sectionId: "s-exp", entryId: "e1", lineId: "b1" };
const target = { kind: "line" as const, ...ref };

describe("screening AI suggestions", () => {
  const ctx = lineContext(doc(), ref)!;
  const evidence = basisOf(ctx);
  const screen = (texts: string[]) => screenSuggestions(texts.map((text) => ({ text })), { original: ctx.text, evidence });

  it("REJECTS a suggestion that invents 50,000 users and never shows it as applicable", () => {
    const { suggestions, rejected } = screen(["Built a website used by 50,000 students"]);
    expect(suggestions).toHaveLength(0);
    expect(rejected[0].reasons.join(" ")).toMatch(/number/i);
  });

  it("flags inflated claims as requiring confirmation, and blocks auto-apply", () => {
    const { suggestions } = screen(["Led development of a student website"]);
    expect(suggestions[0].requiresUserConfirmation).toBe(true);
    expect(canApply(suggestions[0], false)).toBe(false);
    expect(canApply(suggestions[0], true)).toBe(true);
  });

  it("passes pure rewording with no new facts", () => {
    const { suggestions } = screen(["Developed a website for students"]);
    expect(suggestions[0].newFacts).toEqual([]);
    expect(canApply(suggestions[0], false)).toBe(true);
  });

  it("drops duplicates, echoes of the original, and malformed items", () => {
    const { suggestions } = screenSuggestions([{ text: ctx.text }, { text: "Developed a website for students" }, { text: "developed a website for students" }, {} as never, { text: 42 as never }], { original: ctx.text, evidence });
    expect(suggestions).toHaveLength(1);
  });

  it("treats a model-reported new fact with a number as a rejection, even if our scan missed it", () => {
    const { suggestions, rejected } = screenSuggestions([{ text: "Developed a website for students", newFactsIntroduced: ["47% performance improvement"] }], { original: ctx.text, evidence });
    expect(suggestions).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });

  it("a skills line may not gain a skill", () => {
    const { suggestions, rejected } = screenSuggestions([{ text: "Languages: Java, Python, Go" }], { original: "Languages: Python, Java", evidence: "Languages: Python, Java", kind: "skills" });
    expect(suggestions).toHaveLength(0);
    expect(rejected[0].reasons[0]).toMatch(/Go/);
  });
});

describe("accepting, rejecting and editing", () => {
  it("accepting an AI rewrite records origin, basis and op, and never mutates the input document", () => {
    const before = doc();
    const after = applySuggestion(before, target, "Developed a website for students", { op: "improve", basis: basisOf(lineContext(before, ref)!), now: "2026-01-01T00:00:00.000Z" });
    expect(before.sections[0].entries[0].bullets[0].text).toBe("Worked on a website for students"); // rejecting = simply not applying
    const line = after.sections[0].entries[0].bullets[0];
    expect(line).toMatchObject({ id: "b1", text: "Developed a website for students", origin: "ai", sourceItemId: "exp1", ai: { op: "improve", at: "2026-01-01T00:00:00.000Z" } });
  });

  it("an accepted AI rewrite validates against the profile; an accepted invention does not", () => {
    const ok = applySuggestion(doc(), target, "Developed a website for students", { op: "improve", basis: "Worked on a website for students" });
    expect(validateDoc(ok, [item]).ok).toBe(true);
    const bad = applySuggestion(doc(), target, "Built a website used by 50000 students", { op: "improve", basis: "Worked on a website for students" });
    const v = validateDoc(bad, [item]);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.claim)).toContain("50000");
  });

  it("the server-side check catches inflated scope even if the client skipped confirmation", () => {
    const inflated = applySuggestion(doc(), target, "Architected a distributed platform for students", { op: "improve", basis: "Worked on a website for students" });
    expect(validateDoc(inflated, [item]).ok).toBe(false);
  });

  it("an attested or user-edited line becomes the user's own and is not machine-checked", () => {
    const attested = applySuggestion(doc(), target, "Led a team of 3 on the student website", { op: "improve", basis: "", attested: true });
    expect(attested.sections[0].entries[0].bullets[0]).toMatchObject({ origin: "user", sourceItemId: null });
    expect(attested.sections[0].entries[0].bullets[0].ai).toBeUndefined();
    expect(validateDoc(attested, [item]).ok).toBe(true);
  });

  it("an AI line with no recorded source is rejected by validation", () => {
    const d = doc();
    d.sections[0].entries[0].origin = "user";
    d.sections[0].entries[0].sourceItemId = null;
    d.sections[0].entries[0].bullets[0] = { id: "b1", text: "Developed a website", origin: "ai", sourceItemId: null };
    expect(validateDoc(d, [item]).issues[0].reason).toMatch(/no recorded source/i);
  });

  it("creates a Summary section on first summary accept and replaces it afterwards", () => {
    const one = applySuggestion(doc(), { kind: "summary" }, "Student developer.", { op: "summary", basis: factDigest(doc()) });
    expect(one.sections[0]).toMatchObject({ kind: "summary" });
    const two = applySuggestion(one, { kind: "summary" }, "Student developer with campus IT experience.", { op: "summary", basis: factDigest(doc()) });
    expect(two.sections.filter((s) => s.kind === "summary")).toHaveLength(1);
    expect(two.sections[0].lines[0].text).toMatch(/campus IT/);
  });

  it("applying to a deleted line fails loudly instead of writing elsewhere", () => {
    expect(() => applySuggestion(doc(), { kind: "line", ...ref, lineId: "gone" }, "x", { op: "improve", basis: "" })).toThrow(/no longer exists/);
  });
});

describe("local fallbacks (no AI configured)", () => {
  it("fixes grammar and spacing without adding words", () => {
    const p = localProposal("grammar", target, "worked on the the website ,for students.", "worked on the the website ,for students.");
    expect(p.via).toBe("local");
    expect(p.suggestions[0].text).toBe("Worked on the website, for students");
    expect(p.suggestions[0].newFacts).toEqual([]);
  });

  it("shortens filler but keeps technologies and numbers", () => {
    const p = localProposal("shorten", target, "Utilized Python in order to really speed up 3 reports", "Utilized Python in order to really speed up 3 reports");
    expect(p.suggestions[0].text).toBe("Used Python to speed up 3 reports");
  });

  it("says so when there is nothing to change", () => {
    const p = localProposal("grammar", target, "Developed a website for students", "Developed a website for students");
    expect(p.suggestions).toHaveLength(0);
    expect(p.note).toMatch(/No grammar/);
  });
});

describe("deterministic analysis", () => {
  const messy = (): ResumeDoc => {
    const d = doc();
    d.sections[0].entries[0].bullets = [
      { id: "w1", text: "Responsible for the website", origin: "user", sourceItemId: null },
      { id: "w2", text: "I fixed bugs", origin: "user", sourceItemId: null },
      { id: "w3", text: "Developed a scheduler that assigns tutors to sessions", origin: "user", sourceItemId: null },
      { id: "w4", text: "Developed an importer that loads course data nightly", origin: "user", sourceItemId: null },
      { id: "w5", text: "Developed a dashboard that shows enrollment totals", origin: "user", sourceItemId: null },
    ];
    return d;
  };

  it("finds weak bullets with reasons, and flags missing evidence as a tip, not a defect", () => {
    const f = findWeakBullets(messy());
    expect(f.find((x) => x.ref.lineId === "w1")?.issues.join(" ")).toMatch(/weak phrase/);
    expect(f.find((x) => x.ref.lineId === "w2")?.issues.join(" ")).toMatch(/first person/i);
    expect(f.find((x) => x.ref.lineId === "w3")?.severity).toBe("tip");
    expect(f.find((x) => x.ref.lineId === "w3")?.issues[0]).toMatch(/Missing evidence/);
  });

  it("finds repeated sentence openers", () => {
    const r = findRepeats(messy());
    expect(r.find((x) => x.word === "developed")).toMatchObject({ count: 3, kind: "opener" });
  });

  it("factDigest contains only facts present in the document", () => {
    const digest = factDigest(doc());
    expect(digest).toContain("Campus IT");
    expect(digest).toContain("Worked on a website for students");
  });
});
