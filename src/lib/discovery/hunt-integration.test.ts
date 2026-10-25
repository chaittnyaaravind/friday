/**
 * Integration tests for the ingest pipeline and the discovery agent, run against an in-memory database
 * (testing/fake-db.ts). They cover the behavior the Hunt Engine foundation adds — change events, the baseline flag,
 * the close guard, source health — AND the behavior that existed before, which must not regress.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawPosting } from "./sources";
import { fakeDb, type FakeDb } from "./testing/fake-db";

const h = vi.hoisted(() => ({ adapter: vi.fn() }));
vi.mock("server-only", () => ({}));
// These tests exercise the discovery mechanics on an off-campus feed, so they run with the SJSU-only scope switched off.
vi.mock("@/lib/scope", () => ({ SJSU_ONLY: false, OFF_CAMPUS_PAGES: [] }));
vi.mock("./sources", async (importOriginal) => ({ ...(await importOriginal<typeof import("./sources")>()), ADAPTERS: { greenhouse: h.adapter } }));

const { archiveExpired, closeStale, normalizePosting, upsertJobs } = await import("./ingest");
const { runDiscovery, rematchAll } = await import("./agent");
const { SourceError } = await import("./sources");
const { CAPABILITIES } = await import("./capabilities");

const posting = (o: Partial<RawPosting> = {}): RawPosting => ({
  source: "greenhouse", sourceName: "Acme (Greenhouse)", externalId: "acme:1", title: "Software Engineer Intern",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1", sourceUrl: "https://boards.greenhouse.io/acme/jobs/1",
  locationText: "San Jose, CA", department: "Engineering", description: "Build APIs in Python and SQL.",
  postedAt: "2026-09-20T00:00:00.000Z", commitment: null, payText: null, isRemoteHint: false, onCampus: false, ...o,
});
const norm = (p: RawPosting, slug = "acme") => {
  const n = normalizePosting(p, { id: "c1", slug });
  if ("skip" in n) throw new Error(`posting was skipped: ${n.skip}`);
  return n;
};
const freshDb = () => fakeDb({ companies: [{ id: "c1", slug: "acme" }], jobs: [], job_sources: [], job_requirements: [], job_events: [] });
const HEX64 = /^[0-9a-f]{64}$/;

// ───────────────────────── upsertJobs ─────────────────────────
describe("upsertJobs — change events", () => {
  let db: FakeDb;
  beforeEach(() => { db = freshDb(); });
  const up = (ps: RawPosting[], opts = {}) => upsertJobs(db as never, ps.map((p) => norm(p)), new Map(), opts);

  it("a new job is stored with its content hashes and produces ONE 'new' event", async () => {
    const r = await up([posting()], { runId: "run-1" });
    expect(r.created).toHaveLength(1);
    const job = db.tables.jobs[0];
    expect(job).toMatchObject({ status: "active", closed_at: null });
    expect(job.content_hash).toMatch(HEX64);
    expect(job.description_hash).toMatch(HEX64);
    expect(job.is_baseline).not.toBe(true);
    expect(db.tables.job_events).toEqual([expect.objectContaining({ job_id: job.id, kind: "new", source: "greenhouse", run_id: "run-1", changes: {} })]);
  });

  it("BASELINE: jobs created on an employer's first crawl are flagged, and their event says so", async () => {
    await up([posting(), posting({ externalId: "acme:2", title: "Data Engineer Intern" })], { baseline: true });
    expect(db.tables.jobs.map((j) => j.is_baseline)).toEqual([true, true]);
    expect(db.tables.job_events.every((e) => e.kind === "new" && (e.changes as { baseline?: boolean }).baseline === true)).toBe(true);
  });

  it("re-running the same postings changes nothing: no new job, no events, no 'updated'", async () => {
    await up([posting()]);
    const before = JSON.stringify(db.tables.job_events);
    const r = await up([posting()]);
    expect(r).toMatchObject({ created: [], updated: [], reopened: [] });
    expect(r.touched).toHaveLength(1);
    expect(db.tables.jobs).toHaveLength(1);
    expect(JSON.stringify(db.tables.job_events)).toBe(before);
  });

  it("a real content change is an 'updated' event that names the fields that changed", async () => {
    await up([posting()]);
    const oldHash = db.tables.jobs[0].content_hash;
    // (same city: a different city would be a different job under the existing canonical key, not an update)
    const r = await up([posting({ description: "Build APIs in Python and SQL. The pay is $50/hr.", payText: "$50/hr", locationText: "San Jose, California" })], { runId: "run-2" });
    expect(r.updated).toEqual([db.tables.jobs[0].id]);
    const ev = db.tables.job_events.find((e) => e.kind === "updated")!;
    expect(ev).toMatchObject({ run_id: "run-2", source: "greenhouse" });
    expect(Object.keys(ev.changes as object).sort()).toEqual(["description", "location_text", "pay_text"]);
    expect(db.tables.jobs[0].content_hash).not.toBe(oldHash);
  });

  it("a whitespace-only change to the description is NOT an update", async () => {
    await up([posting()]);
    const r = await up([posting({ description: "  Build   APIs in Python and SQL.  " })]);
    expect(r.updated).toEqual([]);
  });

  it("a job stored before hashing existed is hashed silently — never reported as 'updated'", async () => {
    const n = norm(posting());
    db.tables.jobs.push({ id: "j-old", canonical_key: n.canonical, company_id: "c1", status: "active", title: n.row.title, content_hash: null, description_hash: null });
    const r = await upsertJobs(db as never, [n], new Map());
    expect(r.updated).toEqual([]);
    expect(db.tables.job_events).toEqual([]);
    expect(db.tables.jobs[0].content_hash).toMatch(HEX64);
  });

  it("REOPENED: a closed job that a source lists again becomes active, loses closed_at, and is recorded", async () => {
    await up([posting()]);
    Object.assign(db.tables.jobs[0], { status: "closed", closed_at: "2026-09-10T00:00:00.000Z" });
    const r = await up([posting()]);
    expect(r.reopened).toEqual([db.tables.jobs[0].id]);
    expect(db.tables.jobs[0]).toMatchObject({ status: "active", closed_at: null });
    expect(db.tables.job_events.find((e) => e.kind === "reopened")).toMatchObject({ changes: { from_status: "closed" } });
  });

  it("the baseline flag is only ever set on jobs CREATED in that call — an existing job is never re-flagged", async () => {
    await up([posting()]);
    await up([posting()], { baseline: true });
    expect(db.tables.jobs[0].is_baseline).not.toBe(true);
  });

  it("source-specific raw values are stored on the source row; without any, the default is an empty object", async () => {
    await up([posting({ source: "workday", externalId: "nv:1", sourceFields: { startDate: "2026-05-06", postedOn: "Posted 30+ Days Ago" } })]);
    await up([posting({ title: "Data Engineer Intern", externalId: "acme:9" })]);
    expect(db.tables.job_sources.find((s) => s.external_id === "nv:1")?.source_fields).toEqual({ startDate: "2026-05-06", postedOn: "Posted 30+ Days Ago" });
    expect(db.tables.job_sources.find((s) => s.external_id === "acme:9")?.source_fields).toEqual({});
  });

  it("the audit log is not best-effort: if events cannot be written, ingestion fails loudly", async () => {
    const failing = { from: (t: string) => (t === "job_events" ? { insert: async () => ({ error: { message: "permission denied" } }) } : db.from(t)) };
    await expect(upsertJobs(failing as never, [norm(posting())], new Map())).rejects.toThrow(/job_events insert failed: permission denied/);
  });

  it("EXISTING BEHAVIOR: canonical-key dedupe, second sources and requirements are unchanged", async () => {
    await up([posting(), posting({ externalId: "acme:1b", sourceUrl: "https://elsewhere.example/1" })]);
    expect(db.tables.jobs).toHaveLength(1); // one opportunity …
    expect(db.tables.job_sources).toHaveLength(2); // … two places it was seen
    expect(db.tables.job_requirements.length).toBeGreaterThan(0); // Python / SQL extracted for a new job
  });
});

// ───────────────────────── closeStale ─────────────────────────
const RUN_START = "2026-09-27T12:00:00.000Z";
const OLD = "2026-09-01T00:00:00.000Z";
const SEEN = "2026-09-27T12:00:05.000Z";

/** n active jobs at company c1 from one source; the first `seen` were seen by this run, the rest were not. */
function seedListings(db: FakeDb, n: number, seen: number, source = "greenhouse", company = "c1") {
  for (let i = 1; i <= n; i++) {
    const wasSeen = i <= seen;
    const id = `${company}-${source}-${i}`;
    db.tables.jobs.push({ id, company_id: company, status: "active", last_verified_at: wasSeen ? SEEN : OLD, closed_at: null });
    db.tables.job_sources.push({ id: `s-${id}`, job_id: id, source, external_id: id, last_seen_at: wasSeen ? SEEN : OLD });
  }
}
const writes = (db: FakeDb) => db.log.filter((l) => l.op !== "select");

