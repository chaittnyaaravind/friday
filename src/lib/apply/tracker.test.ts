import { describe, expect, it } from "vitest";
import { attentionReason, matchesFilter, stageOf, type TrackerApp } from "./tracker";

const NOW = Date.parse("2026-10-22T18:00:00Z");
const app = (o: Partial<TrackerApp> = {}): TrackerApp => ({ status: "saved", applied_at: null, resume_version_id: null, submission_evidence: null, updated_at: "2026-10-20T00:00:00Z", follow_ups: [], jobs: null, ...o });

describe("stageOf — what the card says", () => {
  it("'applied' without evidence is 'Submitted · unverified', never confirmed", () => {
    expect(stageOf(app({ status: "applied" }))).toEqual({ label: "Submitted · unverified", tone: "amber" });
    expect(stageOf(app({ status: "applied", submission_evidence: "   " })).label).toBe("Submitted · unverified");
    expect(stageOf(app({ status: "applied", submission_evidence: "Confirmation #A123" }))).toEqual({ label: "Submitted · confirmed", tone: "moss" });
  });
  it("names the earlier stages", () => {
    expect(stageOf(app()).label).toBe("Discovered");
    expect(stageOf(app({ resume_version_id: "v1" })).label).toBe("Resume ready");
    expect(stageOf(app({ status: "preparing" })).label).toBe("Needs review");
    expect(stageOf(app({ status: "ready" })).label).toBe("Awaiting your submission");
    expect(stageOf(app({ status: "closed" })).label).toBe("Listing closed");
  });
});

describe("tracker filters", () => {
  it("closing soon / needs attention use the listing's deadline", () => {
    const soon = app({ jobs: { deadline: "2026-10-24", status: "active" } });
    expect(matchesFilter(soon, "closing", NOW)).toBe(true);
    expect(attentionReason(soon, NOW)).toBe("Closes 2026-10-24");
    expect(matchesFilter(app({ jobs: { deadline: "2026-12-24", status: "active" } }), "closing", NOW)).toBe(false);
    expect(matchesFilter(app({ status: "applied", jobs: { deadline: "2026-10-24", status: "active" } }), "closing", NOW)).toBe(false); // already submitted
  });
  it("high-paying counts only STATED hourly pay; unknown pay is never high", () => {
    expect(matchesFilter(app({ jobs: { deadline: null, status: "active", pay_hourly_max: 22 } }), "high_pay", NOW)).toBe(true);
    expect(matchesFilter(app({ jobs: { deadline: null, status: "active", pay_hourly_max: null, pay_hourly_min: null } }), "high_pay", NOW)).toBe(false);
  });
  it("front desk, newly posted, active and needs-attention", () => {
    expect(matchesFilter(app({ jobs: { deadline: null, status: "active", campus_roles: ["front_desk_admin", "student_assistant"] } }), "front_desk", NOW)).toBe(true);
    expect(matchesFilter(app({ jobs: { deadline: null, status: "active", campus_roles: ["fitness_recreation"] } }), "front_desk", NOW)).toBe(false);
    expect(matchesFilter(app({ jobs: { deadline: null, status: "active", discovered_at: "2026-10-21T00:00:00Z" } }), "new", NOW)).toBe(true);
    expect(matchesFilter(app({ status: "rejected" }), "active", NOW)).toBe(false);
    expect(matchesFilter(app({ status: "applied" }), "attention", NOW)).toBe(true); // no confirmation recorded
    expect(matchesFilter(app({ status: "interview", follow_ups: [{ due_at: "2026-10-01T00:00:00Z", done_at: null }] }), "attention", NOW)).toBe(true);
  });
});
