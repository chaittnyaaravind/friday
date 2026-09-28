import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeMatch, type MatchJob, type MatchProfile } from "./match";
import { sample } from "./testing/match-sample";

// ───────────────────────── the old behavior, pinned ─────────────────────────
/**
 * EXISTING BEHAVIOR. This hash covers the FULL result (score, strong, missing, difficulty, distance, tier) of computeMatch
 * for 400 pairs, computed from the implementation as it was before the breakdown was added. Adding the breakdown, the
 * eligibility verdict and the explanation must not change one of them. If scoring is ever changed ON PURPOSE, update the
 * hash in the same commit and say why.
 */
const GOLDEN = "53b9b5f721fc27a1f2e1dd20e063d601f731fcaec87de1b75b80c2fcc81ced0e";

// ───────────────────────── the transparent breakdown ─────────────────────────
const base = (over: Partial<MatchProfile> = {}): MatchProfile => ({ major: "Computer Science", skills: ["java", "sql"], origin: { lat: 37.3352, lng: -121.8811 }, radiusMiles: 25, workplace: "any", desiredTitles: [], ...over });
const jobOf = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: "Software Engineering Intern", employmentType: "internship", category: "Software Engineering", isOnCampus: false,
  lat: 37.3541, lng: -121.9552, city: "Santa Clara", isRemote: false, isHybrid: false, description: "",
  requirements: [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "spring", label: "Spring Boot", kind: "required" }, { slug: "aws", label: "AWS", kind: "preferred" }],
  ...over,
});
const part = (m: ReturnType<typeof computeMatch>, key: string) => m.breakdown.find((p) => p.key === key)!;

describe("computeMatch — the breakdown adds up to the score, always", () => {
  it("across 400 sampled pairs: four parts, in order, each within its maximum, summing exactly to the score", () => {
    for (const { profile, job } of sample(400)) {
      const m = computeMatch(profile, job);
      expect(m.breakdown.map((p) => p.key)).toEqual(["skills", "role", "profile", "location"]);
      expect(m.breakdown.map((p) => p.max)).toEqual([60, 15, 10, 15]);
      for (const p of m.breakdown) {
        expect(p.points).toBeGreaterThanOrEqual(0);
        expect(p.points).toBeLessThanOrEqual(p.max);
        expect(p.detail.length).toBeGreaterThan(10);
      }
      expect(m.breakdown.reduce((s, p) => s + p.points, 0)).toBe(m.score);
    }
  });
  it("what a reason chip says agrees with the points behind it", () => {
    for (const { profile, job } of sample(400)) {
      const m = computeMatch(profile, job);
      if (m.strong.some((r) => r.label === "SJSU on-campus position")) expect(part(m, "role").points).toBe(15);
      if (m.strong.some((r) => r.label === "Remote")) expect(part(m, "location").points).toBe(10);
      if (m.strong.some((r) => r.kind === "profile")) expect(part(m, "profile").points).toBe(10);
    }
  });
});

