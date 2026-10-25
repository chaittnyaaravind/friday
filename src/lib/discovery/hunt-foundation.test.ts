import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CAPABILITIES, capabilityOf, capabilityRows, pollingLabel } from "./capabilities";
import { contentHash, descriptionHash, diffContent, TRACKED_FIELDS } from "./change";
import { closeDecision, MASS_CLOSE_MIN_ACTIVE } from "./close-guard";
import { minutesSince, nextHealth, recordSourceRun } from "./health";
import { ADAPTERS } from "./sources";
import { fakeDb } from "./testing/fake-db";

// ───────────────────────── change detection ─────────────────────────
const job = { title: "Software Engineer Intern", department: "Engineering", employment_type: "internship", location_text: "San Jose, CA", pay_text: "$45/hr", deadline: "2026-11-01", apply_url: "https://x.example/1", description: "Build APIs.\nWork with Python." };

describe("content hash", () => {
  it("is a 64-character SHA-256 hex string and is stable", () => {
    expect(contentHash(job)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ ...job })).toBe(contentHash(job));
  });
  it("ignores whitespace-only differences (a re-flowed description is not an update)", () => {
    expect(contentHash({ ...job, description: "  Build   APIs.\n\nWork with   Python.  " })).toBe(contentHash(job));
    expect(descriptionHash({ description: "a  b" })).toBe(descriptionHash({ description: "a b" }));
  });
  it("changes when ANY tracked field or the description really changes", () => {
    for (const f of TRACKED_FIELDS) expect(contentHash({ ...job, [f]: `${job[f]} changed` }), f).not.toBe(contentHash(job));
    expect(contentHash({ ...job, description: "Different text." })).not.toBe(contentHash(job));
  });
  it("treats null, undefined and empty string alike", () => {
    expect(contentHash({ ...job, pay_text: null })).toBe(contentHash({ ...job, pay_text: "" }));
    expect(contentHash({ ...job, pay_text: undefined })).toBe(contentHash({ ...job, pay_text: null }));
  });
});

describe("diffContent", () => {
  const prev = { ...job, description_hash: descriptionHash(job) };
  it("reports nothing when nothing changed", () => {
    expect(diffContent(prev, job)).toEqual({});
  });
  it("reports tracked fields with before and after", () => {
    expect(diffContent(prev, { ...job, pay_text: "$50/hr", deadline: "2026-12-01" })).toEqual({
      pay_text: { from: "$45/hr", to: "$50/hr" },
      deadline: { from: "2026-11-01", to: "2026-12-01" },
    });
  });
  it("reports a description change as `changed`, never the text itself", () => {
    expect(diffContent(prev, { ...job, description: "Completely new text." })).toEqual({ description: { changed: true } });
  });
  it("cannot tell a description changed when the stored job has no description hash (legacy rows): no false alarm", () => {
    expect(diffContent({ ...job, description_hash: null }, { ...job, description: "new" })).toEqual({});
  });
  it("clips long values and turns empty into null", () => {
    const d = diffContent(prev, { ...job, pay_text: "", title: "T".repeat(500) });
    expect(d.pay_text).toEqual({ from: "$45/hr", to: null });
    expect((d.title as { to: string }).to).toHaveLength(300);
  });
});

// ───────────────────────── close guard ─────────────────────────
describe("close guard", () => {
  it("allows closing when the feed is healthy and only a few listings vanished", () => {
    expect(closeDecision({ returned: 40, activeBefore: 20, candidates: 2 })).toEqual({ allow: true });
  });
  it("allows when nothing would be closed, even for an empty feed", () => {
    expect(closeDecision({ returned: 0, activeBefore: 0, candidates: 0 })).toEqual({ allow: true });
    // Details left out this run: "not seen" proves nothing, so nothing closes.
    expect(closeDecision({ returned: 5, incomplete: true, activeBefore: 5, candidates: 1 })).toEqual({ allow: false, reason: "incomplete_feed" });
    // A feed of staff-only jobs (student filter leaves none) is healthy: its one ended student listing may close.
    expect(closeDecision({ returned: 12, activeBefore: 1, candidates: 1 })).toEqual({ allow: true });
  });
  it("REFUSES when the feed returned nothing but we hold active listings from it (empty_feed)", () => {
    expect(closeDecision({ returned: 0, activeBefore: 3, candidates: 3 })).toEqual({ allow: false, reason: "empty_feed" });
  });
  it("REFUSES a mass close: more than half of a source's listings at once (mass_close)", () => {
    expect(closeDecision({ returned: 4, activeBefore: 10, candidates: 6 })).toEqual({ allow: false, reason: "mass_close" });
  });
  it("exactly half is allowed; the threshold is 'more than half'", () => {
    expect(closeDecision({ returned: 5, activeBefore: 10, candidates: 5 })).toEqual({ allow: true });
  });
  it("small sources are not judged as mass closes (too little evidence), only empty feeds are refused", () => {
    expect(closeDecision({ returned: 1, activeBefore: MASS_CLOSE_MIN_ACTIVE - 1, candidates: 4 })).toEqual({ allow: true });
    expect(closeDecision({ returned: 1, activeBefore: MASS_CLOSE_MIN_ACTIVE, candidates: MASS_CLOSE_MIN_ACTIVE - 1 })).toEqual({ allow: false, reason: "mass_close" });
  });
  it("when the returned count is unknown the empty-feed check is skipped, the mass-close check still applies", () => {
    expect(closeDecision({ activeBefore: 3, candidates: 3 })).toEqual({ allow: true });
    expect(closeDecision({ activeBefore: 10, candidates: 9 })).toEqual({ allow: false, reason: "mass_close" });
  });
});