describe("closeStale — with the close guard", () => {
  let db: FakeDb;
  beforeEach(() => { db = fakeDb({ jobs: [], job_sources: [], job_events: [] }); });

  it("EXISTING BEHAVIOR: a listing the feed no longer returns is closed, and the closure is recorded", async () => {
    seedListings(db, 8, 7);
    const r = await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 7, runId: "run-9" });
    expect(r).toEqual({ closed: 1, blocked: null, activeBefore: 8, candidates: 1 });
    const closed = db.tables.jobs.find((j) => j.status === "closed")!;
    expect(closed.id).toBe("c1-greenhouse-8");
    expect(typeof closed.closed_at).toBe("string");
    expect(db.tables.job_events).toEqual([expect.objectContaining({ job_id: closed.id, kind: "closed", source: "greenhouse", run_id: "run-9" })]);
    expect(db.tables.jobs.filter((j) => j.status === "active")).toHaveLength(7);
  });

  it("EMPTY FEED: nothing is closed and nothing is written when a source returns nothing but we hold listings", async () => {
    seedListings(db, 8, 0);
    const before = writes(db).length;
    const r = await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 0 });
    expect(r).toEqual({ closed: 0, blocked: "empty_feed", activeBefore: 8, candidates: 8 });
    expect(db.tables.jobs.every((j) => j.status === "active")).toBe(true);
    expect(writes(db)).toHaveLength(before);
    expect(db.tables.job_events).toEqual([]);
  });

  it("MASS CLOSE: refuses to close more than half of a source's listings at once", async () => {
    seedListings(db, 8, 3);
    const r = await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 3 });
    expect(r).toMatchObject({ closed: 0, blocked: "mass_close", activeBefore: 8, candidates: 5 });
    expect(db.tables.jobs.every((j) => j.status === "active")).toBe(true);
  });

  it("a small employer legitimately closing everything (returned unknown or small) is still allowed", async () => {
    seedListings(db, 3, 1);
    const r = await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 1 });
    expect(r).toMatchObject({ closed: 2, blocked: null });
  });

  it("EXISTING BEHAVIOR: without `returned` (old callers) the empty-feed check is skipped but mass-close still protects", async () => {
    seedListings(db, 8, 6);
    expect(await closeStale(db as never, "c1", "greenhouse", RUN_START)).toMatchObject({ closed: 2, blocked: null });
  });

  it("only touches this company's listings from this source, and never a listing this source saw", async () => {
    seedListings(db, 8, 7);
    seedListings(db, 8, 0, "greenhouse", "c2"); // another employer's stale listings
    seedListings(db, 8, 0, "lever", "c1"); // this employer, another source
    await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 7 });
    expect(db.tables.jobs.filter((j) => j.status === "closed").map((j) => j.id)).toEqual(["c1-greenhouse-8"]);
  });

  it("a listing another source verified during this run is not closed just because THIS source stopped listing it", async () => {
    seedListings(db, 8, 7);
    db.tables.jobs.find((j) => j.id === "c1-greenhouse-8")!.last_verified_at = SEEN;
    const r = await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 7 });
    expect(r).toMatchObject({ closed: 0, candidates: 1 });
    expect(db.tables.jobs.every((j) => j.status === "active")).toBe(true);
  });

  it("a job with two source rows counts as seen when either was seen this run", async () => {
    seedListings(db, 8, 7);
    db.tables.job_sources.push({ id: "extra", job_id: "c1-greenhouse-8", source: "greenhouse", external_id: "dup", last_seen_at: SEEN });
    expect(await closeStale(db as never, "c1", "greenhouse", RUN_START, { returned: 8 })).toMatchObject({ closed: 0, candidates: 0 });
  });
});

