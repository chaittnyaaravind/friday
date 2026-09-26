import { describe, expect, it } from "vitest";
import { analyze, MIN_SAMPLE, type AnalyticsApp } from "./analytics";

const NOW = Date.parse("2026-09-30T12:00:00Z"); // a Wednesday
const app = (status: string, appliedDaysAgo: number | null, source: string | null = "Greenhouse", interviews = 0): AnalyticsApp => ({
  status,
  applied_at: appliedDaysAgo == null ? null : new Date(NOW - appliedDaysAgo * 86_400_000).toISOString(),
  source,
  interviews: Array.from({ length: interviews }, (_, i) => ({ id: String(i) })),
});

describe("analyze — no statistics without data", () => {
  it("empty search: zeros, no rates, an 8-week window of zeros", () => {
    const a = analyze([], NOW);
    expect(a).toMatchObject({ total: 0, applied: 0, enough: false, responseRate: null, interviewRate: null, offerRate: null });
    expect(a.weekly).toHaveLength(8);
    expect(a.weekly.every((w) => w.applied === 0)).toBe(true);
  });
  it("fewer than the minimum sample: counts are shown, rates are withheld", () => {
    const a = analyze([app("interview", 3), app("applied", 2), app("rejected", 9)], NOW);
    expect(a.applied).toBe(3);
    expect(a.applied).toBeLessThan(MIN_SAMPLE);
    expect(a.enough).toBe(false);
    expect(a.responseRate).toBeNull();
    expect(a.interviewRate).toBeNull();
  });
});

describe("analyze — definitions", () => {
  const apps = [
    app("saved", null), // tracked, never applied
    app("preparing", null),
    app("applied", 10),
    app("applied", 12),
    app("rejected", 20), // applied and heard back
    app("assessment", 8),
    app("interview", 6),
    app("final_round", 5),
    app("offer", 30),
    app("applied", 4, "LinkedIn", 1), // a logged interview means an interview happened
  ];
  const a = analyze(apps, NOW);
  it("only counts applications the student actually applied to", () => {
    expect(a.total).toBe(10);
    expect(a.applied).toBe(8);
  });
  it("a rejection is a response; a saved job is not", () => {
    // rejected, assessment, interview, final_round, offer, and the one with a logged interview
    expect(a.responded).toBe(6);
  });
  it("counts interviews from status or from logged interviews, and offers", () => {
    expect(a.interviewed).toBe(4); // interview, final_round, offer, and the one with an interview row
    expect(a.offers).toBe(1);
  });
  it("reports rates once there is enough data, as whole percentages", () => {
    expect(a.enough).toBe(true);
    expect(a.responseRate).toBe(75);
    expect(a.interviewRate).toBe(50);
    expect(a.offerRate).toBe(13);
  });
  it("funnel is monotonic from applied down", () => {
    const [, ap, heard, iv, off] = a.funnel.map((f) => f.count);
    expect(ap >= heard && heard >= iv && iv >= off).toBe(true);
  });
});

describe("analyze — weekly and source breakdowns", () => {
  it("buckets applications into Monday-start weeks and ignores older ones", () => {
    const a = analyze([app("applied", 1), app("applied", 2), app("applied", 9), app("applied", 400)], NOW);
    expect(a.weekly.at(-1)).toEqual({ weekStart: "2026-09-28", applied: 2 });
    expect(a.weekly.reduce((s, w) => s + w.applied, 0)).toBe(3); // the 400-day-old one is outside the window
  });
  it("source performance withholds a rate below the per-source sample", () => {
    const a = analyze([app("interview", 1, "Greenhouse"), app("applied", 2, "Greenhouse"), app("applied", 3, "Greenhouse"), app("interview", 1, "Handshake")], NOW);
    const gh = a.bySource.find((s) => s.source === "Greenhouse")!;
    const hs = a.bySource.find((s) => s.source === "Handshake")!;
    expect(gh).toMatchObject({ applied: 3, interviews: 1, interviewRate: 33 });
    expect(hs.interviewRate).toBeNull();
  });
  it("groups a missing source as 'Unspecified' rather than inventing one", () => {
    expect(analyze([app("applied", 1, null)], NOW).bySource[0].source).toBe("Unspecified");
  });
});
