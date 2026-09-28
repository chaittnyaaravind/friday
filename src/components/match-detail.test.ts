/** Render tests for the match panels: what a student would actually read, and that the numbers on screen are the real ones. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkEligibility } from "@/lib/domain/eligibility";
import { explainMatch } from "@/lib/domain/explain";
import { computeMatch, type MatchJob, type MatchProfile } from "@/lib/domain/match";
import { EligibilityPanel, ReasonsPanel, ScoreBreakdown } from "./match-detail";

const NOW = Date.parse("2026-09-27T20:00:00Z");
const profile = (over: Partial<MatchProfile> = {}): MatchProfile => ({ major: "Computer Science", skills: ["java", "sql"], origin: { lat: 37.3352, lng: -121.8811 }, radiusMiles: 25, workplace: "any", desiredTitles: [], workAuthorization: "f1", graduationYear: 2027, ...over });
const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: "Software Engineering Intern", employmentType: "internship", category: "Software Engineering", isOnCampus: false, lat: 37.3541, lng: -121.9552, city: "Santa Clara",
  isRemote: false, isHybrid: false, description: "Build APIs.", status: "active",
  requirements: [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "spring", label: "Spring Boot", kind: "required" }, { slug: "aws", label: "AWS", kind: "preferred" }], ...over,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ScoreBreakdown", () => {
  const m = computeMatch(profile(), job());
  const h = html(createElement(ScoreBreakdown, { parts: m.breakdown, score: m.score }));

  it("shows each part with its points, its maximum and its reason, and the sum equals the score", () => {
    const t = text(h);
    for (const p of m.breakdown) {
      expect(t).toContain(p.label);
      expect(t).toContain(p.detail);
      expect(t).toContain(`${p.points} of ${p.max}`);
    }
    expect(t).toContain(`${m.breakdown.map((p) => p.points).join(" + ")} = ${m.score}`);
  });
  it("the bars are the real fractions (and accessible)", () => {
    for (const p of m.breakdown) {
      expect(h).toContain(`aria-label="${p.label}: ${p.points} of ${p.max}"`);
      expect(h).toContain(`width:${(p.points / p.max) * 100}%`);
    }
  });
  it("a fully earned part is marked differently from a partly earned one", () => {
    expect(h).toContain("bg-moss"); // role and location earned full marks
    expect(h).toContain("bg-[rgb(var(--ink)/.45)]"); // skills did not
  });
});

describe("EligibilityPanel", () => {
  it("says what the verdict is, why, and lists every check with its own reason", () => {
    const r = checkEligibility(profile(), job({ description: "Requires 5+ years of professional experience." }), null, NOW);
    const t = text(html(createElement(EligibilityPanel, { result: r })));
    expect(t).toContain("Verify before applying");
    expect(t).toContain(r.headline);
    for (const c of r.checks) {
      expect(t).toContain(c.label);
      expect(t).toContain(c.detail);
    }
    expect(t).toMatch(/5\+ years/);
  });
  it("a blocked verdict is stated as 'Likely blocked' with the reason, in the accent tone", () => {
    const r = checkEligibility(profile(), job({ description: "Applicants must be a U.S. citizen." }), null, NOW);
    const h = html(createElement(EligibilityPanel, { result: r }));
    expect(text(h)).toContain("Likely blocked");
    expect(text(h)).toMatch(/citizenship is required/);
    expect(h).toContain("text-accent");
  });
  it("a clear verdict never overclaims: 'No blockers found', and the disclaimer says FRIDAY cannot determine legal eligibility", () => {
    const r = checkEligibility(profile({ workAuthorization: "us_citizen" }), job(), null, NOW);
    const t = text(html(createElement(EligibilityPanel, { result: r })));
    expect(t).toContain("No blockers found");
    expect(t).not.toMatch(/eligible to work|you are eligible|guaranteed/i);
    expect(t).toContain("cannot determine legal eligibility");
  });
  it("every status has its own marker, so colour is never the only signal", () => {
    const r = checkEligibility(profile({ workAuthorization: null }), job({ description: "PhD required. Must be a U.S. citizen." }), null, NOW);
    const h = html(createElement(EligibilityPanel, { result: r }));
    expect(h).toMatch(/aria-label="(Check|Blocked|Unknown|Fine)"/);
  });
});

describe("ReasonsPanel", () => {
  const p = profile();
  const j = job();
  const m = computeMatch(p, j);
  const reasons = explainMatch(m, checkEligibility(p, j, null, NOW));

  it("lists why it matched and why it did not, in the engine's numbers, and names the missing skills", () => {
    const t = text(html(createElement(ReasonsPanel, { reasons })));
    expect(t).toContain("Why it matched");
    expect(t).toContain("Why it did not match fully");
    expect(t).toContain("Required skills you do not have on your profile: Spring Boot.");
    expect(t).toMatch(/Skills — \d+ of 60/);
    expect(t).toContain("What you can do");
  });
  it("says so plainly when nothing lines up, and when nothing holds a match back", () => {
    const none = { headline: "x", whyItMatches: [], whyNot: ["Skills — 0 of 60: no skills"], nextSteps: [] };
    expect(text(html(createElement(ReasonsPanel, { reasons: none })))).toContain("Nothing on your profile lines up with this yet.");
    const perfect = { headline: "x", whyItMatches: ["Skills — 60 of 60: all"], whyNot: [], nextSteps: [] };
    expect(text(html(createElement(ReasonsPanel, { reasons: perfect })))).toContain("Nothing is holding this match back.");
  });
  it("renders nothing when there is nothing to explain", () => {
    expect(html(createElement(ReasonsPanel, { reasons: { headline: "", whyItMatches: [], whyNot: [], nextSteps: [] } }))).toBe("");
  });
});
