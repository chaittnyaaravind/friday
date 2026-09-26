import { describe, expect, it } from "vitest";
import type { CandidateItem } from "@/lib/resume/types";
import { matchConcerns, relevantEvidence, targetGraduationYears, type ConcernInput } from "./insights";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const iso = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const input = (job: Partial<ConcernInput["job"]> = {}, profile: Partial<ConcernInput["profile"]> = {}, extra: Partial<ConcernInput> = {}): ConcernInput => ({
  job: { title: "Software Engineering Intern", description: "Build APIs.", isOnCampus: false, isRemote: false, status: "active", discoveredAt: iso(5), lastVerifiedAt: iso(1), deadline: null, ...job },
  profile: { graduationYear: 2027, workAuthorization: "us_citizen", radiusMiles: 30, ...profile },
  distanceMiles: 5,
  missingRequired: [],
  ...extra,
});
const texts = (i: ConcernInput) => matchConcerns(i, NOW).map((c) => c.text);

describe("targetGraduationYears", () => {
  it("reads the years a posting targets", () => {
    expect(targetGraduationYears("Open to students graduating between December 2026 and June 2027.")).toEqual([2026, 2027]);
    expect(targetGraduationYears("Expected graduation in 2028")).toEqual([2028]);
  });
  it("ignores years that are not graduation targets, and past tense", () => {
    expect(targetGraduationYears("Founded in 2015. Great team.")).toEqual([]);
    expect(targetGraduationYears("Our engineers graduated in 2019 from top schools.")).toEqual([]);
  });
});

describe("matchConcerns — honest, evidence-based", () => {
  it("returns nothing for a clean, fresh, close, matching posting", () => {
    expect(texts(input())).toEqual([]);
  });
  it("flags a graduation-year mismatch using the student's own profile, and stays quiet when it fits", () => {
    expect(texts(input({ description: "Students graduating in 2028." }))).toContain("Targets students graduating in 2028; your profile says 2027.");
    expect(texts(input({ description: "Students graduating between Dec 2026 and June 2027." }))).toEqual([]);
    expect(texts(input({ description: "Students graduating in 2028." }, { graduationYear: null }))).toEqual([]); // no claim without data
  });
  it("flags advanced degrees, years of experience, and authorization limits (F-1 wording is specific)", () => {
    expect(texts(input({ description: "Currently pursuing a Ph.D. in CS." })).join(" ")).toMatch(/Ph\.D\./);
    expect(texts(input({ description: "Requires 5+ years of professional experience." })).join(" ")).toMatch(/5\+ years/);
    const f1 = texts(input({ description: "Must be a U.S. citizen. No sponsorship." }, { workAuthorization: "f1" })).join(" ");
    expect(f1).toMatch(/F-1/);
    expect(texts(input({ description: "Must be a U.S. citizen." }, { workAuthorization: "us_citizen" })).join(" ")).not.toMatch(/F-1/);
  });
  it("lists missing required skills, warning only when several", () => {
    const one = matchConcerns(input({}, {}, { missingRequired: ["Kubernetes"] }), NOW);
    expect(one[0]).toMatchObject({ severity: "info" });
    const many = matchConcerns(input({}, {}, { missingRequired: ["A", "B", "C"] }), NOW);
    expect(many[0]).toMatchObject({ severity: "warn" });
  });
  it("uses freshness evidence: stale, closed and expired postings are called out", () => {
    expect(texts(input({ lastVerifiedAt: iso(24 * 20) })).join(" ")).toMatch(/may have closed/);
    expect(texts(input({ status: "closed" })).join(" ")).toMatch(/^Closed/);
    expect(texts(input({ status: "expired" })).join(" ")).toMatch(/^Expired/);
  });
  it("flags far on-site roles but not remote or on-campus ones", () => {
    expect(texts(input({}, {}, { distanceMiles: 80 })).join(" ")).toMatch(/80 miles away, outside your 30-mile radius/);
    expect(texts(input({ isRemote: true }, {}, { distanceMiles: 80 }))).toEqual([]);
    expect(texts(input({ isOnCampus: true }, {}, { distanceMiles: 80 }))).toEqual([]);
  });
  it("flags an imminent deadline", () => {
    expect(texts(input({ deadline: "2026-09-28" })).join(" ")).toMatch(/deadline is in 2 days/);
    expect(texts(input({ deadline: "2026-12-01" }))).toEqual([]);
  });
});

const item = (section: CandidateItem["section"], data: unknown, status: CandidateItem["status"] = "user_confirmed"): CandidateItem =>
  ({ id: Math.random().toString(36), section, position: 0, data, source: "uploaded_resume", source_text: null, source_resume_id: null, status, note: null, created_at: "" }) as CandidateItem;

describe("relevantEvidence — only the student's own confirmed words", () => {
  const items = [
    item("experience", { title: "Software Engineering Intern", organization: "Acme", location: null, start: null, end: null, bullets: ["Built REST APIs in Node.js and PostgreSQL", "Wrote Jest tests"] }),
    item("experience", { title: "Barista", organization: "Cafe", location: null, start: null, end: null, bullets: ["Made coffee"] }),
    item("project", { name: "CampusEats", technologies: ["React", "Node.js", "Docker"], date: null, link: null, bullets: [] }),
    item("project", { name: "Unconfirmed", technologies: ["Python"], date: null, link: null, bullets: [] }, "requires_confirmation"),
  ];
  it("links matched skills to the experience and projects that actually mention them", () => {
    const ev = relevantEvidence(items, ["Node.js", "PostgreSQL", "React", "Python"]);
    expect(ev.experience).toEqual([{ title: "Software Engineering Intern", organization: "Acme", skills: ["Node.js", "PostgreSQL"] }]);
    expect(ev.projects).toEqual([{ name: "CampusEats", skills: ["Node.js", "React"] }]);
  });
  it("ignores unconfirmed items and irrelevant experience", () => {
    const ev = relevantEvidence(items, ["Python"]);
    expect(ev.projects).toEqual([]);
    expect(ev.experience).toEqual([]);
  });
  it("does not match a skill inside a longer word (Java vs JavaScript)", () => {
    const js = [item("project", { name: "Site", technologies: ["JavaScript"], date: null, link: null, bullets: [] })];
    expect(relevantEvidence(js, ["Java"]).projects).toEqual([]);
    expect(relevantEvidence(js, ["JavaScript"]).projects).toHaveLength(1);
  });
});
