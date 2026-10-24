/**
 * The Telegram buttons and the Gmail bridge receipt, against an in-memory database. Proven: an approval happens only for
 * the exact content the card showed, at most once; email jobs go to the outbox (never straight out); "applied" is set
 * only by the student's tap or the bridge's sent receipt, and a failed send marks nothing applied.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/discovery/testing/fake-db";

vi.mock("server-only", () => ({}));
const packet = vi.hoisted(() => ({ state: null as null | Record<string, unknown>, approved: [] as unknown[] }));
vi.mock("@/lib/apply/packet-service", () => ({
  getPacketState: async () => packet.state,
  approvePacket: async (_db: unknown, _u: string, _a: string, input: unknown) => void packet.approved.push(input),
  handOff: async () => ({ url: "https://www.sjsu.edu/apply" }),
}));
const moves = vi.hoisted(() => [] as { to: string; evidence?: string }[]);
vi.mock("@/lib/apply/track", () => ({ moveStatus: async (_db: unknown, _u: string, _a: string, to: string, o: { evidence?: string } = {}) => void moves.push({ to, evidence: o.evidence }) }));
const tg = vi.hoisted(() => ({ sent: [] as string[], docs: 0 }));
vi.mock("@/lib/telegram/bot", () => ({
  sendMessage: async (_c: number, m: { text: string }) => (tg.sent.push(m.text), { messageId: 9 }),
  editMessage: async (_c: number, _id: number, m: { text: string }) => void tg.sent.push(m.text),
  sendDocument: async () => void tg.docs++,
}));
vi.mock("@/lib/resume/export", () => ({ renderPdf: async () => new Uint8Array([37, 80, 68, 70]) }));

import { approve, loadItem, markApplied, recordSent, skip } from "./actions";

const HASH = "a".repeat(64);
const item = (over: Row = {}): Row => ({
  id: "11111111-1111-1111-1111-111111111111", user_id: "u1", job_id: "job-1", application_id: "app-1", packet_id: "p-1", content_hash: HASH,
  confirmations: ["eligibility_verify"], channel: "email", email_to: "desk@sjsu.edu", email_subject: "Application: Office Assistant", email_body: "Hello,", state: "notified", telegram_message_id: 5, ...over,
});
const world = (it: Row = item()) => {
  const db = fakeDb({
    hunt_items: [it],
    hunter_links: [{ user_id: "u1", telegram_chat_id: 42 }],
    applications: [{ id: "app-1", user_id: "u1", job_title: "Office Assistant", company_name: "SJSU Parking Services" }],
    profiles: [{ id: "u1", full_name: "Sam Lee" }],
    resume_versions: [{ id: "v-1", user_id: "u1", content: {} }],
    outbox: [],
  });
  return { db, c: db as unknown as SupabaseClient };
};
const current = async (c: SupabaseClient) => (await loadItem(c, "11111111-1111-1111-1111-111111111111"))!;

beforeEach(() => {
  packet.state = { packetId: "p-1", contentHash: HASH, packet: { resume: { versionId: "v-1" } } };
  packet.approved = [];
  moves.length = 0;
  tg.sent = [];
  tg.docs = 0;
});

describe("Approve", () => {
  it("email job: approves exactly the shown content with the shown confirmations, then queues the email (does not send it)", async () => {
    const { db, c } = world();
    expect(await approve(c, await current(c), 42)).toMatch(/sending from your Gmail/);
    expect(packet.approved).toEqual([{ packetId: "p-1", contentHash: HASH, acknowledged: ["eligibility_verify"] }]);
    expect(db.tables.outbox).toHaveLength(1);
    expect(db.tables.outbox[0]).toMatchObject({ to_email: "desk@sjsu.edu", resume_version_id: "v-1" });
    expect(db.tables.hunt_items[0].state).toBe("sending");
    expect(moves).toEqual([{ to: "ready", evidence: undefined }]);
  });
  it("a second tap does nothing", async () => {
    const { db, c } = world();
    const first = await current(c);
    await approve(c, first, 42);
    expect(await approve(c, first, 42)).toBe("Already handled.");
    expect(packet.approved).toHaveLength(1);
    expect(db.tables.outbox).toHaveLength(1);
  });
  it("content changed since the card: nothing approved, nothing queued, a fresh card is prepared", async () => {
    packet.state = { packetId: "p-1", contentHash: "b".repeat(64), packet: { resume: { versionId: "v-1" } } };
    const { db, c } = world();
    expect(await approve(c, await current(c), 42)).toMatch(/not approved/);
    expect(packet.approved).toEqual([]);
    expect(db.tables.outbox).toEqual([]);
    expect(db.tables.hunt_items[0].state).toBe("queued");
  });
  it("site job: approval sends the student the resume and the link; nothing is marked applied", async () => {
    const { db, c } = world(item({ channel: "site", email_to: null }));
    await approve(c, await current(c), 42);
    expect(tg.docs).toBe(1);
    expect(db.tables.outbox).toEqual([]);
    expect(db.tables.hunt_items[0].state).toBe("handed_off");
    expect(moves.map((m) => m.to)).toEqual(["ready"]);
  });
});

describe("Skip and I applied", () => {
  it("skip changes nothing but the card", async () => {
    const { db, c } = world();
    await skip(c, await current(c), 42);
    expect(db.tables.hunt_items[0].state).toBe("skipped");
    expect(moves).toEqual([]);
  });
  it("'I applied' only after a hand-off, and it moves the tracker to applied", async () => {
    const { c } = world(item({ state: "notified" }));
    expect(await markApplied(c, await current(c), 42)).toBe("Approve it first.");
    const w = world(item({ state: "handed_off" }));
    await markApplied(w.c, await current(w.c), 42);
    expect(moves.map((m) => m.to)).toEqual(["applied"]);
  });
});

describe("Gmail bridge receipt", () => {
  const withOutbox = (state = "claimed") => {
    const w = world(item({ state: "sending" }));
    w.db.tables.outbox.push({ id: "o-1", user_id: "u1", hunt_item_id: item().id, application_id: "app-1", to_email: "desk@sjsu.edu", state });
    return w;
  };
  it("sent → applied, with the Gmail message id as evidence, and a confirmation message", async () => {
    const { db, c } = withOutbox();
    await recordSent(c, "u1", "o-1", { messageId: "18c0ffee" });
    expect(db.tables.outbox[0].state).toBe("sent");
    expect(moves[0].to).toBe("applied");
    expect(moves[0].evidence).toMatch(/Sent from your Gmail to desk@sjsu\.edu .*18c0ffee/);
    expect(tg.sent.at(-1)).toMatch(/Sent/);
  });
  it("a failed send marks nothing applied and tells the student", async () => {
    const { db, c } = withOutbox();
    await recordSent(c, "u1", "o-1", { error: "Daily sending limit reached" });
    expect(db.tables.outbox[0].state).toBe("failed");
    expect(moves).toEqual([]);
    expect(tg.sent.at(-1)).toMatch(/could not send/);
  });
  it("another student's outbox row is not found", async () => {
    const { c } = withOutbox();
    await expect(recordSent(c, "u2", "o-1", { messageId: "x" })).rejects.toThrow("Not found");
  });
});
