/**
 * The SJSU campus hunter end to end: an SJSU source → normalize → exclude → store → re-match → alerts → search filter,
 * against the in-memory database. What is proven: dining jobs are excluded in the BACKEND (stored with the reason, never
 * matched, ranked or alerted), office jobs stay, repeated and re-formatted imports never duplicate, new / changed /
 * failed runs behave, and pay is only ever what the posting states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawPosting } from "./sources";
import { fakeDb, type FakeDb } from "./testing/fake-db";

const h = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./sources", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sources")>()), ADAPTERS: { pinpoint: h.adapter } }));

const { runDiscovery } = await import("./agent");
const { SourceError } = await import("./sources");
const { parseFilters, invalidFilterParams } = await import("@/lib/data/jobs");

const DESK = "Greet visitors at the front desk, answer phones and email, schedule room reservations and do data entry in Google Sheets. Pay: $18.50 - $20.00 per hour. Up to 15 hours per week.";
const campus = (o: Partial<RawPosting> & { title: string }): RawPosting => ({
  source: "pinpoint", sourceName: "SJSU Student Union (Pinpoint)", externalId: `su:${o.title}`, applyUrl: `https://sjsustudentunion.pinpointhq.com/postings/${encodeURIComponent(o.title)}`,
  sourceUrl: "https://sjsustudentunion.pinpointhq.com/en", locationText: "San Jose, CA", department: "Student Union", description: DESK, postedAt: null,
  deadline: "2026-11-30", commitment: "Part-time", payText: null, isRemoteHint: false, onCampus: true, ...o,
});
const POSTINGS = () => [
  campus({ title: "Information Desk Assistant" }),
  campus({ title: "IT Help Desk Student Assistant", description: "Troubleshoot computers and answer tickets at the help desk. Records requests in the ticketing system. $21 per hour." }),
  campus({ title: "Dining Commons Cook", description: "Prepare food and clean the kitchen. $24 per hour." }),
  campus({ title: "Barista", department: "Student Union Cafe", description: "Make coffee drinks. $19 per hour." }),
  campus({ title: "Student Assistant", department: "Catering", description: "Set up catering events, serve food and wash dishes." }),
  campus({ title: "Event Setup Crew", description: "Set up tables and chairs for events and lift up to 50 lbs. $19 per hour." }),
];
const PROFILE = { id: "u1", onboarded_at: "2026-09-01", major: "Computer Science", origin_lat: 37.3352, origin_lng: -121.8811, radius_miles: 25, workplace: "any", desired_titles: [], work_authorization: "f1", graduation_year: 2027, profile_skills: [], notification_prefs: {}, campus_prefs: { roles: ["front_desk_admin", "it_support"] } };

let db: FakeDb;
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const crawl = () => runDiscovery(db as never, { trigger: "manual", companySlugs: ["sjsu-student-union"] });
const job = (title: string) => db.tables.jobs.find((j) => j.title === title)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-10-22T12:00:00.000Z");
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.adapter.mockReset();
  db = fakeDb({ profiles: [{ ...PROFILE }], jobs: [], job_sources: [], job_requirements: [], job_events: [], job_matches: [], company_watchlists: [], notifications: [], agent_runs: [], source_health: [], source_capabilities: [], applications: [] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("dining exclusion happens in the backend pipeline", () => {
  it("dining jobs are stored WITH a reason (so their open/closed state stays true) and reported; office jobs are not excluded", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    const r = await crawl();
    expect(r.failures).toEqual([]);
    expect(r.excluded).toEqual({ dining: 3 });
    // (staff positions are covered in exclusions.test.ts)
    for (const t of ["Dining Commons Cook", "Barista", "Student Assistant"]) expect(job(t).excluded_reason).toMatch(/^dining: /);
    for (const t of ["Information Desk Assistant", "IT Help Desk Student Assistant", "Event Setup Crew"]) expect(job(t).excluded_reason).toBeNull();
  });

  it("excluded jobs get NO match, NO campus fit and NO alert; eligible campus jobs get all three", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    expect(db.tables.notifications.find((n) => n.kind === "digest")?.title).toBe("FRIDAY found 3 new opportunities today."); // excluded jobs are not counted
    const announced = db.tables.notifications.filter((n) => n.kind === "new_on_campus").map((n) => (n.title as string).replace(/^New SJSU on-campus job: /, ""));
    expect(announced.sort()).toEqual(["Event Setup Crew", "IT Help Desk Student Assistant", "Information Desk Assistant"]);
    db.tables.notifications.length = 0;
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockResolvedValue([...POSTINGS(), campus({ title: "Kitchen Assistant", description: "Wash dishes." }), campus({ title: "Library Circulation Assistant" })]);
    await crawl();
    const matched = new Set(db.tables.job_matches.map((m) => m.job_id));
    for (const j of db.tables.jobs) expect(matched.has(j.id), j.title as string).toBe(!j.excluded_reason);
    const notified = db.tables.notifications.filter((n) => n.kind === "new_on_campus").map((n) => n.title);
    expect(notified).toEqual(["New SJSU on-campus job: Library Circulation Assistant"]); // the new Kitchen Assistant is not announced
    const desk = db.tables.job_matches.find((m) => m.job_id === job("Information Desk Assistant").id)!;
    expect(desk.campus_fit).toEqual(expect.any(Number));
    expect((desk.campus_fit_breakdown as { parts: { points: number }[] }).parts.reduce((s, p) => s + p.points, 0)).toBe(desk.campus_fit);
  });

  it("the preferred, desk-based, better-paid job ranks above the physically demanding one", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    const fitOf = (t: string) => db.tables.job_matches.find((m) => m.job_id === job(t).id)!.campus_fit as number;
    expect(fitOf("IT Help Desk Student Assistant")).toBeGreaterThan(fitOf("Event Setup Crew"));
    expect(fitOf("Information Desk Assistant")).toBeGreaterThan(fitOf("Event Setup Crew"));
    expect(job("Event Setup Crew")).toMatchObject({ physical_demand: "high" });
    expect(job("Information Desk Assistant")).toMatchObject({ physical_demand: "low" });
  });
});

describe("pay is only what the posting states", () => {
  it("a stated hourly range is stored as hourly pay; no stated pay stays unknown (null), never 0 or a guess", async () => {
    h.adapter.mockResolvedValue([campus({ title: "Information Desk Assistant" }), campus({ title: "Office Assistant", description: "Answer phones and file records for the office. Training provided." }), campus({ title: "Lab Monitor", description: "Monitor the lab. Stipend of $500." })]);
    await crawl();
    expect(job("Information Desk Assistant")).toMatchObject({ pay_hourly_min: 18.5, pay_hourly_max: 20, pay_text: "$18.50–$20/hr" });
    expect(job("Office Assistant")).toMatchObject({ pay_hourly_min: null, pay_hourly_max: null, pay_text: null });
    expect(job("Lab Monitor")).toMatchObject({ pay_hourly_min: null, pay_hourly_max: null, pay_text: null }); // "$500" with no unit is not pay
  });
});

describe("refresh: duplicates, new, changed, failed", () => {
  it("re-running the same feed — even with re-formatted titles and tracking parameters — never inserts a duplicate", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    const count = db.tables.jobs.length;
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockResolvedValue(POSTINGS().map((p) => ({ ...p, title: `  ${p.title.toUpperCase()}  `.replace(" ", "  "), applyUrl: `${p.applyUrl}?utm_source=x` })));
    const r = await crawl();
    expect(r.created).toBe(0);
    expect(db.tables.jobs).toHaveLength(count);
  });

  it("a newly posted job is detected as new (not baseline) on the next refresh", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockResolvedValue([...POSTINGS(), campus({ title: "Library Circulation Assistant" })]);
    const r = await crawl();
    expect(r).toMatchObject({ created: 1, baseline: 0 });
    expect(job("Library Circulation Assistant").is_baseline).not.toBe(true);
  });

  it("changed pay is an 'updated' event naming pay; the stored hourly pay follows", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockResolvedValue(POSTINGS().map((p) => (p.title === "Information Desk Assistant" ? { ...p, description: DESK.replace("$18.50 - $20.00", "$19.50 - $21.00") } : p)));
    const r = await crawl();
    expect(r.updated).toBe(1);
    const ev = db.tables.job_events.find((e) => e.kind === "updated")!;
    expect(Object.keys(ev.changes as object)).toEqual(expect.arrayContaining(["pay_text", "description"]));
    expect(job("Information Desk Assistant")).toMatchObject({ pay_hourly_min: 19.5, pay_hourly_max: 21 });
  });

  it("a failed refresh closes nothing and is recorded as a source failure", async () => {
    h.adapter.mockResolvedValue(POSTINGS());
    await crawl();
    const before = JSON.stringify(db.tables.jobs);
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockRejectedValue(new SourceError("503 Service Unavailable", "https://sjsustudentunion.pinpointhq.com/postings.json", 503));
    const r = await crawl();
    expect(r.failures).toEqual([{ company: "sjsu-student-union", error: "503 Service Unavailable" }]);
    expect(JSON.stringify(db.tables.jobs)).toBe(before);
    expect(db.tables.source_health.find((s) => s.scope === "sjsu-student-union")).toMatchObject({ consecutive_failures: 1 });
  });

  it("an expired / removed listing is closed only when the source really stopped listing it (small source, successful read)", async () => {
    h.adapter.mockResolvedValue(POSTINGS().slice(0, 2));
    await crawl();
    at("2026-10-22T15:00:00.000Z");
    h.adapter.mockResolvedValue(POSTINGS().slice(0, 1));
    const r = await crawl();
    expect(r.closed).toBe(1);
    expect(job("IT Help Desk Student Assistant").status).toBe("closed");
    expect(job("Information Desk Assistant").status).toBe("active");
  });
});

describe("search parameters for the campus page", () => {
  it("pay and fit sorts, a pay floor and the physical filter are parsed; bad values are rejected, not passed on", () => {
    const f = parseFilters(new URLSearchParams("sort=pay&minPay=20&physical=low,unknown"));
    expect(f).toMatchObject({ sort: "pay", minHourly: 20, physical: ["low", "unknown"] });
    expect(parseFilters(new URLSearchParams("sort=fit")).sort).toBe("fit");
    expect(invalidFilterParams(new URLSearchParams("physical=lifting&minPay=-3"))).toEqual(["physical", "minPay"]);
  });
});