describe("archiveExpired", () => {
  it("EXISTING BEHAVIOR: a listing unconfirmed for 45 days is expired — now with closed_at and an 'expired' event", async () => {
    const NOW = Date.parse("2026-09-27T12:00:00.000Z");
    const db = fakeDb({ jobs: [
      { id: "old", status: "active", last_verified_at: "2026-07-01T00:00:00.000Z" },
      { id: "recent", status: "active", last_verified_at: "2026-09-20T00:00:00.000Z" },
    ], job_events: [] });
    expect(await archiveExpired(db as never, NOW, { runId: "run-3" })).toBe(1);
    expect(db.tables.jobs.find((j) => j.id === "old")).toMatchObject({ status: "expired", closed_at: new Date(NOW).toISOString() });
    expect(db.tables.jobs.find((j) => j.id === "recent")?.status).toBe("active");
    expect(db.tables.job_events).toEqual([expect.objectContaining({ job_id: "old", kind: "expired", source: null, run_id: "run-3" })]);
  });
});

// ───────────────────────── SJSU depth, through the real pipeline ─────────────────────────
const fixtureText = (f: string) => readFileSync(new URL(`../../../test/fixtures/sources/${f}`, import.meta.url), "utf8");
const fixtureJson = <T,>(f: string): T => JSON.parse(fixtureText(f)) as T;
const actualSources = await vi.importActual<typeof import("./sources")>("./sources");
const { importPosting } = await import("./ingest");

