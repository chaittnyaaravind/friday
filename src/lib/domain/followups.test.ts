import { describe, expect, it } from "vitest";
import { isTerminal, plannedFollowUps } from "./followups";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("plannedFollowUps", () => {
  it("suggests a check-in 7 days after the student marks an application applied", () => {
    expect(plannedFollowUps({ from: "ready", to: "applied", now: NOW })).toEqual([{ kind: "follow_up", dueAt: day(7), note: "Check in on your application" }]);
  });
  it("suggests a recruiter-reply reminder 3 days after an assessment starts", () => {
    expect(plannedFollowUps({ from: "applied", to: "assessment", now: NOW })).toEqual([expect.objectContaining({ kind: "recruiter_response", dueAt: day(3) })]);
  });
  it("plans interview prep the day before a scheduled interview", () => {
    const plan = plannedFollowUps({ from: "applied", to: "interview", interviewAt: day(5), now: NOW });
    expect(plan.find((p) => p.kind === "interview_prep")?.dueAt).toBe(day(4));
  });
  it("never schedules prep in the past: an interview tomorrow morning is prepped within the hour", () => {
    const soon = new Date(NOW + 6 * 3_600_000).toISOString();
    const due = plannedFollowUps({ from: "interview", to: "interview", interviewAt: soon, now: NOW }).find((p) => p.kind === "interview_prep")!.dueAt;
    expect(Date.parse(due)).toBe(NOW + 3_600_000);
  });
  it("ignores interviews already in the past", () => {
    expect(plannedFollowUps({ from: "interview", to: "interview", interviewAt: day(-2), now: NOW })).toEqual([]);
  });
  it("without a date, moving into interview/final round still suggests prep in 2 days", () => {
    expect(plannedFollowUps({ from: "assessment", to: "final_round", now: NOW })).toEqual([expect.objectContaining({ kind: "interview_prep", dueAt: day(2) })]);
  });
  it("suggests nothing when the status did not change (no duplicate check-ins from edits)", () => {
    expect(plannedFollowUps({ from: "applied", to: "applied", now: NOW })).toEqual([]);
  });
  it("suggests nothing for saving, preparing, offers or rejections", () => {
    for (const to of ["saved", "preparing", "ready", "offer", "rejected", "withdrawn"]) expect(plannedFollowUps({ from: null, to, now: NOW })).toEqual([]);
  });
});

describe("isTerminal", () => {
  it("offer, rejected and withdrawn end the pipeline", () => {
    expect(["offer", "rejected", "withdrawn"].every(isTerminal)).toBe(true);
    expect(["saved", "applied", "interview", "final_round", null, undefined].some(isTerminal)).toBe(false);
  });
});
