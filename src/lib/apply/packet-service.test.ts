/**
 * The packet flow end to end against an in-memory database: build → review → approve → hand off. What is proven:
 * an approval binds to exact content and dies when the content changes, the hand-off re-checks the live listing,
 * and nothing the student owns is ever updated or deleted — only new rows are inserted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fakeDb, type Row } from "@/lib/discovery/testing/fake-db";

vi.mock("server-only", () => ({}));
import { buildResume } from "@/lib/resume/generate";
import type { CandidateItem, Section } from "@/lib/resume/types";
import { approvePacket, buildAndSavePacket, getPacketState, handOff, type Deps } from "./packet-service";

const T0 = Date.parse("2026-09-27T20:00:00Z");
let clock = T0;
const deps: Deps = { eligibility: async () => ({ verdict: "clear", headline: "No blockers found", checks: [], disclaimer: "" }), now: () => (clock += 1000) };

let n = 0;
const fact = (section: Section, data: unknown): Row => ({
  id: `f-${++n}`, user_id: "u1", section, position: n, data, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const FACTS = [
  fact("personal", { field: "name", value: "Sam Student" }), fact("personal", { field: "email", value: "sam@example.edu" }),
  fact("experience", { title: "Library Assistant", organization: "SJSU Library", location: "San Jose, CA", start: "Jan 2026", end: "May 2026", bullets: ["Helped students find sources"] }),
  fact("skill", { name: "Python", group: "Languages" }),
];
const doc = buildResume(FACTS as unknown as CandidateItem[]);

const world = (over: { job?: Row; app?: Row; extra?: Record<string, Row[]> } = {}) => {
  const db = fakeDb({
    profiles: [{ id: "u1", full_name: "Sam Student", university: "San José State University", major: "Computer Science", graduation_year: 2027, gpa: 3.6, work_authorization: "f1", availability: null, github_url: null, linkedin_url: null, portfolio_url: null }],
    candidate_items: FACTS.map((f) => ({ ...f })),
    companies: [{ id: "c1", name: "SJSU Library" }],
    jobs: [{ id: "job-1", title: "Student Assistant", status: "active", deadline: "2026-12-01", apply_url: "https://example.edu/apply/1", description: "Help students at the desk.", company_id: "c1", ...over.job }],
    job_sources: [{ job_id: "job-1", source_name: "sjsu_page", is_official: true }],
    applications: [{ id: "app-1", user_id: "u1", job_id: "job-1", status: "saved", resume_version_id: null, cover_letter: null, company_name: "SJSU Library", job_title: "Student Assistant", application_url: null, notes: "keep me", ...over.app }],
    resume_versions: [
      { id: "v-base", user_id: "u1", label: "From profile", kind: "base", job_id: null, is_master: true, created_at: "2026-09-01T00:00:00Z", content: doc },
      { id: "v-tailored", user_id: "u1", label: "Resume — SJSU Library", kind: "tailored", job_id: "job-1", is_master: false, created_at: "2026-09-10T00:00:00Z", content: doc },
      { id: "v-legacy", user_id: "u1", label: "Old AI draft", kind: "legacy", job_id: null, is_master: false, created_at: "2026-08-01T00:00:00Z", content: doc },
    ],
    application_documents: [], application_packets: [], packet_approvals: [], application_events: [],
    ...over.extra,
  });
  const c = db as unknown as SupabaseClient;
  return {
    db,
    build: (o = {}) => buildAndSavePacket(c, "u1", "app-1", o, deps),
    state: () => getPacketState(c, "u1", "app-1", deps),
    approve: (i: { packetId: string; contentHash: string; acknowledged?: string[] }) => approvePacket(c, "u1", "app-1", { acknowledged: [], ...i }, deps),
    handOff: () => handOff(c, "u1", "app-1", deps),
  };
};

describe("building a packet", () => {
  it("prepares a packet from the tailored resume for THIS job and the profile, saves it as a snapshot, and logs it", async () => {
    const w = world();
    const s = await w.build();
    expect(s.packet.resume).toMatchObject({ versionId: "v-tailored", label: "Resume — SJSU Library" });
    expect(s.packet.answers.find((a) => a.key === "email")?.value).toBe("sam@example.edu");
    expect(s.readiness).toBe("ready_for_approval");
    expect(w.db.tables.application_packets).toHaveLength(1);
    expect(w.db.tables.application_packets[0]).toMatchObject({ user_id: "u1", application_id: "app-1", content_hash: s.contentHash });
    expect(w.db.tables.application_events.map((e) => e.kind)).toEqual(["packet_built"]);
  });
  it("falls back to the master resume when nothing was tailored, and to no resume (a blocker) when there is none", async () => {
    const noTailored = world();
    noTailored.db.tables.resume_versions = noTailored.db.tables.resume_versions.filter((v) => v.id !== "v-tailored");
    expect((await noTailored.build()).packet.resume?.versionId).toBe("v-base");
    const none = world();
    none.db.tables.resume_versions = [];
    const s = await none.build();
    expect(s.packet.resume).toBeNull();
    expect(s.readiness).toBe("blocked");
    expect(s.issues.map((i) => i.code)).toContain("missing_resume");
  });
  it("the student's own choice of resume wins, and a legacy draft is refused", async () => {
    const w = world();
    expect((await w.build({ resumeVersionId: "v-base" })).packet.resume?.versionId).toBe("v-base");
    await expect(w.build({ resumeVersionId: "v-legacy" })).rejects.toMatchObject({ status: 422 });
    await expect(w.build({ resumeVersionId: "nope" })).rejects.toMatchObject({ status: 404 });
  });
  it("a cover letter saved by FRIDAY's AI stays marked AI-drafted (and needs a tick), even when re-saved untouched; the student's own text does not", async () => {
    const w = world({ extra: { application_documents: [{ application_id: "app-1", user_id: "u1", kind: "cover_letter", content: "Dear team, AI wrote this." }] }, app: { cover_letter: "Dear team, AI wrote this." } });
    const fromTracker = await w.build();
    expect(fromTracker.packet.coverLetter).toEqual({ text: "Dear team, AI wrote this.", origin: "ai_draft" });
    expect(fromTracker.confirmations).toEqual(["ai_cover_letter"]);
    const resaved = await w.build({ coverLetter: "Dear team, AI wrote this." });
    expect(resaved.packet.coverLetter?.origin).toBe("ai_draft");
    const edited = await w.build({ coverLetter: "Dear team, I wrote this myself." });
    expect(edited.packet.coverLetter?.origin).toBe("student");
    expect(edited.confirmations).toEqual([]);
  });
  it("an identical rebuild adds no new snapshot; a real change adds exactly one", async () => {
    const w = world();
    const a = await w.build();
    const b = await w.build();
    expect(b.packetId).toBe(a.packetId);
    expect(w.db.tables.application_packets).toHaveLength(1);
    const c = await w.build({ coverLetter: "Hello" });
    expect(c.packetId).not.toBe(a.packetId);
    expect(w.db.tables.application_packets).toHaveLength(2);
  });
  it("reported questions travel with the packet until the student answers them, and block approval meanwhile", async () => {
    const w = world();
    const s = await w.build({ extra: [{ question: "Why this role?", answer: null }] });
    expect(s.readiness).toBe("blocked");
    await expect(w.approve({ packetId: s.packetId, contentHash: s.contentHash })).rejects.toMatchObject({ status: 409 });
    const answered = await w.build({ extra: [{ question: "Why this role?", answer: "I like helping students." }] });
    expect(answered.readiness).toBe("ready_for_approval");
  });
  it("an application added by hand (no listing) is refused; another student's application is not found", async () => {
    const hand = world({ app: { job_id: null } });
    await expect(hand.build()).rejects.toMatchObject({ status: 422 });
    const other = world({ app: { user_id: "someone-else" } });
    await expect(other.build()).rejects.toMatchObject({ status: 404 });
  });
});

describe("approval", () => {
  it("records an approval bound to the exact content hash, with the ticks, and logs it", async () => {
    const w = world();
    const s = await w.build();
    const done = await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    expect(done.approval.state).toBe("approved");
    expect(w.db.tables.packet_approvals).toEqual([expect.objectContaining({ user_id: "u1", packet_id: s.packetId, content_hash: s.contentHash, acknowledged: [] })]);
    expect(w.db.tables.application_events.map((e) => e.kind)).toEqual(["packet_built", "packet_approved"]);
  });
  it("refuses a hash the client made up, and a packet that is not the latest", async () => {
    const w = world();
    const s = await w.build();
    await expect(w.approve({ packetId: s.packetId, contentHash: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await w.build({ coverLetter: "Newer" });
    await expect(w.approve({ packetId: s.packetId, contentHash: s.contentHash })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/newer packet/) });
    expect(w.db.tables.packet_approvals).toHaveLength(0);
  });
  it("needs every confirmation ticked", async () => {
    const w = world({ extra: { application_documents: [{ application_id: "app-1", user_id: "u1", kind: "cover_letter", content: "AI letter" }] }, app: { cover_letter: "AI letter" } });
    const s = await w.build();
    await expect(w.approve({ packetId: s.packetId, contentHash: s.contentHash })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Tick each confirmation/) });
    const ok = await w.approve({ packetId: s.packetId, contentHash: s.contentHash, acknowledged: ["ai_cover_letter"] });
    expect(ok.approval.state).toBe("approved");
    expect(w.db.tables.packet_approvals[0].acknowledged).toEqual(["ai_cover_letter"]);
  });
  it("ANY change to the content means a new packet with NO approval — the student must review and approve again", async () => {
    const w = world();
    const first = await w.build();
    await w.approve({ packetId: first.packetId, contentHash: first.contentHash });
    const changed = await w.build({ coverLetter: "A new paragraph the student added." });
    expect(changed.approval).toEqual({ state: "none" });
    expect((await w.state())!.approval).toEqual({ state: "none" });
    await expect(w.handOff()).rejects.toMatchObject({ status: 409, message: "Approve the packet first." });
  });
  it("an approval goes stale if the employer's apply link changes after approval", async () => {
    const w = world();
    const s = await w.build();
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    w.db.tables.jobs[0].apply_url = "https://example.edu/apply/NEW";
    expect((await w.state())!.approval).toMatchObject({ state: "stale" });
    await expect(w.handOff()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/changed after you approved/) });
  });
});

describe("hand-off", () => {
  it("returns the official link only for an approved packet, and logs that the student opened it", async () => {
    const w = world();
    await expect(w.handOff()).rejects.toMatchObject({ status: 404 });
    const s = await w.build();
    await expect(w.handOff()).rejects.toMatchObject({ status: 409, message: "Approve the packet first." });
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    expect(await w.handOff()).toEqual({ url: "https://example.edu/apply/1" });
    expect(w.db.tables.application_events.at(-1)).toMatchObject({ kind: "packet_handoff", user_id: "u1" });
  });
  it("RE-CHECKS the live listing at the click: closed since approval → refused, and no hand-off is logged", async () => {
    const w = world();
    const s = await w.build();
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    w.db.tables.jobs[0].status = "closed";
    await expect(w.handOff()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no longer listed as open/) });
    expect(w.db.tables.application_events.some((e) => e.kind === "packet_handoff")).toBe(false);
    expect((await w.state())!.readiness).toBe("blocked");
  });
  it("RE-CHECKS the deadline at the click", async () => {
    const w = world({ job: { deadline: "2026-09-28" } });
    const s = await w.build();
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    w.db.tables.jobs[0].deadline = "2026-09-20";
    await expect(w.handOff()).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/deadline .*has passed/) });
  });
});

describe("what the packet flow never does", () => {
  it("only INSERTS: no update or delete on anything, and the student's tracker row, resumes and profile are byte-for-byte unchanged", async () => {
    const w = world();
    const before = JSON.stringify({ a: w.db.tables.applications, r: w.db.tables.resume_versions, f: w.db.tables.candidate_items, p: w.db.tables.profiles, j: w.db.tables.jobs });
    w.db.log.length = 0;
    const s = await w.build({ coverLetter: "Hello" });
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    await w.handOff();
    expect(w.db.log.filter((l) => l.op === "update" || l.op === "delete" || l.op === "upsert")).toEqual([]);
    expect(JSON.stringify({ a: w.db.tables.applications, r: w.db.tables.resume_versions, f: w.db.tables.candidate_items, p: w.db.tables.profiles, j: w.db.tables.jobs })).toBe(before);
    expect([...new Set(w.db.log.filter((l) => l.op === "insert").map((l) => l.table))].sort()).toEqual(["application_events", "application_packets", "packet_approvals"]);
  });
  it("never marks the application as applied — only the student does that", async () => {
    const w = world();
    const s = await w.build();
    await w.approve({ packetId: s.packetId, contentHash: s.contentHash });
    await w.handOff();
    expect(w.db.tables.applications[0].status).toBe("saved");
    expect(w.db.tables.applications[0].applied_at).toBeUndefined();
  });
});
