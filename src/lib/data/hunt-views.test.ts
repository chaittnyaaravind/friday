import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityOf } from "@/lib/discovery/capabilities";
import { minutesAgoLabel, summarizeHealth, type HealthRow } from "@/lib/discovery/health";
import { fakeDb } from "@/lib/discovery/testing/fake-db";
import { invalidFilterParams, parseFilters, searchJobs } from "./jobs";
import { loadSourceHealthByScope, loadSourceStatus } from "./source-status";

const sp = (q: string) => new URLSearchParams(q);
const parse = (q: string) => parseFilters(sp(q));
const NOW_ISO = "2026-09-27T20:30:00.000Z";
const NEW_KEYS = ["firstSeenAfter", "excludeBaseline", "deadlineAfter", "minScore"] as const;

describe("hunt search parameters", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => vi.useRealTimers());

  it("firstSeen=<window> becomes an absolute first-seen instant", () => {
    expect(parse("firstSeen=15m").firstSeenAfter).toBe("2026-09-27T20:15:00.000Z");
    expect(parse("firstSeen=24h").firstSeenAfter).toBe("2026-09-26T20:30:00.000Z");
    expect(parse("firstSeen=today").firstSeenAfter).toBe("2026-09-27T07:00:00.000Z"); // Pacific midnight
  });
  it("closing=<days> means a stated deadline from today through that many days", () => {
    expect(parse("closing=7")).toMatchObject({ deadlineAfter: "2026-09-27", deadlineWithinDays: 7 });
    expect(parse("closing=9999").deadlineWithinDays).toBe(60);
  });
  it("newOnly=1 hides baseline jobs; minScore is clamped to 0–100", () => {
    expect(parse("newOnly=1").excludeBaseline).toBe(true);
    expect(parse("minScore=70").minScore).toBe(70);
    expect(parse("minScore=500").minScore).toBe(100);
    expect(parse("minScore=0").minScore).toBe(0);
  });
  it("first_seen is an accepted sort", () => {
    expect(parse("sort=first_seen").sort).toBe("first_seen");
  });
  it("values it cannot use are dropped, never passed on", () => {
    const f = parse("firstSeen=2h&minScore=abc&closing=x&newOnly=maybe");
    for (const k of NEW_KEYS) expect(f[k], k).toBeUndefined();
  });
  it("EXISTING BEHAVIOR: a request that uses none of them sets none of them, and everything else parses as before", () => {
    const f = parse("q=python&type=internship&miles=25&posted=7&sort=new&limit=20&offset=40");
    for (const k of NEW_KEYS) expect(f[k], k).toBeUndefined();
    expect(f).toMatchObject({ q: "python", types: ["internship"], maxMiles: 25, postedWithinDays: 7, sort: "new", limit: 20, offset: 40 });
  });
  it("invalidFilterParams names the new parameters when they are unusable, and accepts them when valid", () => {
    expect(invalidFilterParams(sp("firstSeen=2h"))).toEqual(["firstSeen"]);
    expect(invalidFilterParams(sp("minScore=-1&closing=abc"))).toEqual(["minScore", "closing"]);
    expect(invalidFilterParams(sp("firstSeen=15m&minScore=70&closing=7&newOnly=1&sort=first_seen"))).toEqual([]);
    expect(invalidFilterParams(sp("firstSeen=today"))).toEqual([]);
  });
});

describe("campus filters (SJSU role and employer)", () => {
  it("campusRole and campusEmployer accept lists of the defined values", () => {
    expect(parse("campusRole=research_assistant,lab_assistant&campusEmployer=library,student_union")).toMatchObject({
      campusRoles: ["research_assistant", "lab_assistant"], campusEmployers: ["library", "student_union"],
    });
  });
  it("values that are not defined roles or employers are dropped, never passed to the database", () => {
    const f = parse("campusRole=astronaut,tutor_mentor&campusEmployer=mars;drop");
    expect(f.campusRoles).toEqual(["tutor_mentor"]);
    expect(f.campusEmployers).toBeUndefined();
  });
  it("invalidFilterParams names them when unusable", () => {
    expect(invalidFilterParams(sp("campusRole=astronaut"))).toEqual(["campusRole"]);
    expect(invalidFilterParams(sp("campusEmployer=library,nope"))).toEqual(["campusEmployer"]);
    expect(invalidFilterParams(sp("campusRole=student_assistant&campusEmployer=peer_connections"))).toEqual([]);
  });
  it("EXISTING BEHAVIOR: without them nothing campus-specific is set", () => {
    const f = parse("q=python&campus=1");
    expect(f.campusRoles).toBeUndefined();
    expect(f.campusEmployers).toBeUndefined();
    expect(f.onCampus).toBe(true);
  });
  it("searchJobs forwards them, and sends null (not an empty list) when none are chosen", async () => {
    const fn = vi.fn(async () => ({ data: [], error: null }));
    await searchJobs({ rpc: fn } as never, { onCampus: true, campusRoles: ["lab_assistant"], campusEmployers: ["library"] });
    expect(fn).toHaveBeenLastCalledWith("search_jobs", expect.objectContaining({ p_campus_roles: ["lab_assistant"], p_campus_employers: ["library"] }));
    await searchJobs({ rpc: fn } as never, { onCampus: true, campusRoles: [] });
    expect(fn).toHaveBeenLastCalledWith("search_jobs", expect.objectContaining({ p_campus_roles: null, p_campus_employers: null }));
  });
});