// ───────────────────────── source health ─────────────────────────
const key = { source: "greenhouse", scope: "stripe" };
const T1 = "2026-09-27T10:00:00.000Z";
const T2 = "2026-09-27T13:00:00.000Z";
const T3 = "2026-09-27T16:00:00.000Z";

describe("source health", () => {
  it("a first success records what was seen and when", () => {
    expect(nextHealth(null, key, { ok: true, returned: 12, kept: 5, closed: 1 }, T1)).toMatchObject({
      ...key, last_attempt_at: T1, last_success_at: T1, last_error: null, consecutive_failures: 0, last_returned: 12, last_kept: 5, last_closed: 1, close_blocked_reason: null,
    });
  });
  it("a failure counts up, keeps the LAST SUCCESS time and counts, and records the error", () => {
    const ok = nextHealth(null, key, { ok: true, returned: 12, kept: 5, closed: 0 }, T1);
    const f1 = nextHealth(ok, key, { ok: false, error: "503 Service Unavailable" }, T2);
    const f2 = nextHealth(f1, key, { ok: false, error: "timeout" }, T3);
    expect(f1).toMatchObject({ last_attempt_at: T2, last_success_at: T1, last_error: "503 Service Unavailable", consecutive_failures: 1, last_returned: 12 });
    expect(f2).toMatchObject({ last_attempt_at: T3, last_success_at: T1, consecutive_failures: 2 });
  });
  it("a success after failures clears the error and the failure count", () => {
    const f = nextHealth(nextHealth(null, key, { ok: false, error: "x" }, T1), key, { ok: false, error: "y" }, T2);
    expect(nextHealth(f, key, { ok: true, returned: 3, kept: 3, closed: 0 }, T3)).toMatchObject({ last_error: null, consecutive_failures: 0, last_success_at: T3 });
  });
  it("records a refused close, and clears it on the next clean run", () => {
    const blocked = nextHealth(null, key, { ok: true, returned: 0, kept: 0, closed: 0, closeBlocked: "empty_feed" }, T1);
    expect(blocked.close_blocked_reason).toBe("empty_feed");
    expect(nextHealth(blocked, key, { ok: true, returned: 9, kept: 4, closed: 0 }, T2).close_blocked_reason).toBeNull();
  });
  it("clips very long errors", () => {
    expect(nextHealth(null, key, { ok: false, error: "e".repeat(1000) }, T1).last_error).toHaveLength(300);
  });

  it("recordSourceRun upserts one row per source+scope and accumulates failures across runs", async () => {
    const db = fakeDb({ source_health: [] });
    await recordSourceRun(db as never, key, { ok: false, error: "boom" }, T1);
    await recordSourceRun(db as never, key, { ok: false, error: "boom again" }, T2);
    await recordSourceRun(db as never, { source: "lever", scope: "palantir" }, { ok: true, returned: 4, kept: 2, closed: 0 }, T2);
    expect(db.tables.source_health).toHaveLength(2);
    expect(db.tables.source_health.find((r) => r.scope === "stripe")).toMatchObject({ consecutive_failures: 2, last_error: "boom again", last_success_at: null });
    expect(db.tables.source_health.find((r) => r.scope === "palantir")).toMatchObject({ consecutive_failures: 0, last_success_at: T2 });
  });
  it("health is telemetry: a database failure is logged and never thrown into the discovery run", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { from: () => { throw new Error("relation source_health does not exist"); } };
    await expect(recordSourceRun(broken as never, key, { ok: true })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("source_health_failed"));
    spy.mockRestore();
  });

  it("minutesSince: whole minutes, and null for unknown, invalid or future timestamps", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    expect(minutesSince("2026-09-27T11:47:30.000Z", now)).toBe(12);
    expect(minutesSince("2026-09-27T12:00:00.000Z", now)).toBe(0);
    expect(minutesSince(null, now)).toBeNull();
    expect(minutesSince("not a date", now)).toBeNull();
    expect(minutesSince("2026-09-27T12:05:00.000Z", now)).toBeNull(); // clock skew is not "just now"
  });
});

