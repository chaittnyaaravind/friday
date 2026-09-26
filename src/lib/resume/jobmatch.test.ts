import { describe, expect, it } from "vitest";
import { analyzeJd, matchJob } from "./jobmatch";
import type { ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc: ResumeDoc = {
  version: 1,
  header: { name: "Ada Student", contact: ["ada@example.com"], origin: "user" },
  sections: [
    { id: "edu", kind: "education", title: "Education", lines: [], entries: [{ id: "e0", sourceItemId: null, heading: "San Jose State University", subheading: "B.S. Computer Science · GPA: 3.7", meta: "Aug 2022 – May 2026", origin: "user", bullets: [] }] },
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{
      id: "e1", sourceItemId: null, heading: "Software Intern", subheading: "Campus IT", meta: "Jun 2025 – Aug 2025", origin: "user",
      bullets: [line("b1", "Built REST APIs with Python and Flask for the help desk"), line("b2", "Wrote SQL queries to report ticket volume"), line("b3", "Set up Docker containers for local development")],
    }] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "Study Buddy", subheading: "React, TypeScript", meta: "2025", origin: "user", bullets: [line("b4", "Built a tutor-matching web app")] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, SQL, Java"), line("s2", "Tools: Git, Linux")] },
  ],
};

const JD = `About the role
We build developer tools for fintech teams.

Responsibilities
- Build and maintain backend services in Python
- Design REST APIs used by other teams
- Work with Kubernetes and AWS in production

Minimum Qualifications
- Currently pursuing a Bachelor's degree in Computer Science
- Experience with Python, SQL and REST APIs
- Familiarity with Java

Preferred Qualifications
- Kubernetes or Docker experience
- 2+ years of experience with cloud platforms`;

describe("job description analysis", () => {
  const jd = analyzeJd(JD);
  it("splits required from preferred and extracts technologies", () => {
    expect(jd.required).toEqual(expect.arrayContaining(["Python", "SQL"]));
    expect(jd.preferred).toEqual(expect.arrayContaining(["Kubernetes"]));
    expect(jd.technologies).toEqual(expect.arrayContaining(["Python", "Kubernetes"]));
  });
  it("captures responsibilities, education, experience and domain", () => {
    expect(jd.responsibilities.join(" ")).toMatch(/backend services/);
    expect(jd.education.join(" ")).toMatch(/Bachelor/);
    expect(jd.experience.join(" ")).toMatch(/2\+ years/);
    expect(jd.domain).toContain("fintech");
  });
});

describe("resume ↔ job matching", () => {
  const m = matchJob(doc, JD);
  const by = (n: string) => m.skills.find((s) => s.name === n);

  it("MATCHED: listed in Skills and shown in a bullet", () => {
    expect(by("Python")?.status).toBe("matched");
    expect(by("SQL")?.status).toBe("matched");
  });

  it("PRESENT BUT WEAK: listed but never shown", () => {
    expect(by("Java")?.status).toBe("weak");
    expect(by("Java")?.message).toMatch(/no bullet or project shows/);
  });

  it("PRESENT BUT UNCLEAR: used in bullets but not listed in Skills", () => {
    expect(by("Docker")?.status).toBe("unclear");
    expect(by("Docker")?.message).toMatch(/isn't in your Skills section/);
  });

  it("MISSING: never tells the user to claim a skill they don't have", () => {
    const k = by("Kubernetes")!;
    expect(k.status).toBe("missing");
    expect(k.message).toBe("You don't currently list Kubernetes. Only add it if you genuinely have this skill.");
    for (const s of m.skills) expect(s.message).not.toMatch(/add (?:it )?to your (?:skills|resume)(?! only)/i);
  });

  it("counts and coverage are derived from the statuses", () => {
    const total = m.skills.length;
    expect(m.counts.matched + m.counts.weak + m.counts.unclear + m.counts.missing).toBe(total);
    expect(m.coverage.present).toBe(Math.round(((total - m.counts.missing) / total) * 100));
    expect(m.missingRequired.every((n) => by(n)?.kind === "required")).toBe(true);
  });

  it("checks the education requirement without suggesting a claim", () => {
    expect(m.education[0]).toMatchObject({ found: true });
  });

  it("reports relevance from real bullets", () => {
    expect(m.relevance.bullets).toBe(4);
    expect(m.relevance.bulletsWithMatch).toBeGreaterThanOrEqual(3);
    expect(["Strong", "Moderate"]).toContain(m.relevance.label);
  });

  it("has nothing to say about an empty posting", () => {
    const e = matchJob(doc, "");
    expect(e.skills).toEqual([]);
    expect(e.coverage.present).toBeNull();
    expect(e.relevance.label).toBe("n/a");
  });
});
