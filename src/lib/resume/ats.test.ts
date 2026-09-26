import { describe, expect, it } from "vitest";
import { analyzeAts } from "./ats";
import { matchJob } from "./jobmatch";
import type { DocEntry, ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const entry = (id: string, heading: string, meta: string, bullets: string[]): DocEntry => ({ id, sourceItemId: null, heading, subheading: "", meta, origin: "user", bullets: bullets.map((b, i) => line(`${id}-${i}`, b)) });

const good = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["San Jose, CA", "ada@example.com", "(408) 555-0100", "github.com/ada"], origin: "user" },
  sections: [
    { id: "edu", kind: "education", title: "Education", lines: [], entries: [entry("e0", "San Jose State University", "Aug 2022 – May 2026", [])] },
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [entry("e1", "Software Intern", "Jun 2025 – Aug 2025", [
      "Built REST APIs with Python and Flask for the campus help desk",
      "Wrote SQL queries that report weekly ticket volume to 4 managers",
      "Automated nightly data exports using Python scripts and cron jobs",
      "Documented deployment steps for the support team's internal tools",
    ])] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [entry("p1", "Study Buddy", "Jan 2025 – May 2025", ["Developed a tutor-matching web app using React and TypeScript"])] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, SQL, TypeScript")] },
  ],
});

describe("ATS analysis", () => {
  it("every component has a weight, a 0–100 score, a rating and a reason — nothing unexplained", () => {
    const r = analyzeAts(good());
    expect(r.components.length).toBeGreaterThanOrEqual(8);
    for (const c of r.components) {
      expect(c.weight).toBeGreaterThan(0);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.reason.length).toBeGreaterThan(10);
      expect(["Good", "Fair", "Needs work"]).toContain(c.rating);
    }
  });

  it("the overall score is exactly the weighted average of the listed components", () => {
    const r = analyzeAts(good());
    const w = r.components.reduce((n, c) => n + c.weight, 0);
    expect(r.score).toBe(Math.round(r.components.reduce((n, c) => n + c.score * c.weight, 0) / w));
  });

  it("is deterministic — same resume, same score", () => {
    expect(analyzeAts(good())).toEqual(analyzeAts(good()));
  });

  it("scores a clean resume well and says the layout is compatible", () => {
    const r = analyzeAts(good());
    expect(r.rating).not.toBe("Needs work");
    expect(r.components.find((c) => c.id === "formatting")?.rating).toBe("Good");
    expect(r.components.find((c) => c.id === "contact")?.score).toBe(100);
  });

  it("excludes keyword coverage without a job description, and says so", () => {
    const r = analyzeAts(good());
    expect(r.hasJd).toBe(false);
    expect(r.components.some((c) => c.id === "keywords")).toBe(false);
    expect(r.basis).toMatch(/excluded until you add a job description/);
  });

  it("includes explained keyword coverage with a job description", () => {
    const d = good();
    const m = matchJob(d, "Requirements\n- Experience with Python, SQL and Kubernetes\n- Familiarity with Java");
    const r = analyzeAts(d, { match: m });
    const k = r.components.find((c) => c.id === "keywords")!;
    expect(k.reason).toMatch(/% of the posting's skills/);
    expect(k.details.join(" ")).toMatch(/Missing: Kubernetes/);
    expect(r.summary.find((s) => s.label === "Missing required skills")?.value).toBe(String(m.missingRequired.length));
    expect(r.summary.find((s) => s.label === "Keyword coverage")?.value).toBe(`${m.coverage.present}%`);
  });

  it("never tells the user to claim a missing keyword", () => {
    const d = good();
    const r = analyzeAts(d, { match: matchJob(d, "Requirements\n- Kubernetes and Terraform") });
    for (const f of r.components.flatMap((c) => c.fixes)) expect(f.message).not.toMatch(/add (?:it )?to your skills/i);
  });

  it("flags missing contact info, sections, dates and inconsistent date formats", () => {
    const d = good();
    d.header = { name: "Ada Student", contact: ["ada@example.com"], origin: "user" };
    d.sections = d.sections.filter((s) => s.kind !== "skills");
    d.sections[1].entries[0].meta = "";
    d.sections[2].entries[0].meta = "01/2025";
    const r = analyzeAts(d);
    expect(r.components.find((c) => c.id === "contact")?.reason).toMatch(/phone/);
    expect(r.components.find((c) => c.id === "sections")?.reason).toMatch(/Skills/);
    expect(r.components.find((c) => c.id === "dates")?.reason).toMatch(/no date/);
    expect(r.components.find((c) => c.id === "dates")?.fixes.length).toBeGreaterThan(0);
  });

  it("flags non-standard headings, symbols, overlong and overshort bullets, repeated openers", () => {
    const d = good();
    d.sections[1].title = "My Journey";
    d.sections[1].entries[0].bullets = [
      line("x1", "★ Built a thing"),
      line("x2", "Built the reporting pipeline that combines the data exported from several departmental systems into one warehouse table with consistent naming rules and documented ownership for every field so that analysts stop asking the same questions about where numbers come from every single week"),
      line("x3", "Built dashboards"),
      line("x4", "Built importers for course data"),
    ];
    const r = analyzeAts(d);
    expect(r.components.find((c) => c.id === "sections")?.details.join(" ")).toMatch(/✗ My Journey/);
    expect(r.components.find((c) => c.id === "formatting")?.reason).toMatch(/symbols/);
    expect(r.components.find((c) => c.id === "bullets")?.fixes.map((f) => f.message).join(" ")).toMatch(/Too long/);
    expect(r.components.find((c) => c.id === "bullets")?.fixes.map((f) => f.message).join(" ")).toMatch(/Too short/);
    expect(r.components.find((c) => c.id === "repetition")?.reason).toMatch(/repeated opener/);
  });

  it("an empty resume scores poorly instead of crashing", () => {
    const r = analyzeAts({ version: 1, header: { name: "", contact: [], origin: "user" }, sections: [] });
    expect(r.score).toBeLessThan(40);
    expect(r.rating).toBe("Needs work");
  });
});
