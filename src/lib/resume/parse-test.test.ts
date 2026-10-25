import { describe, expect, it } from "vitest";
import { parseTest, parseTestLine } from "./parse-test";
import type { ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["San José, CA", "ada@sjsu.edu", "(408) 555-0100"], origin: "user" },
  sections: [
    { id: "edu", kind: "education", title: "Education", lines: [], entries: [{ id: "e0", sourceItemId: null, heading: "San José State University", subheading: "B.S. Computer Science", meta: "May 2030", origin: "user", bullets: [] }] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "FD9: peer-to-peer file transfer", subheading: "TypeScript, React, WebRTC", meta: "2026", origin: "user", bullets: [line("b1", "Built a browser app that sends files directly between two devices over WebRTC"), line("b2", "Checked every file with an incremental SHA-256 hash")] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Programming: Java, TypeScript")] },
  ],
});

describe("parseTest (real PDF, real text layer)", () => {
  it("finds an entry under its own section even when the summary names it first", async () => {
    const d = doc();
    d.sections.unshift({ id: "sum", kind: "summary", title: "Summary", entries: [], lines: [line("s0", "Computer Science student at San José State University who builds web apps.")] });
    const t = await parseTest(d);
    expect(t.checks.find((c) => c.id === "entries")!.problems).toEqual([]);
  });

  it("passes a clean one-page resume and reports what it read", async () => {
    const t = await parseTest(doc());
    expect(t.checks.filter((c) => !c.ok)).toEqual([]);
    expect(t.ok).toBe(true);
    expect(t.pages).toBe(1);
    expect(t.text).toContain("ada@sjsu.edu");
    expect(parseTestLine(t)).toBe("ATS parse test passed (1 page · 3 sections · 5 lines read back intact)");
  });

  it("catches a line the font cannot encode", async () => {
    const d = doc();
    d.sections[1].entries[0].bullets[1].text = "Shipped the app 🚀 to 40 testers";
    const t = await parseTest(d);
    expect(t.checks.find((c) => c.id === "lines")!.ok).toBe(false);
    expect(t.checks.find((c) => c.id === "lines")!.problems).toEqual(["Shipped the app 🚀 to 40 testers"]);
    expect(parseTestLine(t)).toBe("ATS parse test: every line readable failed");
  });

  it("catches a resume that runs past one page", async () => {
    const d = doc();
    d.sections[1].entries[0].bullets = Array.from({ length: 90 }, (_, i) => line(`x${i}`, `Built feature number ${i} of a browser app that sends files between devices`));
    const t = await parseTest(d);
    expect(t.pages).toBeGreaterThan(1);
    expect(t.checks.find((c) => c.id === "one_page")!.ok).toBe(false);
  });
});