// ───────────────────────── capabilities: nothing is claimed that was not verified ─────────────────────────
const fixture = (f: string) => JSON.parse(readFileSync(new URL(`../../../test/fixtures/sources/${f}`, import.meta.url), "utf8")) as { _capture: Record<string, unknown> };

describe("source capabilities", () => {
  it("every adapter and every import path has a capability record, and there are no duplicates", () => {
    const sources = CAPABILITIES.map((c) => c.source);
    expect(new Set(sources).size).toBe(sources.length);
    for (const k of [...Object.keys(ADAPTERS), "adzuna", "handshake_import", "linkedin_import", "indeed_import", "manual"]) expect(capabilityOf(k), k).not.toBeNull();
  });
  it("NO source is claimed to be real-time: latency has not been measured for any", () => {
    for (const c of CAPABILITIES) expect(c.realtimeVerifiedAt, c.source).toBeNull();
    for (const c of CAPABILITIES) expect(pollingLabel(c.source), c.source).not.toMatch(/^Real-time/);
  });
  it("the polling label says 'not real-time' and how often FRIDAY actually checks", () => {
    expect(pollingLabel("greenhouse")).toBe("Checked about every 3h — not real-time");
    expect(pollingLabel("handshake_import")).toBe("Added by you");
    expect(pollingLabel("something-unknown")).toBe("Added by you");
  });
  it("a source is only labelled real-time once someone has recorded a verification", () => {
    const c = capabilityOf("lever")!;
    const saved = c.realtimeVerifiedAt;
    c.realtimeVerifiedAt = "2026-10-01T00:00:00.000Z";
    try {
      expect(pollingLabel("lever")).toBe("Real-time (verified 2026-10-01)");
    } finally {
      c.realtimeVerifiedAt = saved;
    }
  });
  it("Workday's startDate is recorded as UNVERIFIED and is not what the adapter uses as a posting date", () => {
    expect(capabilityOf("workday")!.postedAt).toMatchObject({ provided: "unverified", field: "startDate" });
  });
  it("Handshake, LinkedIn and Indeed are import-only: FRIDAY never fetches them", () => {
    for (const s of ["handshake_import", "linkedin_import", "indeed_import", "manual"]) expect(capabilityOf(s)).toMatchObject({ access: "user_import", automation: "import_only", configuredPollMinutes: null });
  });
  it("keyed APIs never exercised live are not marked verified", () => {
    for (const s of ["usajobs", "adzuna"]) expect(capabilityOf(s)!.verifiedOn, s).toBeNull();
  });
  it("sources marked verified carry the date of the live capture the fixtures came from", () => {
    for (const s of ["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "sjsu_page"]) expect(capabilityOf(s)!.verifiedOn, s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The claims below are re-checked against the captured fixtures, so refreshing a fixture that contradicts a claim fails here.
  it("CLAIM CHECK: Greenhouse first_published is present on every posting captured", () => {
    const m = fixture("greenhouse.json")._capture;
    expect(m.withFirstPublished).toBe(m.totalInFeed);
    expect(capabilityOf("greenhouse")!.postedAt.provided).toBe("yes");
  });
  it("CLAIM CHECK: Greenhouse application_deadline was never populated in the capture, so it is not mapped", () => {
    expect(fixture("greenhouse.json")._capture.withApplicationDeadline).toBe(0);
  });
  it("CLAIM CHECK: Lever salaryRange was never present in the capture, so the salary branch is documented as unexercised", () => {
    expect(fixture("lever.json")._capture.withSalaryRange).toBe(0);
    expect(capabilityOf("lever")!.notes.join(" ")).toMatch(/salaryRange/);
  });

  it("the rows written to source_capabilities match the migration's columns exactly", () => {
    const cols = ["source", "access", "automation", "posted_at_provided", "posted_at_field", "posted_at_note", "configured_poll_minutes", "realtime_verified_at", "verified_on", "notes"];
    const migration = readFileSync(new URL("../../../supabase/migrations/0011_hunt_foundation.sql", import.meta.url), "utf8");
    for (const row of capabilityRows()) expect(Object.keys(row).sort()).toEqual([...cols].sort());
    for (const c of cols) expect(migration, c).toContain(c);
  });
});
