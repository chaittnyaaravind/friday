import { describe, expect, it } from "vitest";
import { canonicalUrl, companySlug, findDuplicate, isSameJob, normalizeCompany, titleSimilarity, titleTokens, type JobKey } from "./dedupe";

const job = (o: Partial<JobKey> = {}): JobKey => ({ company: "NVIDIA", title: "Software Engineer Intern", city: "Santa Clara", remote: false, url: null, ...o });

describe("normalizeCompany", () => {
  it("collapses legal forms, punctuation, case and 'the'", () => {
    expect(normalizeCompany("NVIDIA Corporation")).toBe("nvidia");
    expect(normalizeCompany("Stripe, Inc.")).toBe("stripe");
    expect(normalizeCompany("The Trade Desk, LLC")).toBe("trade desk");
    expect(normalizeCompany("AT&T Inc")).toBe("at and t");
    expect(normalizeCompany("Cockroach Labs")).toBe("cockroach labs");
    expect(normalizeCompany(null)).toBe("");
  });
  it("gives the same slug for the same employer written differently", () => {
    expect(companySlug("NVIDIA Corporation")).toBe(companySlug("nvidia"));
    expect(companySlug("Stripe, Inc.")).toBe("stripe");
  });
});

describe("titleSimilarity", () => {
  it("'Software Engineer Intern — NVIDIA' and 'NVIDIA Software Engineer Internship' are the same title", () => {
    expect(titleSimilarity("Software Engineer Intern — NVIDIA", "NVIDIA Software Engineer Internship", "NVIDIA")).toBe(1);
  });
  it("treats engineer/engineering/developer and internship/intern as equivalent, and ignores season and year", () => {
    expect(titleSimilarity("Software Engineering Intern (Summer 2027)", "Software Developer Internship", "Acme")).toBe(1);
    expect(titleSimilarity("SWE Intern - Fall 2026", "Software Engineer Intern", "Acme")).toBe(1);
  });
  it("similar-looking titles for DIFFERENT jobs stay apart", () => {
    expect(titleSimilarity("Software Engineer Intern", "Hardware Engineer Intern", "Acme")).toBeLessThan(0.8);
    expect(titleSimilarity("Data Science Intern", "Data Engineer Intern", "Acme")).toBeLessThan(0.8);
    expect(titleSimilarity("Machine Learning Intern", "Marketing Intern", "Acme")).toBeLessThan(0.5);
  });
  it("different seniority/level is never the same job", () => {
    expect(titleSimilarity("Software Engineer", "Senior Software Engineer")).toBe(0);
    expect(titleSimilarity("Software Engineer I", "Software Engineer II")).toBe(0);
    expect(titleSimilarity("Software Engineer Intern", "Staff Software Engineer Intern")).toBe(0);
  });
  it("tokens drop the company name and stop words", () => {
    expect(titleTokens("NVIDIA Software Engineer Internship", "NVIDIA").sort()).toEqual(["engineer", "intern", "software"]);
  });
});

describe("canonicalUrl", () => {
  it("ignores tracking parameters, fragments, www and trailing slashes", () => {
    const a = canonicalUrl("https://www.Example.com/jobs/123/?utm_source=x&ref=y&gh_src=z#apply");
    expect(a).toBe("example.com/jobs/123");
    expect(canonicalUrl("http://example.com/jobs/123")).toBe(a);
  });
  it("keeps parameters that identify the job, in a stable order", () => {
    expect(canonicalUrl("https://x.com/careers?gh_jid=42&b=2&a=1")).toBe("x.com/careers?a=1&b=2&gh_jid=42");
    expect(canonicalUrl("https://x.com/careers?gh_jid=42")).not.toBe(canonicalUrl("https://x.com/careers?gh_jid=43"));
  });
  it("rejects non-web and malformed addresses", () => {
    for (const bad of ["javascript:alert(1)", "not a url", "", null, undefined]) expect(canonicalUrl(bad as string)).toBeNull();
  });
});

describe("isSameJob — the four dedupe cases", () => {
  it("1) the same job from two providers: same employer (written differently), same city, equivalent title", () => {
    expect(isSameJob(job({ company: "NVIDIA", title: "Software Engineer Intern" }), job({ company: "NVIDIA Corporation", title: "NVIDIA Software Engineer Internship" }))).toBe(true);
  });
  it("2) the same canonical URL is the same job even when the titles differ", () => {
    expect(isSameJob(job({ title: "Intern A", url: "https://boards.greenhouse.io/x/jobs/9?utm_source=li" }), job({ company: "Other", title: "Totally Different", city: "Austin", url: "https://boards.greenhouse.io/x/jobs/9" }))).toBe(true);
  });
  it("3) similar title but a different employer is a different job", () => {
    expect(isSameJob(job({ company: "NVIDIA" }), job({ company: "AMD" }))).toBe(false);
  });
  it("4) similar title at the same employer in a different city is a different job", () => {
    expect(isSameJob(job({ city: "Santa Clara" }), job({ city: "Austin" }))).toBe(false);
  });
  it("two remote listings at the same employer can match; an unknown city never matches on the title alone", () => {
    expect(isSameJob(job({ city: null, remote: true }), job({ city: null, remote: true }))).toBe(true);
    expect(isSameJob(job({ city: null }), job({ city: null }))).toBe(false);
    expect(isSameJob(job({ city: null }), job({ city: "Santa Clara" }))).toBe(false);
  });
  it("different seniority at the same employer and place is a different job", () => {
    expect(isSameJob(job({ title: "Software Engineer" }), job({ title: "Senior Software Engineer" }))).toBe(false);
  });
});

describe("findDuplicate", () => {
  const known = [
    { id: "a", ...job({ title: "Hardware Engineer Intern" }) },
    { id: "b", ...job({ title: "Software Engineering Internship" }) },
    { id: "c", ...job({ company: "AMD", title: "Software Engineer Intern" }) },
  ];
  it("returns the matching known job", () => {
    expect(findDuplicate(job({ company: "NVIDIA Corp.", title: "Software Engineer Intern" }), known)?.id).toBe("b");
  });
  it("returns null when nothing matches", () => {
    expect(findDuplicate(job({ title: "Quantum Physicist Intern" }), known)).toBeNull();
  });
  it("prefers an exact URL match", () => {
    const withUrl = [...known, { id: "d", ...job({ title: "Something Else", url: "https://x.com/j/1" }) }];
    expect(findDuplicate(job({ title: "Software Engineer Intern", url: "https://www.x.com/j/1/?utm_medium=z" }), withUrl)?.id).toBe("d");
  });
});