describe("hide likely blocked", () => {
  it("hideBlocked=1 is parsed; anything else leaves the filter off", () => {
    expect(parse("hideBlocked=1").hideBlocked).toBe(true);
    expect(parse("hideBlocked=true").hideBlocked).toBe(true);
    expect(parse("hideBlocked=0").hideBlocked).toBe(false);
    expect(parse("").hideBlocked).toBeUndefined();
  });
  it("searchJobs forwards it, and sends false when it is not asked for (existing behavior)", async () => {
    const fn = vi.fn(async () => ({ data: [], error: null }));
    await searchJobs({ rpc: fn } as never, {});
    expect(fn).toHaveBeenLastCalledWith("search_jobs", expect.objectContaining({ p_hide_blocked: false }));
    await searchJobs({ rpc: fn } as never, { hideBlocked: true });
    expect(fn).toHaveBeenLastCalledWith("search_jobs", expect.objectContaining({ p_hide_blocked: true }));
  });
});

describe("searchJobs — arguments sent to the search_jobs function", () => {
  const rpc = () => vi.fn(async () => ({ data: [{ id: "j1", total_count: 7 }], error: null }));

  it("EXISTING BEHAVIOR: without hunt filters the new arguments are inert (null / false) and the old ones are unchanged", async () => {
    const fn = rpc();
    const r = await searchJobs({ rpc: fn } as never, { q: "python", types: ["internship"], sort: "new" });
    expect(r).toEqual({ jobs: [{ id: "j1", total_count: 7 }], total: 7 });
    expect(fn).toHaveBeenCalledWith("search_jobs", expect.objectContaining({
      p_q: "python", p_types: ["internship"], p_sort: "new", p_limit: 30, p_offset: 0, p_include_remote: true,
      p_first_seen_after: null, p_exclude_baseline: false, p_deadline_after: null, p_min_score: null,
    }));
  });
  it("forwards the hunt filters", async () => {
    const fn = rpc();
    await searchJobs({ rpc: fn } as never, { firstSeenAfter: "2026-09-27T07:00:00.000Z", excludeBaseline: true, deadlineAfter: "2026-09-27", minScore: 70, sort: "first_seen" });
    expect(fn).toHaveBeenCalledWith("search_jobs", expect.objectContaining({
      p_first_seen_after: "2026-09-27T07:00:00.000Z", p_exclude_baseline: true, p_deadline_after: "2026-09-27", p_min_score: 70, p_sort: "first_seen",
    }));
  });
  it("a minimum score of 0 is sent as 0, not dropped", async () => {
    const fn = rpc();
    await searchJobs({ rpc: fn } as never, { minScore: 0 });
    expect(fn).toHaveBeenCalledWith("search_jobs", expect.objectContaining({ p_min_score: 0 }));
  });
  it("a database error is raised, not swallowed into an empty list", async () => {
    const fn = vi.fn(async () => ({ data: null, error: new Error("function search_jobs does not exist") }));
    await expect(searchJobs({ rpc: fn } as never, {})).rejects.toThrow(/search_jobs/);
  });
});

// ───────────────────────── source status ─────────────────────────
const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const row = (o: Partial<HealthRow> = {}): HealthRow => ({
  source: "greenhouse", scope: "stripe", last_attempt_at: ago(5), last_success_at: ago(5), last_error: null, consecutive_failures: 0,
  last_returned: 3, last_kept: 2, last_closed: 0, close_blocked_reason: null, updated_at: ago(5), ...o,
});
const cadence = (s: string) => (s === "workday" ? 360 : 180);

