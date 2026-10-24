import { describe, expect, it } from "vitest";
import { campusOverview, type OverviewJob } from "./campus-overview";

const NOW = Date.parse("2026-10-22T18:00:00Z");
const j = (id: string, o: Partial<OverviewJob> = {}): OverviewJob => ({ id, title: `Job ${id}`, company: "SJSU Library", excluded_reason: null, deadline: null, discovered_at: "2026-09-01T00:00:00Z", is_baseline: true, pay_hourly_min: null, pay_hourly_max: null, ...o });

describe("campusOverview", () => {
  it("never counts excluded jobs as listings, and reports them separately", () => {
    const o = campusOverview([j("a"), j("b", { excluded_reason: "dining: …", pay_hourly_max: 30, discovered_at: "2026-10-21T00:00:00Z", is_baseline: false })], [], [], NOW);
    expect(o).toMatchObject({ open: 1, excluded: 1, newThisWeek: [] });
    expect(o.pay.max).toBeNull(); // the excluded job's $30 is not shown as campus pay
  });
  it("pay range uses stated hourly pay only and counts the unknowns", () => {
    const o = campusOverview([j("a", { pay_hourly_min: 17.5, pay_hourly_max: 19 }), j("b", { pay_hourly_min: 22, pay_hourly_max: 22 }), j("c")], [], [], NOW);
    expect(o.pay).toEqual({ stated: 2, unknown: 1, min: 17.5, max: 22 });
  });
  it("new this week excludes baseline finds; changes and deadlines are from the last week / next two weeks", () => {
    const jobs = [j("new", { is_baseline: false, discovered_at: "2026-10-20T00:00:00Z" }), j("old", { is_baseline: false, discovered_at: "2026-09-01T00:00:00Z" }), j("soon", { deadline: "2026-10-30" }), j("late", { deadline: "2027-01-30" })];
    const events = [{ job_id: "old", kind: "updated", created_at: "2026-10-21T00:00:00Z", changes: { pay_text: { from: "$18/hr", to: "$19/hr" } } }, { job_id: "late", kind: "updated", created_at: "2026-09-01T00:00:00Z", changes: { title: {} } }];
    const o = campusOverview(jobs, events, [], NOW);
    expect(o.newThisWeek.map((x) => x.id)).toEqual(["new"]);
    expect(o.changed).toEqual([{ id: "old", title: "Job old", what: ["pay"] }]);
    expect(o.closing.map((x) => x.id)).toEqual(["soon"]);
  });
  it("application progress separates unverified from confirmed submissions; an empty catalog is all zeros", () => {
    const o = campusOverview([j("a"), j("b")], [], [{ status: "applied", submission_evidence: null, job_id: "a" }, { status: "applied", submission_evidence: "Conf #1", job_id: "b" }, { status: "applied", submission_evidence: null, job_id: "off-campus" }], NOW);
    expect(o.applications).toEqual({ tracked: 2, preparing: 0, submittedUnverified: 1, submittedConfirmed: 1, interviewing: 0 });
    expect(campusOverview([], [], [], NOW)).toMatchObject({ open: 0, excluded: 0, pay: { stated: 0, unknown: 0, min: null, max: null }, closing: [], changed: [] });
  });
});