describe("computeMatch — each part explains itself", () => {
  it("skills: the counts are the real ones", () => {
    const m = computeMatch(base(), jobOf());
    expect(part(m, "skills").detail).toMatch(/2 of 3 required and 0 of 1 preferred skills/);
    expect(part(computeMatch(base({ skills: ["java", "sql", "spring", "aws"] }), jobOf()), "skills").detail).toMatch(/3 of 3 required and 1 of 1 preferred/);
  });
  it("skills: no listed requirements is a stated neutral 30, not a hidden default", () => {
    const p = part(computeMatch(base(), jobOf({ requirements: [] })), "skills");
    expect(p.points).toBe(30);
    expect(p.detail).toMatch(/lists no skills.*neutral 30 of 60/);
  });
  it("skills: a small sample is pulled toward the middle and the text says so", () => {
    expect(part(computeMatch(base(), jobOf({ requirements: [{ slug: "java", label: "Java", kind: "required" }] })), "skills").detail).toMatch(/only a few skills are listed/);
  });
  it("role: on campus, internship, early-career and none each say which", () => {
    expect(part(computeMatch(base(), jobOf({ isOnCampus: true, employmentType: "on_campus" })), "role")).toMatchObject({ points: 15, detail: expect.stringMatching(/on-campus/) });
    expect(part(computeMatch(base(), jobOf()), "role")).toMatchObject({ points: 15, detail: expect.stringMatching(/internship/) });
    expect(part(computeMatch(base(), jobOf({ employmentType: "full_time", title: "New Grad Engineer" })), "role")).toMatchObject({ points: 8, detail: expect.stringMatching(/early-career/) });
    expect(part(computeMatch(base(), jobOf({ employmentType: "full_time", title: "Staff Engineer" })), "role")).toMatchObject({ points: 0, detail: expect.stringMatching(/earns no role points/) });
  });
  it("role: a wanted title is mentioned but is worth no points (as before)", () => {
    const p = part(computeMatch(base({ desiredTitles: ["Software Engineering Intern"] }), jobOf()), "role");
    expect(p.points).toBe(15);
    expect(p.detail).toMatch(/matches a title you want.*adds no points/);
  });
  it("profile: a related major, a neutral non-technical role, a missing major and unsupported hardware each say so", () => {
    expect(part(computeMatch(base(), jobOf()), "profile")).toMatchObject({ points: 10, detail: expect.stringMatching(/Computer Science.*fits/) });
    expect(part(computeMatch(base(), jobOf({ category: "Product/Technical" })), "profile")).toMatchObject({ points: 5, detail: expect.stringMatching(/neutral 5 of 10/) });
    expect(part(computeMatch(base({ major: null }), jobOf()), "profile")).toMatchObject({ points: 0, detail: expect.stringMatching(/No major/) });
    expect(part(computeMatch(base({ skills: [] }), jobOf({ category: "Embedded" })), "profile")).toMatchObject({ points: 0, detail: expect.stringMatching(/hardware experience/) });
  });
  it("location: near, far-but-inside, outside the radius, remote, remote-when-onsite-only and unknown each say so", () => {
    expect(part(computeMatch(base(), jobOf()), "location")).toMatchObject({ points: 15, detail: expect.stringMatching(/miles away, inside your 25-mile radius/) });
    expect(part(computeMatch(base({ radiusMiles: 60 }), jobOf({ lat: 37.8, lng: -122.3, city: "Oakland" })), "location")).toMatchObject({ points: 11, detail: expect.stringMatching(/slightly less/) });
    expect(part(computeMatch(base(), jobOf({ lat: 40.7128, lng: -74.006, city: "New York" })), "location")).toMatchObject({ points: 3, detail: expect.stringMatching(/outside your 25-mile radius/) });
    expect(part(computeMatch(base(), jobOf({ lat: null, lng: null, isRemote: true })), "location")).toMatchObject({ points: 10, detail: expect.stringMatching(/Remote, and you are open/) });
    expect(part(computeMatch(base({ workplace: "onsite" }), jobOf({ lat: null, lng: null, isRemote: true })), "location")).toMatchObject({ points: 0, detail: expect.stringMatching(/prefers on-site/) });
    expect(part(computeMatch(base(), jobOf({ lat: null, lng: null })), "location")).toMatchObject({ points: 0, detail: expect.stringMatching(/No location is known/) });
  });
});

describe("computeMatch — existing behavior is unchanged", () => {
  it("400 sampled pairs produce exactly the results they always did", () => {
    const results = sample(400).map(({ profile, job }) => {
      const m: Record<string, unknown> = { ...computeMatch(profile, job) };
      delete m.breakdown; // the hash covers the fields that existed before the breakdown did
      return m;
    });
    const hash = createHash("sha256").update(JSON.stringify(results)).digest("hex");
    expect(hash).toBe(GOLDEN);
  });
  it("the sample is genuinely varied (it is not testing one case 400 times)", () => {
    const scores = new Set(sample(400).map(({ profile, job }) => computeMatch(profile, job).score));
    expect(scores.size).toBeGreaterThan(25);
  });
});
