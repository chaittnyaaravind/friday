import { describe, expect, it } from "vitest";
import { BEST_MIN_SCORE, CLOSING_DAYS, coverageNotes, defaultWindow, firstSeenAfter, HUNT_TABS, huntQuery, isTab, isWindow, startOfDay, todayISODate, WINDOWS } from "./hunt";

const at = (iso: string) => Date.parse(iso);

describe("startOfDay — midnight in Pacific time, whatever the server's clock", () => {
  it("summer (PDT, UTC-7): 13:30 local → midnight is 07:00Z the same day", () => {
    expect(new Date(startOfDay(at("2026-09-27T20:30:45.123Z"))).toISOString()).toBe("2026-09-27T07:00:00.000Z");
  });
  it("winter (PST, UTC-8): 21:10 local → midnight is 08:00Z", () => {
    expect(new Date(startOfDay(at("2026-12-15T05:10:00.000Z"))).toISOString()).toBe("2026-12-14T08:00:00.000Z");
  });
  it("just after midnight local is the start of that same day; just before is the previous day", () => {
    expect(new Date(startOfDay(at("2026-09-27T07:00:01.000Z"))).toISOString()).toBe("2026-09-27T07:00:00.000Z");
    expect(new Date(startOfDay(at("2026-09-27T06:59:59.000Z"))).toISOString()).toBe("2026-09-26T07:00:00.000Z");
  });
  it("is never in the future and never more than a day back", () => {
    for (const iso of ["2026-01-01T00:00:00Z", "2026-03-08T09:59:59Z", "2026-06-30T23:59:59Z", "2026-11-01T08:30:00Z"]) {
      const now = at(iso);
      const s = startOfDay(now);
      expect(s).toBeLessThanOrEqual(now);
      expect(now - s).toBeLessThan(25 * 3_600_000);
    }
  });
});

describe("todayISODate — the Pacific calendar date", () => {
  it("evening Pacific is still 'today' even though UTC has rolled over", () => {
    expect(todayISODate(at("2026-09-28T03:00:00Z"))).toBe("2026-09-27");
    expect(todayISODate(at("2026-09-28T08:00:00Z"))).toBe("2026-09-28");
  });
});

describe("first-seen windows", () => {
  const now = at("2026-09-27T20:30:00.000Z");
  it("each window starts that many minutes ago", () => {
    expect(firstSeenAfter("15m", now)).toBe("2026-09-27T20:15:00.000Z");
    expect(firstSeenAfter("1h", now)).toBe("2026-09-27T19:30:00.000Z");
    expect(firstSeenAfter("6h", now)).toBe("2026-09-27T14:30:00.000Z");
    expect(firstSeenAfter("24h", now)).toBe("2026-09-26T20:30:00.000Z");
  });
  it("'today' starts at Pacific midnight", () => {
    expect(firstSeenAfter("today", now)).toBe("2026-09-27T07:00:00.000Z");
  });
  it("isWindow accepts exactly the defined windows", () => {
    for (const w of Object.keys(WINDOWS)) expect(isWindow(w)).toBe(true);
    for (const w of ["today", "2h", "", undefined, 15, "15M"]) expect(isWindow(w)).toBe(false);
  });
});

describe("defaultWindow — covers two check intervals so one slow check doesn't empty the view", () => {
  it("every 3 hours → 6 hours", () => expect(defaultWindow(180)).toBe("6h"));
  it("every 15 minutes → 1 hour", () => expect(defaultWindow(15)).toBe("1h"));
  it("unknown interval → 24 hours", () => expect(defaultWindow(null)).toBe("24h"));
  it("an interval longer than any window → the largest window", () => expect(defaultWindow(1000)).toBe("24h"));
});

describe("coverageNotes — a short window is never presented as a live feed", () => {
  it("a window shorter than the check interval says it cannot be a live feed", () => {
    const n = coverageNotes({ windowMinutes: 15, pollMinutes: 180, minutesSinceCheck: 20 });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/about every 3 hours/);
    expect(n[0]).toMatch(/not a live feed/i);
  });
  it("a window that spans the check interval needs no caveat", () => {
    expect(coverageNotes({ windowMinutes: 360, pollMinutes: 180, minutesSinceCheck: 20 })).toEqual([]);
  });
  it("a stale last check is called out, in hours once it is long", () => {
    expect(coverageNotes({ windowMinutes: 360, pollMinutes: 180, minutesSinceCheck: 500 })[0]).toMatch(/last successful check was 8 hours ago/);
    expect(coverageNotes({ windowMinutes: 360, pollMinutes: 30, minutesSinceCheck: 90 })[0]).toMatch(/90 minutes ago/);
  });
  it("both caveats can apply at once", () => {
    expect(coverageNotes({ windowMinutes: 15, pollMinutes: 180, minutesSinceCheck: 700 })).toHaveLength(2);
  });
  it("says nothing it cannot know: no interval or no recorded check means no claim", () => {
    expect(coverageNotes({ windowMinutes: 15, pollMinutes: null, minutesSinceCheck: null })).toEqual([]);
    expect(coverageNotes({ windowMinutes: 360, pollMinutes: 180, minutesSinceCheck: null })).toEqual([]);
  });
});

describe("huntQuery — what each tab searches for", () => {
  const now = at("2026-09-27T20:30:00.000Z");
  it("New today: first seen since Pacific midnight, newest first", () => {
    expect(huntQuery("today", "6h", now)).toEqual({ firstSeenAfter: "2026-09-27T07:00:00.000Z", sort: "first_seen" });
  });
  it("Just opened: first seen within the chosen window, newest first", () => {
    expect(huntQuery("just-opened", "1h", now)).toEqual({ firstSeenAfter: "2026-09-27T19:30:00.000Z", sort: "first_seen" });
  });
  it("Closing soon: a stated deadline from today through the next week, soonest first", () => {
    expect(huntQuery("closing", "6h", now)).toEqual({ deadlineAfter: "2026-09-27", deadlineWithinDays: CLOSING_DAYS, sort: "deadline" });
  });
  it("Best matches: the score threshold, best first — and no first-seen restriction", () => {
    expect(huntQuery("best", "6h", now)).toEqual({ minScore: BEST_MIN_SCORE, sort: "match" });
  });
  it("there are exactly four tabs and each one is recognised", () => {
    expect(HUNT_TABS.map((t) => t.id)).toEqual(["today", "just-opened", "closing", "best"]);
    for (const t of HUNT_TABS) expect(isTab(t.id)).toBe(true);
    expect(isTab("nope")).toBe(false);
  });
});
