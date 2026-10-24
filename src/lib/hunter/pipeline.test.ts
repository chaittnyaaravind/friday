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
const sent = vi.hoisted(() => [] as { chat: number; text: string }[]);
vi.mock("@/lib/telegram/bot", () => ({
  telegramConfigured: () => true,
  sendMessage: async (chat: number, m: { text: string }) => { sent.push({ chat, text: m.text }); return { messageId: 1 }; },
}));
import { enqueue, NEEDS_RESUME, processQueue } from "./pipeline";

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


describe("processQueue with no resume on the account", () => {
  it("holds the items (still queued, attempts untouched), reminds ONCE, and prepares nothing", async () => {
    sent.length = 0;
    const db = fakeDb({
      hunter_links: [{ user_id: "u1", enabled: true, telegram_chat_id: 42, bridge_token_hash: null }],
      hunt_items: [
        { id: "h1", user_id: "u1", job_id: "desk", state: "queued", attempts: 0, error: null, created_at: "2026-10-24T00:00:00Z" },
        { id: "h2", user_id: "u1", job_id: "desk2", state: "queued", attempts: 0, error: null, created_at: "2026-10-24T00:00:01Z" },
      ],
      candidate_items: [{ id: "c1", user_id: "u1", status: "requires_confirmation" }],
    });
    const c = db as unknown as SupabaseClient;
    const r = await processQueue(c, { deadline: Date.now() + 60_000 });
    expect(r).toMatchObject({ waiting: 2, notified: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chat: 42 });
    expect(sent[0].text).toContain("2 SJSU desk jobs are waiting");
    expect(db.tables.hunt_items.map((i) => [i.state, i.attempts, i.error])).toEqual([["queued", 0, NEEDS_RESUME], ["queued", 0, NEEDS_RESUME]]);
    // The next tick: still waiting, no second reminder.
    await processQueue(c, { deadline: Date.now() + 60_000 });
    expect(sent).toHaveLength(1);
  });

  it("a student WITH confirmed resume facts is not held", async () => {
    sent.length = 0;
    const db = fakeDb({
      hunter_links: [{ user_id: "u1", enabled: true, telegram_chat_id: 42, bridge_token_hash: null }],
      hunt_items: [{ id: "h1", user_id: "u1", job_id: "gone", state: "queued", attempts: 0, error: null, created_at: "2026-10-24T00:00:00Z" }],
      candidate_items: [{ id: "c1", user_id: "u1", status: "user_confirmed" }],
    });
    jobs.splice(0, jobs.length); // the listing closed: the item is prepared (and found stale), not held
    const r = await processQueue(db as unknown as SupabaseClient, { deadline: Date.now() + 60_000 });
    expect(r).toMatchObject({ waiting: 0, stale: 1 });
    expect(sent).toHaveLength(0);
  });
});