describe("SJSU depth — real Student Union feed and Peer Connections page through adapter → normalize → store", () => {
  afterEach(() => vi.unstubAllGlobals());
  let db: FakeDb;
  beforeEach(() => { db = fakeDb({ companies: [{ id: "c-su", slug: "sjsu-student-union" }], jobs: [], job_sources: [], job_requirements: [], job_events: [] }); });

  const studentUnion = async () => {
    const fx = fixtureJson<{ data: unknown[] }>("pinpoint.json");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: fx.data }), { status: 200 })));
    return actualSources.ADAPTERS.pinpoint!({ slug: "sjsu-student-union", name: "SJSU Student Union", ats: "pinpoint", config: { subdomain: "sjsustudentunion", campus: "1" } });
  };

  it("every Student Union posting is stored as an on-campus job of the Student Union, with pay, deadline and roles", async () => {
    const postings = await studentUnion();
    await upsertJobs(db as never, postings.map((p) => norm(p, "sjsu-student-union")), new Map());
    expect(db.tables.jobs).toHaveLength(postings.length);
    for (const j of db.tables.jobs) {
      expect(j).toMatchObject({ is_on_campus: true, employment_type: "on_campus", campus_employer: "student_union", city: "San Jose" });
      expect(j.campus_roles).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(j.pay_text).toMatch(/^\$[\d.]+–\$[\d.]+\/hr$/); // "$20.50 - $23.25 / hour" → "$20.50–$23.25/hr"
      expect(j.pay_min).toBeGreaterThan(15);
      expect(j.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const club = db.tables.jobs.find((j) => j.title === "Club Sports Student Supervisor")!;
    expect(club).toMatchObject({ campus_roles: ["fitness_recreation", "student_assistant"], pay_text: "$20.50–$23.25/hr", pay_min: 20.5, pay_max: 23.25, deadline: expect.stringMatching(/^2026-/) });
    expect(db.tables.jobs.find((j) => j.title === "Fitness Instructor")).toMatchObject({ campus_roles: ["fitness_recreation"] });
  });

  it("the hours the postings state are stored as numbers: the in-session cap, with the break cap in the text", async () => {
    const postings = await studentUnion();
    await upsertJobs(db as never, postings.map((p) => norm(p, "sjsu-student-union")), new Map());
    const withHours = db.tables.jobs.filter((j) => j.hours_max != null);
    expect(withHours.length).toBeGreaterThan(0);
    for (const j of withHours) {
      expect(j.hours_max).toBe(20);
      expect(j.hours_min).toBeNull(); // a cap, not a range
      expect(j.hours_text).toMatch(/^Up to 20 hrs\/week( \(40 on breaks\))?$/);
    }
    expect(withHours.some((j) => /40 on breaks/.test(j.hours_text as string))).toBe(true);
  });

  it("re-reading the same feed changes nothing (no false 'updated'), and the new fields do not disturb change detection", async () => {
    const first = await studentUnion();
    await upsertJobs(db as never, first.map((p) => norm(p, "sjsu-student-union")), new Map());
    const r = await upsertJobs(db as never, (await studentUnion()).map((p) => norm(p, "sjsu-student-union")), new Map());
    expect(r).toMatchObject({ created: [], updated: [], reopened: [] });
    expect(db.tables.job_events.filter((e) => e.kind === "new")).toHaveLength(first.length);
  });

  it("the real Peer Connections page: roles are recognised, the employer is Peer Connections, the due date is the deadline", () => {
    const feedCfg = { slug: "sjsu-peer-connections", name: "SJSU Peer Connections", ats: "sjsu_page" as const, config: { url: "https://www.sjsu.edu/peerconnections/about/our-team.php", department: "Peer Connections", mode: "recruitment" } };
    const rows = actualSources.parseRecruitmentPage(fixtureText("sjsu-peerconnections-team.html"), feedCfg, Date.parse("2026-09-27T12:00:00Z")).map((p) => norm(p, "sjsu-peer-connections").row);
    expect(rows.map((r) => r.title)).toEqual(["Learning Assistants", "Academic Peer Mentors", "Peer Tutors", "Supplemental Instruction (SI) Leaders"]);
    for (const r of rows) expect(r).toMatchObject({ campus_employer: "peer_connections", is_on_campus: true, deadline: "2026-10-31" });
    expect(rows.map((r) => r.campus_roles)).toEqual([["tutor_mentor", "student_assistant"], ["tutor_mentor"], ["tutor_mentor"], ["tutor_mentor"]]);
  });

  it("a job that is not on campus carries no campus fields", () => {
    const row = norm(posting({ description: "Build APIs. Work 10–20 hours per week during the term." })).row;
    expect(row).toMatchObject({ campus_roles: [], campus_employer: null, is_on_campus: false });
  });

  it("EXISTING BEHAVIOR: hours in the formats the old parser read are stored exactly as before, now also as numbers", () => {
    expect(norm(posting({ description: "Work 10–20 hours per week." })).row).toMatchObject({ hours_text: "10–20 hrs/week", hours_min: 10, hours_max: 20 });
    expect(norm(posting({ description: "Up to 20 hours per week." })).row).toMatchObject({ hours_text: "Up to 20 hrs/week", hours_min: null, hours_max: 20 });
    expect(norm(posting({ description: "No hours are stated." })).row).toMatchObject({ hours_text: null, hours_min: null, hours_max: null });
  });

  it("a student's Handshake import gets roles, hours and pay from its own text — and is not attributed to a named employer", async () => {
    const idb = fakeDb({ companies: [], jobs: [], job_sources: [], job_requirements: [] });
    await importPosting(idb as never, { url: "https://sjsu.joinhandshake.com/jobs/123", title: "Lab Assistant", company: "SJSU", description: "Help in the chemistry lab. Up to 20 hours per week. $18 an hour.", source: "handshake", onCampus: true }, new Map(), "user-1");
    expect(idb.tables.jobs[0]).toMatchObject({ campus_roles: ["lab_assistant", "student_assistant"], campus_employer: "other", hours_max: 20, hours_text: "Up to 20 hrs/week", pay_text: "$18/hr", is_on_campus: true, imported_by: "user-1" });
  });
  it("an import's prose never turns a bare dollar figure into pay", async () => {
    const idb = fakeDb({ companies: [], jobs: [], job_sources: [], job_requirements: [] });
    await importPosting(idb as never, { url: "https://sjsu.joinhandshake.com/jobs/124", title: "Office Assistant", company: "SJSU", description: "Includes a $500 relocation stipend.", source: "handshake", onCampus: true }, new Map(), "user-1");
    expect(idb.tables.jobs[0]).toMatchObject({ pay_text: null });
  });
  it("an off-campus import joins the public employer even with a legal suffix", async () => {
    const idb = fakeDb({ companies: [{ id: "c-nv", slug: "nvidia", name: "NVIDIA", imported_by: null }], jobs: [], job_sources: [], job_requirements: [] });
    await importPosting(idb as never, { url: "https://www.linkedin.com/jobs/view/1", title: "Software Intern", company: "NVIDIA Corporation", source: "linkedin", onCampus: false }, new Map(), "user-1");
    expect(idb.tables.jobs[0]).toMatchObject({ company_id: "c-nv" });
  });
});

