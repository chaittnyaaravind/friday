/** Render tests for the packet screen: what the student reads, and which buttons are live in each state. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { approvalState, assessPacket, buildPacket, confirmationsNeeded, CONFIRM_TEXT, packetHash, readiness, type Packet, type PacketInput } from "@/lib/apply/packet";
import type { PacketState } from "@/lib/apply/packet-service";
import { buildResume } from "@/lib/resume/generate";
import type { CandidateItem, Section } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import { PacketReview } from "./packet-review";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const NOW = Date.parse("2026-09-27T20:00:00Z");
let n = 0;
const item = (section: Section, data: unknown): CandidateItem => ({
  id: `it-${++n}`, section, position: n, data: data as never, source: "user", source_text: null, source_resume_id: null, status: "user_confirmed", note: null, created_at: "", updated_at: "",
});
const ITEMS = [item("personal", { field: "name", value: "Sam Student" }), item("experience", { title: "Library Assistant", organization: "SJSU Library", location: "San Jose, CA", start: "Jan 2026", end: "May 2026", bullets: ["Helped students find sources"] }), item("skill", { name: "Python", group: "Languages" })];
const doc = buildResume(ITEMS);

const input = (over: Partial<PacketInput> = {}): PacketInput => ({
  job: { id: "job-1", title: "Student Assistant", company: "SJSU Library", status: "active", deadline: "2026-12-01", applyUrl: "https://www.example.edu/apply/1", source: "sjsu_page", official: true },
  description: "Help students at the desk.",
  profile: { name: "Sam Student", email: "sam@example.edu", phone: null, location: null, university: "San José State University", major: "Computer Science", graduationYear: 2027, gpa: null, workAuthorization: "f1", availability: null, github: null, linkedin: null, portfolio: null },
  resume: { versionId: "v-1", label: "Resume — SJSU Library", kind: "tailored", doc, verified: validateDoc(doc, ITEMS) },
  coverLetter: null, eligibility: { verdict: "clear", headline: "No blockers found", checks: [], disclaimer: "" }, extra: [], builtAt: "2026-09-27T20:00:00Z", ...over,
});
const stateOf = (over: Partial<PacketInput> = {}, opts: { approved?: boolean; ticks?: string[]; stale?: boolean } = {}): PacketState => {
  const packet: Packet = buildPacket(input(over));
  const issues = assessPacket(packet, NOW);
  const approval = opts.approved ? { contentHash: opts.stale ? "0".repeat(64) : packetHash(packet), acknowledged: opts.ticks ?? [], approvedAt: "2026-09-27T20:05:00Z" } : null;
  return { packetId: "11111111-1111-4111-8111-111111111111", packet, contentHash: packetHash(packet), issues, confirmations: confirmationsNeeded(issues), readiness: readiness(issues, opts.ticks ?? []), approval: approvalState(packet, approval), acknowledged: opts.ticks ?? [] };
};

const VERSIONS = [{ id: "v-1", label: "Resume — SJSU Library", kind: "tailored" }, { id: "v-0", label: "From profile", kind: "base" }];
const render = (state: PacketState | null) => renderToStaticMarkup(createElement(PacketReview, { applicationId: "a-1", state, versions: VERSIONS, confirmText: CONFIRM_TEXT, aiConfigured: true }));
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ").trim();
/** Is the button with this label disabled? */
const disabled = (h: string, label: string) => {
  const b = h.split("<button").slice(1).map((s) => s.split("</button>")[0]).find((s) => text(s).includes(label));
  if (!b) throw new Error(`no button "${label}"`);
  // The attribute React renders (`disabled=""`) — not Tailwind's `disabled:` class variants.
  return /^[^>]*\sdisabled=""/.test(b);
};

describe("before a packet exists", () => {
  it("offers to prepare one and says nothing goes anywhere", () => {
    const h = render(null);
    expect(text(h)).toContain("before anything goes anywhere");
    expect(disabled(h, "Prepare packet")).toBe(false);
  });
});

describe("a ready packet", () => {
  const h = render(stateOf());
  const t = text(h);
  it("shows exactly what would be submitted: the resume text, the profile answers, and what is missing", () => {
    expect(t).toContain("Exactly what you would submit");
    expect(t).toContain("Helped students find sources");
    expect(t).toContain("Sam Student");
    expect(t).toContain("sam@example.edu");
    expect(t).toContain("F-1 student visa");
    expect(t).toContain("not on your profile — you would enter it yourself");
  });
  it("shows the packet's fingerprint, and that FRIDAY does not submit, naming the employer's site", () => {
    expect(t).toContain(`packet ${stateOf().contentHash.slice(0, 8)}`);
    expect(t).toContain("FRIDAY doesn't submit applications");
    expect(t).toContain("example.edu");
  });
  it("is ready for approval: Approve is live, but the official application stays closed until it is approved", () => {
    expect(t).toContain("Ready for your approval");
    expect(disabled(h, "Approve this packet")).toBe(false);
    expect(disabled(h, "Open the official application")).toBe(true);
  });
  it("has no control that submits anything", () => {
    expect(t).not.toMatch(/\b(Submit application|Apply for me|Auto-?apply|Send application)\b/i);
  });
});

describe("blockers and confirmations", () => {
  it("a blocked packet lists why and cannot be approved", () => {
    const h = render(stateOf({ resume: null }));
    expect(text(h)).toContain("Choose the resume you will send");
    expect(text(h)).toContain("Blocked");
    expect(disabled(h, "Approve this packet")).toBe(true);
    expect(text(h)).toContain("Resolve the items above first");
  });
  it("a closed listing is a blocker", () => {
    const h = render(stateOf({ job: { ...input().job, status: "closed" } }));
    expect(text(h)).toContain("no longer listed as open");
    expect(disabled(h, "Approve this packet")).toBe(true);
  });
  it("a confirmation shows FRIDAY's note and the sentence the student is agreeing to, and blocks approval until ticked", () => {
    const s = stateOf({ profile: { ...input().profile, workAuthorization: null } });
    const h = render(s);
    expect(text(h)).toContain("My work authorization is not on my profile");
    expect(text(h)).toContain("Needs your confirmation");
    expect(disabled(h, "Approve this packet")).toBe(true);
    expect(text(h)).toContain("Tick each confirmation to approve");
  });
  it("an AI-drafted cover letter is labelled as such", () => {
    const h = render(stateOf({ coverLetter: { text: "Dear team, hello.", origin: "ai_draft" } }));
    expect(text(h)).toContain("AI draft — you confirm it");
    expect(text(h)).toContain("Dear team, hello.");
  });
  it("a question the student reported but has not answered blocks approval", () => {
    const h = render(stateOf({ extra: [{ question: "Why this role?", answer: null }] }));
    expect(h).toContain("Why this role?");
    expect(disabled(h, "Approve this packet")).toBe(true);
  });
});

describe("after approval", () => {
  it("shows Approved for this exact packet, hides Approve, and opens the official application", () => {
    const h = render(stateOf({}, { approved: true }));
    expect(text(h)).toContain("Approved — this exact packet");
    expect(h).not.toContain("Approve this packet");
    expect(disabled(h, "Open the official application")).toBe(false);
  });
  it("an approval that no longer matches is shown as changed, and the official application is closed again", () => {
    const h = render(stateOf({}, { approved: true, stale: true }));
    expect(text(h)).toContain("Changed since you approved it");
    expect(disabled(h, "Open the official application")).toBe(true);
    expect(disabled(h, "Approve this packet")).toBe(false);
  });
});
