import { describe, expect, it } from "vitest";
import { checkEligibility } from "./eligibility";
import { explainMatch, TIER_WORD } from "./explain";
import { computeMatch, type MatchJob, type MatchProfile } from "./match";
import { sample } from "./testing/match-sample";

const NOW = Date.parse("2026-09-27T20:00:00Z");
const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({
  major: "Computer Science", skills: ["java", "sql"], origin: { lat: 37.3352, lng: -121.8811 }, radiusMiles: 25, workplace: "any", desiredTitles: [],
  workAuthorization: "us_citizen", graduationYear: 2027, ...over,
});
const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: "Software Engineering Intern", employmentType: "internship", category: "Software Engineering", isOnCampus: false,
  lat: 37.3541, lng: -121.9552, city: "Santa Clara", isRemote: false, isHybrid: false, description: "", status: "active",
  requirements: [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "spring", label: "Spring Boot", kind: "required" }, { slug: "aws", label: "AWS", kind: "preferred" }],
  ...over,
});
const explain = (p: MatchProfile, j: MatchJob) => explainMatch(computeMatch(p, j), checkEligibility(p, j, null, NOW));

describe("explainMatch — a job that matches", () => {
  const r = explain(profile(), job());
  it("the headline names the tier, the score, and what carries the match", () => {
    expect(r.headline).toMatch(/^(Strong match|Good match) \(\d+\/100\): Java, SQL/);
  });
  it("every point earned is listed with its numbers and reason", () => {
    expect(r.whyItMatches).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Skills — \d+ of 60: You have 2 of 3 required and 0 of 1 preferred skills/),
      expect.stringMatching(/^Role type — 15 of 15: An internship/),
      expect.stringMatching(/^Profile fit — 10 of 10/),
      expect.stringMatching(/^Location — 15 of 15/),
    ]));
  });
  it("what did not match is stated: lost points, and the exact skills that are missing", () => {
    expect(r.whyNot).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Skills — \d+ of 60/),
      "Required skills you do not have on your profile: Spring Boot.",
      "Preferred skills you do not have on your profile: AWS.",
    ]));
    expect(r.whyNot.join(" ")).not.toMatch(/Role type|Profile fit|Location —/); // those earned full marks
  });
  it("next steps are concrete and about the real gaps", () => {
    expect(r.nextSteps.length).toBeGreaterThan(0);
    expect(r.nextSteps[0]).toMatch(/Spring Boot/);
  });
});

describe("explainMatch — a job that does not", () => {
  it("says so plainly, with the reasons", () => {
    const p = profile({ skills: [], major: "Business Administration", radiusMiles: 5 });
    const j = job({ lat: 40.7128, lng: -74.006, city: "New York", employmentType: "full_time", title: "Staff Engineer" });
    const r = explain(p, j);
    expect(r.headline).toMatch(/^Stretch role \(\d+\/100\)/);
    expect(r.whyNot.join("\n")).toMatch(/Role type — 0 of 15/);
    expect(r.whyNot.join("\n")).toMatch(/Location — 3 of 15: About \d+ miles away, outside your 5-mile radius/);
    expect(r.whyNot.join("\n")).toMatch(/Required skills you do not have on your profile: Java, SQL, Spring Boot\./);
  });
  it("a profile with nothing on it is told nothing lines up, not given false comfort", () => {
    const r = explain(profile({ skills: [], major: null }), job({ employmentType: "full_time", title: "Staff Engineer", lat: null, lng: null }));
    expect(r.headline).toMatch(/nothing on your profile lines up with it yet/);
  });
  it("a perfect match has nothing left in 'why not'", () => {
    const j = job({ isOnCampus: true, employmentType: "on_campus", city: "San Jose", lat: 37.3352, lng: -121.8811, requirements: [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "java", label: "Java 2", kind: "required" }, { slug: "sql", label: "SQL 2", kind: "required" }] });
    const r = explain(profile(), j);
    expect(r.whyNot).toEqual([]);
    expect(r.nextSteps).toEqual([]);
  });
});

describe("explainMatch — eligibility is part of the story, separately from the score", () => {
  it("a high score that is likely blocked says both, in one sentence", () => {
    const p = profile({ skills: ["java", "sql", "spring", "aws"], workAuthorization: "f1" });
    const j = job({ description: "Applicants must be a U.S. citizen." });
    const r = explain(p, j);
    expect(r.headline).toMatch(/^Strong match \(\d+\/100\).* But it is likely blocked — The posting states that U\.S\. citizenship is required/);
    expect(r.whyNot.some((l) => l.startsWith("Eligibility — Work authorization:"))).toBe(true);
    expect(r.nextSteps.some((s) => /Confirm "work authorization" in the posting/.test(s))).toBe(true);
  });
  it("something to verify is flagged without calling it a blocker", () => {
    const r = explain(profile({ workAuthorization: "f1" }), job());
    expect(r.headline).toMatch(/Verify your eligibility before applying\.$/);
    expect(r.headline).not.toMatch(/blocked/);
  });
  it("without an eligibility result there are no eligibility lines", () => {
    const r = explainMatch(computeMatch(profile(), job()));
    expect(r.whyNot.join(" ")).not.toMatch(/Eligibility/);
    expect(r.headline).not.toMatch(/eligib|blocked/i);
  });
});

describe("explainMatch — it can never claim what the engine did not find", () => {
  it("across 400 sampled pairs, a missing skill is never named as matched: not in the headline, not in 'why it matches'", () => {
    for (const { profile: p, job: j } of sample(400)) {
      const m = computeMatch(p, j);
      const r = explainMatch(m, checkEligibility(p, j, null, NOW));
      const positive = [r.headline, ...r.whyItMatches].join("\n");
      for (const gap of m.missing) {
        const name = gap.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(positive, `"${gap.label}" was missing`).not.toMatch(new RegExp(`(?<![A-Za-z0-9+#])${name}(?![A-Za-z0-9+#])`, "i"));
      }
      // every skill it does name as carrying the match really was found
      for (const r2 of m.strong.filter((x) => x.kind === "skill")) expect(m.missing.map((g) => g.label)).not.toContain(r2.label);
    }
  });
  it("the same inputs always give the same words", () => {
    const p = profile();
    const j = job();
    expect(explain(p, j)).toEqual(explain(p, j));
  });
  it("uses the tier words the rest of FRIDAY uses", () => {
    expect(TIER_WORD).toEqual({ strong: "Strong match", good: "Good match", stretch: "Stretch role" });
  });
});