// ───────────────────────── match v2 through the pipeline ─────────────────────────
describe("rematchAll — every stored match carries its breakdown and eligibility verdict", () => {
  const profileRow = (over: Record<string, unknown> = {}) => ({
    id: "u1", onboarded_at: "2026-09-01", major: "Computer Science", origin_lat: 37.3352, origin_lng: -121.8811, radius_miles: 25, workplace: "any",
    desired_titles: [], work_authorization: "f1", graduation_year: 2027, profile_skills: [{ skills: { slug: "java" } }, { skills: { slug: "sql" } }], notification_prefs: {}, ...over,
  });
  const jobRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, company_id: "c1", imported_by: null, title: "Software Engineering Intern", employment_type: "internship", category: "Software Engineering", is_on_campus: false,
    lat: 37.3541, lng: -121.9552, city: "Santa Clara", is_remote: false, is_hybrid: false, description: "Build APIs.", status: "active", deadline: null, hours_max: null,
    work_study: "not_required", companies: { name: "Acme" }, job_requirements: [{ label: "Java", kind: "required", skills: { slug: "java" } }], ...over,
  });
  const matches = (db: FakeDb) => db.tables.job_matches;

  it("stores score, breakdown, verdict and each check's reason — for citizens-only, campus-hours and plain roles", async () => {
    const db = fakeDb({
      profiles: [profileRow()],
      jobs: [
        jobRow("plain"),
        jobRow("citizen", { title: "Security Intern", description: "Applicants must be a U.S. citizen." }),
        jobRow("campus", { title: "Lab Assistant", employment_type: "on_campus", is_on_campus: true, city: "San Jose", lat: 37.3352, lng: -121.8811, hours_max: 30, description: "Up to 30 hours per week." }),
        jobRow("closing", { deadline: "2020-01-01" }),
      ],
      job_matches: [], company_watchlists: [], notifications: [],
    });
    await rematchAll(db as never);
    const by = (id: string) => matches(db).find((m) => m.job_id === id)!;
    expect(matches(db)).toHaveLength(4);
    for (const m of matches(db)) {
      expect(m.breakdown).toHaveLength(4);
      expect((m.breakdown as { points: number }[]).reduce((s, p) => s + p.points, 0)).toBe(m.score);
      expect(["clear", "verify", "blocked"]).toContain(m.eligibility);
      expect(Array.isArray(m.eligibility_checks)).toBe(true);
    }
    expect(by("plain").eligibility).toBe("verify"); // F-1 off campus: needs CPT/OPT
    expect(by("citizen").eligibility).toBe("blocked");
    expect((by("citizen").eligibility_checks as { id: string; status: string }[]).find((c) => c.id === "authorization")?.status).toBe("fail");
    expect(by("campus").eligibility).toBe("verify"); // 30 hours > the F-1 on-campus limit
    expect(by("closing").eligibility).toBe("blocked"); // deadline passed
  });

  it("EXISTING BEHAVIOR: the stored score, strong, missing, difficulty and distance are exactly what computeMatch gives", async () => {
    const { computeMatch: cm } = await import("@/lib/domain/match");
    const { toMatchJob, loadMatchProfile } = await import("./agent");
    const db = fakeDb({ profiles: [profileRow()], jobs: [jobRow("plain")], job_matches: [], company_watchlists: [], notifications: [] });
    await rematchAll(db as never);
    const profile = (await loadMatchProfile(db as never, "u1"))!;
    const job = toMatchJob(jobRow("plain") as never);
    const expected = cm(profile, job);
    expect(matches(db)[0]).toMatchObject({ score: expected.score, strong: expected.strong, missing: expected.missing, difficulty: expected.difficulty, distance_miles: expected.distanceMiles });
  });

  it("a student's private import is scored only for them, as before", async () => {
    const db = fakeDb({
      profiles: [profileRow(), profileRow({ id: "u2" })],
      jobs: [jobRow("public"), jobRow("private", { imported_by: "u1" })],
      job_matches: [], company_watchlists: [], notifications: [],
    });
    await rematchAll(db as never);
    expect(matches(db).filter((m) => m.job_id === "private").map((m) => m.user_id)).toEqual(["u1"]);
    expect(matches(db).filter((m) => m.job_id === "public")).toHaveLength(2);
  });

  it("a profile with no work authorization set gets a 'verify' asking for it on off-campus roles, not a guess", async () => {
    const db = fakeDb({ profiles: [profileRow({ work_authorization: null })], jobs: [jobRow("plain")], job_matches: [], company_watchlists: [], notifications: [] });
    await rematchAll(db as never);
    expect(matches(db)[0].eligibility).toBe("verify");
    expect((matches(db)[0].eligibility_checks as { id: string; status: string }[]).find((c) => c.id === "authorization")?.status).toBe("unknown");
  });
});