describe("summarizeHealth", () => {
  it("nothing recorded: zeros and nulls — no invented check time", () => {
    expect(summarizeHealth([], NOW, cadence)).toEqual({ sources: 0, ok: 0, failing: 0, blocked: 0, overdue: 0, lastCheckedAt: null, minutesSinceCheck: null, cadenceMinutes: null, groups: [] });
  });
  it("healthy sources: the latest success anywhere is the 'last check', grouped by kind, biggest group first", () => {
    const s = summarizeHealth([
      row({ scope: "a", last_success_at: ago(40) }),
      row({ scope: "b", last_success_at: ago(10) }),
      row({ source: "lever", scope: "c", last_success_at: ago(100) }),
    ], NOW, cadence);
    expect(s).toMatchObject({ sources: 3, ok: 3, failing: 0, overdue: 0, blocked: 0, minutesSinceCheck: 10, cadenceMinutes: 180 });
    expect(s.lastCheckedAt).toBe(ago(10));
    expect(s.groups).toEqual([
      { source: "greenhouse", sources: 2, failing: 0, lastSuccessAt: ago(10), minutesSinceCheck: 10 },
      { source: "lever", sources: 1, failing: 0, lastSuccessAt: ago(100), minutesSinceCheck: 100 },
    ]);
  });
  it("a failing source is counted as failing, not ok, and does not hide the others' last check", () => {
    const s = summarizeHealth([row({ scope: "a", last_success_at: ago(20) }), row({ scope: "b", last_success_at: ago(1000), consecutive_failures: 3, last_error: "503" })], NOW, cadence);
    expect(s).toMatchObject({ sources: 2, ok: 1, failing: 1, overdue: 0, minutesSinceCheck: 20 });
    expect(s.groups[0]).toMatchObject({ failing: 1 });
  });
  it("overdue = no success within two check intervals but not failing", () => {
    expect(summarizeHealth([row({ last_success_at: ago(300) })], NOW, cadence).overdue).toBe(0); // within 2 × 3h
    expect(summarizeHealth([row({ last_success_at: ago(400) })], NOW, cadence).overdue).toBe(1);
    expect(summarizeHealth([row({ last_success_at: ago(400), consecutive_failures: 1 })], NOW, cadence).overdue).toBe(0); // counted as failing instead
  });
  it("a source that has NEVER succeeded has no check time and is not 'ok'", () => {
    const s = summarizeHealth([row({ last_success_at: null, consecutive_failures: 1, last_error: "404" })], NOW, cadence);
    expect(s).toMatchObject({ ok: 0, failing: 1, lastCheckedAt: null, minutesSinceCheck: null });
    expect(s.groups[0].minutesSinceCheck).toBeNull();
  });
  it("refused closes are surfaced", () => {
    expect(summarizeHealth([row({ close_blocked_reason: "empty_feed" }), row({ scope: "b" })], NOW, cadence).blocked).toBe(1);
  });
  it("the cadence is the slowest configured one, and unknown when none is configured", () => {
    expect(summarizeHealth([row(), row({ source: "workday", scope: "nv" })], NOW, cadence).cadenceMinutes).toBe(360);
    expect(summarizeHealth([row()], NOW, () => null).cadenceMinutes).toBeNull();
  });
});

describe("minutesAgoLabel", () => {
  it.each([
    [null, "not yet"], [0, "just now"], [1, "1 min ago"], [12, "12 min ago"], [59, "59 min ago"],
    [60, "1 h ago"], [179, "2 h ago"], [1439, "23 h ago"], [1440, "1 d ago"], [4000, "2 d ago"],
  ])("%s → %s", (m, label) => expect(minutesAgoLabel(m as number | null)).toBe(label));
});

describe("loading source status", () => {
  it("summarizes source_health with the cadence from the capability registry", async () => {
    const db = fakeDb({ source_health: [row({ scope: "a", last_success_at: ago(15) }), row({ source: "sjsu_page", scope: "sjsu-library", last_success_at: ago(30) })] });
    const s = await loadSourceStatus(db as never, NOW);
    expect(capabilityOf("greenhouse")!.configuredPollMinutes).toBe(180);
    expect(s).toMatchObject({ sources: 2, ok: 2, minutesSinceCheck: 15, cadenceMinutes: 180 });
  });
  it("an empty table is 'no check recorded', not an error", async () => {
    expect(await loadSourceStatus(fakeDb({ source_health: [] }) as never, NOW)).toMatchObject({ sources: 0, lastCheckedAt: null });
  });
  it("health by scope returns only that kind of source, keyed by its scope", async () => {
    const db = fakeDb({ source_health: [row({ source: "sjsu_page", scope: "sjsu-library" }), row({ source: "sjsu_page", scope: "sjsu-writing-center" }), row({ scope: "stripe" })] });
    const m = await loadSourceHealthByScope(db as never, "sjsu_page");
    expect([...m.keys()].sort()).toEqual(["sjsu-library", "sjsu-writing-center"]);
  });
});
