/** Render tests: what a student reads in the tailoring report, and that nothing is claimed that the report does not say. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildResume } from "@/lib/resume/generate";
import { buildTailoringReport, reportSummary } from "@/lib/resume/report";
import { buildTailored, tailorProposal, type TailorJob } from "@/lib/resume/tailor";
import { applyTerminology } from "@/lib/resume/terminology";
import type { CandidateItem, Section } from "@/lib/resume/types";
import { TailorReview } from "./tailor";
import { TailoringReportPanel, TerminologyChanges } from "./report-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, back: () => {} }) }));

let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `it-${++n}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const ITEMS: CandidateItem[] = [
  item("personal", { field: "name", value: "Sam Student" }),
  item("experience", { title: "Backend Intern", organization: "Acme", location: "San Jose, CA", start: "Jun 2025", end: "Aug 2025", bullets: ["Built REST API services in nodejs and deployed them to k8s"] }),
  item("skill", { name: "nodejs", group: "Backend" }), item("skill", { name: "k8s", group: "DevOps" }), item("skill", { name: "Python", group: "Languages" }),
];
const JOB: TailorJob = {
  id: "job-1", title: "Software Engineering Intern", company: "Example Co",
  description: "Minimum qualifications\n• Node.js\n• Kubernetes\n• Docker\nYou will build services with Node.js on Kubernetes.",
  requirements: ["Node.js", "Kubernetes", "Docker"],
};

const proposal = tailorProposal(ITEMS, JOB);
const { doc, changes } = applyTerminology(buildTailored(ITEMS, proposal, []), [JOB.title, JOB.description].join("\n"));
const report = buildTailoringReport({ job: JOB, baseline: { doc: buildResume(ITEMS), source: "profile", versionId: null }, tailored: doc, items: ITEMS, proposal, terminology: changes });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ").trim();

describe("TailoringReportPanel", () => {
  const t = text(createElement(TailoringReportPanel, { report, createdAt: "2026-09-27T20:00:00Z", verifiedNow: { ok: true, issues: [] } }));

  it("opens with the same one-line summary the report stores, the job, the date and what it was compared with", () => {
    expect(t).toContain(reportSummary(report));
    expect(t).toContain("Software Engineering Intern at Example Co");
    expect(t).toContain("Sep 27, 2026");
    expect(t).toContain("a resume built from your whole profile");
  });
  it("lists every requirement with its status, and says missing ones were NOT added", () => {
    for (const r of report.requirements) expect(t).toContain(r.name);
    expect(t).toContain("Not on your resume");
    expect(t).toMatch(/Not added to your resume: .*Docker/);
    expect(t).toContain("won't write a skill you haven't confirmed");
  });
  it("shows each ATS spelling change with the skill, both spellings and the line after", () => {
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) { expect(t).toContain(c.from); expect(t).toContain(c.to); expect(t).toContain(c.after); }
    expect(t).toContain("None of these adds a skill you didn't already list");
  });
  it("says every line is supported when the fresh check passes", () => {
    expect(t).toContain("Every line on this resume is supported by your profile");
  });
  it("lists the claims without evidence when the fresh check FAILS (e.g. after the student edited a line)", () => {
    const bad = text(createElement(TailoringReportPanel, { report, createdAt: "2026-09-27T20:00:00Z", verifiedNow: { ok: false, issues: [{ claim: "Rust", where: "Experience · Backend Intern", text: "Built services in Rust", reason: "Rust is not in your confirmed profile" }] } }));
    expect(bad).toContain("1 claim without supporting evidence");
    expect(bad).toContain("“Rust” in Experience · Backend Intern — Rust is not in your confirmed profile");
    expect(bad).not.toContain("Every line on this resume is supported");
  });
  it("names a master resume as the baseline when one was used", () => {
    const m = text(createElement(TailoringReportPanel, { report: { ...report, baseline: { source: "master", versionId: "m-1" } }, createdAt: "2026-09-27T20:00:00Z", verifiedNow: { ok: true, issues: [] } }));
    expect(m).toContain("compared with your master resume");
  });
});

describe("TerminologyChanges", () => {
  it("says so plainly when nothing was renamed", () => {
    expect(text(createElement(TerminologyChanges, { changes: [] }))).toContain("No spelling changes");
  });
});

describe("TailorReview — the preview shows spelling changes BEFORE anything is created", () => {
  it("renders the ATS spelling group when there are changes, and not when there are none", () => {
    const withTerms = text(createElement(TailorReview, { proposal, terminology: changes }));
    expect(withTerms).toContain("ATS spelling");
    expect(withTerms).toContain("Nothing is created or sent until you accept");
    expect(text(createElement(TailorReview, { proposal }))).not.toContain("ATS spelling");
  });
});