// ───────────────────────── the whole agent ─────────────────────────
describe("runDiscovery — one employer across several runs", () => {
  let db: FakeDb;
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const crawl = () => runDiscovery(db as never, { trigger: "manual", companySlugs: ["stripe"] });
  const list = (n: number) =>
    ["Software Engineer Intern", "Machine Learning Intern", "Data Engineer Intern", "Backend Engineer Intern"].slice(0, n).map((title, i) => posting({ title, externalId: `stripe:${i + 1}`, applyUrl: `https://boards.greenhouse.io/stripe/jobs/${i + 1}`, sourceUrl: `https://boards.greenhouse.io/stripe/jobs/${i + 1}`, sourceName: "Stripe (Greenhouse)" }));
  const stripe = () => db.tables.companies.find((c) => c.slug === "stripe")!;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-09-27T12:00:00.000Z");
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.adapter.mockReset();
    db = fakeDb({ profiles: [], jobs: [], job_sources: [], job_requirements: [], job_events: [], agent_runs: [], source_health: [], source_capabilities: [] });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("FIRST CRAWL: everything found is a baseline (already open), not 'just opened'; health and capabilities are recorded", async () => {
    h.adapter.mockResolvedValue(list(3));
    const r = await crawl();
    expect(r).toMatchObject({ companies: 1, seen: 3, kept: 3, created: 3, baseline: 3, updated: 0, reopened: 0, closed: 0, closeBlocked: [], failures: [] });
    expect(db.tables.jobs).toHaveLength(3);
    expect(db.tables.jobs.every((j) => j.is_baseline === true)).toBe(true);
    expect(db.tables.job_events.filter((e) => e.kind === "new")).toHaveLength(3);
    expect(stripe().last_crawled_at).toBeTruthy();
    expect(db.tables.source_health).toEqual([expect.objectContaining({ source: "greenhouse", scope: "stripe", last_returned: 3, last_kept: 3, consecutive_failures: 0, close_blocked_reason: null })]);
    expect(db.tables.source_capabilities).toHaveLength(CAPABILITIES.length);
    expect(db.tables.agent_runs).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });

  it("SECOND CRAWL: a genuinely new posting is NOT a baseline; unchanged ones produce no events", async () => {
    h.adapter.mockResolvedValue(list(3));
    await crawl();
    at("2026-09-27T15:00:00.000Z");
    h.adapter.mockResolvedValue(list(4));
    const r = await crawl();
    expect(r).toMatchObject({ created: 1, baseline: 0, updated: 0, closed: 0 });
    const fresh = db.tables.jobs.find((j) => j.title === "Backend Engineer Intern")!;
    expect(fresh.is_baseline).not.toBe(true);
    expect(db.tables.job_events.filter((e) => e.kind === "new")).toHaveLength(4);
    expect(db.tables.jobs.filter((j) => j.is_baseline === true)).toHaveLength(3);
  });

  it("EMPTY FEED: an employer whose feed suddenly returns nothing keeps its listings, and the refusal is reported and recorded", async () => {
    h.adapter.mockResolvedValue(list(4));
    await crawl();
    at("2026-09-27T18:00:00.000Z");
    h.adapter.mockResolvedValue([]);
    const r = await crawl();
    expect(r.closed).toBe(0);
    expect(r.closeBlocked).toEqual([{ company: "stripe", source: "greenhouse", reason: "empty_feed", candidates: 4, active: 4 }]);
    expect(db.tables.jobs.every((j) => j.status === "active")).toBe(true);
    expect(db.tables.job_events.some((e) => e.kind === "closed")).toBe(false);
    expect(db.tables.source_health[0]).toMatchObject({ close_blocked_reason: "empty_feed", last_returned: 0 });
  });

  it("FAILING FEED: the failure is reported and recorded, and nothing is closed or changed", async () => {
    h.adapter.mockResolvedValue(list(4));
    await crawl();
    const snapshot = JSON.stringify(db.tables.jobs);
    at("2026-09-27T21:00:00.000Z");
    h.adapter.mockRejectedValue(new SourceError("503 Service Unavailable", "https://boards-api.greenhouse.io/x", 503));
    const r = await crawl();
    expect(r.failures).toEqual([{ company: "stripe", error: "503 Service Unavailable" }]);
    expect(JSON.stringify(db.tables.jobs)).toBe(snapshot);
    expect(db.tables.source_health[0]).toMatchObject({ consecutive_failures: 1, last_error: "503 Service Unavailable" });
    expect(db.tables.agent_runs.at(-1)).toMatchObject({ status: "partial" });
  });

  it("EXISTING BEHAVIOR: a small employer whose listings really closed still has them closed, and health recovers", async () => {
    h.adapter.mockResolvedValue(list(4));
    await crawl();
    at("2026-09-27T21:00:00.000Z");
    h.adapter.mockRejectedValue(new SourceError("timeout", "u"));
    await crawl();
    at("2026-09-28T00:00:00.000Z");
    h.adapter.mockResolvedValue(list(1));
    const r = await crawl();
    expect(r).toMatchObject({ closed: 3, closeBlocked: [] });
    expect(db.tables.jobs.filter((j) => j.status === "closed")).toHaveLength(3);
    expect(db.tables.job_events.filter((e) => e.kind === "closed")).toHaveLength(3);
    expect(db.tables.source_health[0]).toMatchObject({ consecutive_failures: 0, last_error: null });
  });

  it("a reopened posting is recorded as 'reopened' by the agent", async () => {
    h.adapter.mockResolvedValue(list(4));
    await crawl();
    at("2026-09-27T21:00:00.000Z");
    h.adapter.mockResolvedValue(list(1));
    await crawl(); // closes 3
    at("2026-09-28T00:00:00.000Z");
    h.adapter.mockResolvedValue(list(4));
    const r = await crawl();
    expect(r.reopened).toBe(3);
    expect(db.tables.jobs.every((j) => j.status === "active")).toBe(true);
  });
});
