/** Who gets a card for which job (enqueue), against an in-memory database with the job loader stubbed. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/discovery/testing/fake-db";

vi.mock("server-only", () => ({}));
const jobs = vi.hoisted(() => [] as Row[]);
const desk = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/discovery/agent", () => ({
  loadActiveJobsForMatching: async (_db: unknown, ids?: string[]) => jobs.filter((j) => !ids || ids.includes(j.id as string)),
  loadMatchProfile: async () => ({ campusPrefs: { deskOnly: desk.on } }),
}));
import { enqueue } from "./pipeline";

const job = (id: string, over: Row = {}): Row => ({ id, is_on_campus: true, imported_by: null, campus_roles: ["front_desk_admin"], physical_demand: "moderate", ...over });

describe("enqueue", () => {
  it("campus desk jobs and the student's own Handshake imports; never someone else's import, off-campus jobs or non-desk work", async () => {
    jobs.splice(0, jobs.length,
      job("desk"),
      job("climbing-wall", { campus_roles: ["fitness_recreation"], physical_demand: "high" }),
      job("described-desk", { campus_roles: ["student_assistant"], physical_demand: "low" }),
      job("off-campus", { is_on_campus: false }),
      job("mine", { is_on_campus: false, imported_by: "u1" }),
      job("theirs", { imported_by: "u2" }),
    );
    const db = fakeDb({ hunter_links: [{ user_id: "u1", enabled: true, telegram_chat_id: 42 }, { user_id: "u3", enabled: true, telegram_chat_id: null }], hunt_items: [] });
    const c = db as unknown as SupabaseClient;
    expect(await enqueue(c, jobs.map((j) => j.id as string))).toBe(3);
    expect(db.tables.hunt_items.map((i) => `${i.user_id}:${i.job_id}`)).toEqual(["u1:desk", "u1:described-desk", "u1:mine"]);
    // Idempotent: the same jobs again queue nothing new.
    await enqueue(c, jobs.map((j) => j.id as string));
    expect(db.tables.hunt_items).toHaveLength(3);
  });
  it("desk only off → every visible campus job", async () => {
    desk.on = false;
    jobs.splice(0, jobs.length, job("desk"), job("climbing-wall", { campus_roles: ["fitness_recreation"], physical_demand: "high" }));
    const db = fakeDb({ hunter_links: [{ user_id: "u1", enabled: true, telegram_chat_id: 42 }], hunt_items: [] });
    expect(await enqueue(db as unknown as SupabaseClient, ["desk", "climbing-wall"])).toBe(2);
    desk.on = true;
  });
});
