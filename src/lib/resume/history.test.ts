import { describe, expect, it } from "vitest";
import { applySuggestion, basisOf, lineContext } from "./edits";
import { changedSections, diffDocs, hasChanged, numbered, userEditLabel, type Revision } from "./history";
import type { ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const base = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["ada@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Intern", subheading: "Campus IT", meta: "2025", origin: "user", bullets: [line("b1", "Worked on a website for students")] }] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "Study Buddy", subheading: "React", meta: "2025", origin: "user", bullets: [line("b2", "Built a tutor-matching app")] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, Java")] },
  ],
});

describe("version history", () => {
  it("names the sections a user edit touched", () => {
    const a = base();
    const b = structuredClone(a);
    b.sections[1].entries[0].bullets[0].text = "Built a tutor-matching web app";
    expect(changedSections(a, b)).toEqual(["Projects"]);
    expect(userEditLabel(a, b)).toBe("Edited Projects");
    b.sections[2].lines[0].text = "Languages: Java, Python";
    expect(userEditLabel(a, b)).toBe("Edited Projects and Skills");
  });

  it("detects header edits, removed sections and reordering", () => {
    const a = base();
    const h = structuredClone(a);
    h.header.name = "Ada L. Student";
    expect(changedSections(a, h)).toEqual(["Header"]);
    const removed = structuredClone(a);
    removed.sections.pop();
    expect(changedSections(a, removed)).toEqual(["Skills"]);
    const moved = structuredClone(a);
    moved.sections.reverse();
    expect(userEditLabel(a, moved)).toBe("Reordered sections");
  });

  it("hasChanged is false for an identical document, so no empty revision is written", () => {
    expect(hasChanged(base(), base())).toBe(false);
    expect(hasChanged(null, base())).toBe(true);
  });

  it("a restore keeps the old state recoverable: applying an AI edit never mutates the earlier snapshot", () => {
    const original = base();
    const ref = { sectionId: "exp", entryId: "e1", lineId: "b1" };
    const improved = applySuggestion(original, { kind: "line", ...ref }, "Developed a website for students", { op: "improve", basis: basisOf(lineContext(original, ref)!) });
    expect(original.sections[0].entries[0].bullets[0].text).toBe("Worked on a website for students");
    expect(improved.sections[0].entries[0].bullets[0].text).toBe("Developed a website for students");
    // restoring = writing `original` back as a new revision; both states remain
    const revs: Pick<Revision, "created_at" | "content">[] = [
      { created_at: "2026-01-01T00:00:00Z", content: original },
      { created_at: "2026-01-02T00:00:00Z", content: improved },
      { created_at: "2026-01-03T00:00:00Z", content: original },
    ];
    expect(numbered(revs).map((r) => r.number)).toEqual([3, 2, 1]);
    expect(revs[0].content).toEqual(revs[2].content);
  });

  it("compares two revisions line by line", () => {
    const a = base();
    const b = structuredClone(a);
    b.sections[0].entries[0].bullets[0].text = "Developed a website for students";
    const d = diffDocs(a, b);
    expect(d.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["• Worked on a website for students"]);
    expect(d.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["• Developed a website for students"]);
  });
});
