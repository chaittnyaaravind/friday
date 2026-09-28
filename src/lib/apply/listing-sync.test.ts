/** The tracker follows the listing — and never touches anything the student already submitted or chose themselves. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/discovery/testing/fake-db";
import { syncApplicationsWithListings } from "./listing-sync";

const seed = (jobStatus: string, appStatus: string, events: Row[] = []) => {
  const db = fakeDb({
    jobs: [{ id: "job-1", status: jobStatus }],
    applications: [{ id: "app-1", user_id: "u1", job_id: "job-1", status: appStatus, cover_letter: "my letter", notes: "my notes" }],
    application_events: events,
  });
  return { db, run: () => syncApplicationsWithListings(db as unknown as SupabaseClient), app: () => db.tables.applications[0], events: () => db.tables.application_events };
};

describe("closing", () => {
  for (const status of ["saved", "preparing", "ready"]) {
    for (const jobStatus of ["closed", "expired"]) {
      it(`a ${status} application becomes 'closed' when its listing is ${jobStatus}, and the event records where it came from`, async () => {
        const t = seed(jobStatus, status);
        expect(await t.run()).toEqual({ closed: 1, reopened: 0 });
        expect(t.app().status).toBe("closed");
        expect(t.events()).toEqual([expect.objectContaining({ kind: "listing_closed", from_status: status, to_status: "closed", user_id: "u1" })]);
      });
    }
  }
  it("never touches an application that was already submitted or is past that stage", async () => {
    for (const status of ["applied", "assessment", "interview", "final_round", "offer", "rejected", "withdrawn"]) {
      const t = seed("closed", status);
      expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
      expect(t.app().status).toBe(status);
      expect(t.events()).toEqual([]);
    }
  });
  it("changes only the status: the student's letter and notes are untouched, and nothing is deleted", async () => {
    const t = seed("closed", "ready");
    await t.run();
    expect(t.app()).toMatchObject({ cover_letter: "my letter", notes: "my notes" });
    expect(t.db.log.some((l) => l.op === "delete")).toBe(false);
  });
  it("leaves an application alone while its listing is still active", async () => {
    const t = seed("active", "ready");
    expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
    expect(t.app().status).toBe("ready");
  });
  it("is idempotent: a second run changes nothing and adds no event", async () => {
    const t = seed("closed", "preparing");
    await t.run();
    expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
    expect(t.events()).toHaveLength(1);
  });
});

describe("reopening", () => {
  it("returns an application FRIDAY closed to the exact status it had", async () => {
    const t = seed("closed", "ready");
    await t.run();
    t.db.tables.jobs[0].status = "active";
    expect(await t.run()).toEqual({ closed: 0, reopened: 1 });
    expect(t.app().status).toBe("ready");
    expect(t.events().map((e) => e.kind)).toEqual(["listing_closed", "listing_reopened"]);
  });
  it("does NOT reopen an application the student closed themselves", async () => {
    const t = seed("active", "closed", [{ application_id: "app-1", user_id: "u1", kind: "status", from_status: "saved", to_status: "closed", created_at: "2026-09-20T00:00:00Z" }]);
    expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
    expect(t.app().status).toBe("closed");
  });
  it("uses the LATEST move to closed: if the student closed it after FRIDAY did, it stays closed", async () => {
    const t = seed("active", "closed", [
      { application_id: "app-1", user_id: "u1", kind: "listing_closed", from_status: "ready", to_status: "closed", created_at: "2026-09-20T00:00:00Z" },
      { application_id: "app-1", user_id: "u1", kind: "status", from_status: "ready", to_status: "closed", created_at: "2026-09-25T00:00:00Z" },
    ]);
    expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
    expect(t.app().status).toBe("closed");
  });
  it("stays closed while the listing is still not open", async () => {
    const t = seed("expired", "closed", [{ application_id: "app-1", user_id: "u1", kind: "listing_closed", from_status: "saved", to_status: "closed", created_at: "2026-09-20T00:00:00Z" }]);
    expect(await t.run()).toEqual({ closed: 0, reopened: 0 });
    expect(t.app().status).toBe("closed");
  });
});
