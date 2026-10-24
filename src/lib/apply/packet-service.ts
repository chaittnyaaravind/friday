/**
 * The application packet, against the database. Every function here either READS, or INSERTS a new row (a packet
 * snapshot, an approval, an event). None updates or deletes anything the student wrote, and none calls an outside service.
 *
 * Only two things ever leave FRIDAY toward an employer, and both are the student's own action:
 *   - the student opens the official application link (handOff returns it only for an approved, unchanged, still-open packet)
 *   - the student submits on the employer's site and tells FRIDAY (the tracker's existing "Applied" move)
 */
import { excludedMessage } from "@/lib/domain/exclusions";
import { ANSWER_DRAFT_TITLE } from "./questions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import type { EligibilityResult } from "@/lib/domain/eligibility";
import { loadProfileItems } from "@/lib/resume/profile";
import { isEligible, type CandidateItem, type ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import {
  approvalState, assessPacket, buildPacket, canHandOff, confirmationsNeeded, packetHash, readiness, validateApproval,
  type Approval, type ApprovalState, type ExtraQuestion, type Packet, type PacketIssue, type PacketProfile, type Readiness,
} from "./packet";

export type Deps = {
  /** Eligibility for this student and job, or null when it cannot be computed (e.g. the listing is closed). */
  eligibility: (jobId: string) => Promise<EligibilityResult | null>;
  now?: () => number;
};

export type BuildOptions = {
  resumeVersionId?: string | null;
  /** undefined = keep what the last packet had; null = remove it; a string = the student's own text. */
  coverLetter?: string | null;
  extra?: ExtraQuestion[];
};

export type PacketState = {
  packetId: string;
  packet: Packet;
  contentHash: string;
  issues: PacketIssue[];
  readiness: Readiness;
  confirmations: string[];
  approval: ApprovalState;
  /** The ticks recorded with the current approval, if any. */
  acknowledged: string[];
};

type Row = Record<string, unknown>;
const later = (a: Row, b: Row) => String(a.created_at).localeCompare(String(b.created_at));
/** The newest row; among equal timestamps, the one inserted last. */
const latest = <T extends Row>(rows: T[] | null | undefined): T | null => {
  if (!rows?.length) return null;
  return rows.map((r, i) => ({ r, i })).sort((x, y) => later(x.r, y.r) || x.i - y.i).at(-1)!.r;
};

async function loadApplication(db: SupabaseClient, userId: string, applicationId: string) {
  const { data: app, error } = await db.from("applications").select("id, job_id, resume_version_id, cover_letter, company_name, job_title, application_url").eq("id", applicationId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!app) throw new HttpError(404, "Application not found");
  if (!app.job_id) throw new HttpError(422, "This application was added by hand, so there is no listing to prepare a packet for.");
  return app as { id: string; job_id: string; resume_version_id: string | null; cover_letter: string | null; company_name: string; job_title: string; application_url: string | null };
}

/** The listing as it is RIGHT NOW — status, deadline and link are re-read every time, never trusted from a snapshot. */
async function loadLiveJob(db: SupabaseClient, jobId: string) {
  const { data: job, error } = await db.from("jobs").select("id, title, status, deadline, apply_url, description, company_id, excluded_reason").eq("id", jobId).maybeSingle();
  if (error) throw error;
  if (!job) throw new HttpError(404, "This opportunity no longer exists.");
  if (job.excluded_reason) throw new HttpError(409, excludedMessage(job.excluded_reason as string));
  const [{ data: company }, { data: sources }] = await Promise.all([
    db.from("companies").select("name").eq("id", job.company_id).maybeSingle(),
    db.from("job_sources").select("source_name, is_official").eq("job_id", jobId),
  ]);
  const list = (sources ?? []) as { source_name: string; is_official: boolean }[];
  const best = list.find((s) => s.is_official) ?? list[0] ?? null;
  return {
    description: (job.description as string | null) ?? null,
    job: {
      id: job.id as string, title: job.title as string, company: (company?.name as string | undefined) ?? "Unknown", status: job.status as string,
      deadline: (job.deadline as string | null) ?? null, applyUrl: (job.apply_url as string | null) ?? null, source: best?.source_name ?? null, official: Boolean(best?.is_official),
    },
  };
}

function profileFrom(row: Row | null, items: CandidateItem[]): PacketProfile {
  const personal = (field: string) => {
    const it = items.filter(isEligible).find((i) => i.section === "personal" && (i.data as { field?: string }).field === field);
    return it ? ((it.data as { value?: string }).value ?? null) : null;
  };
  const str = (k: string) => (typeof row?.[k] === "string" ? (row[k] as string) : null);
  return {
    name: str("full_name") ?? personal("name"), email: personal("email"), phone: personal("phone"), location: personal("location"),
    university: str("university"), major: str("major"), graduationYear: typeof row?.graduation_year === "number" ? row.graduation_year : null,
    gpa: row?.gpa == null ? null : Number(row.gpa), workAuthorization: str("work_authorization"), availability: str("availability"),
    github: str("github_url"), linkedin: str("linkedin_url"), portfolio: str("portfolio_url"),
  };
}

/** Which resume goes in the packet when the student has not chosen: the last packet's → the tracker's → tailored for THIS job → master. Shown, never hidden. */
async function defaultResumeId(db: SupabaseClient, userId: string, app: { job_id: string; resume_version_id: string | null }, previous: Packet | null): Promise<string | null> {
  if (previous?.resume) return previous.resume.versionId;
  if (app.resume_version_id) return app.resume_version_id;
  const { data: versions } = await db.from("resume_versions").select("id, kind, job_id, is_master, created_at").eq("user_id", userId);
  const rows = (versions ?? []) as { id: string; kind: string; job_id: string | null; is_master: boolean; created_at: string }[];
  return latest(rows.filter((v) => v.kind === "tailored" && v.job_id === app.job_id))?.id ?? rows.find((v) => v.is_master)?.id ?? null;
}

export async function loadLatestPacket(db: SupabaseClient, userId: string, applicationId: string): Promise<{ id: string; packet: Packet; contentHash: string } | null> {
  const { data: all, error } = await db.from("application_packets").select("id, created_at").eq("application_id", applicationId).eq("user_id", userId);
  if (error) throw error;
  const newest = latest((all ?? []) as Row[]);
  if (!newest) return null;
  const { data: row, error: e2 } = await db.from("application_packets").select("id, packet, content_hash").eq("id", newest.id).eq("user_id", userId).maybeSingle();
  if (e2) throw e2;
  return row ? { id: row.id as string, packet: row.packet as Packet, contentHash: row.content_hash as string } : null;
}

async function loadApproval(db: SupabaseClient, userId: string, packetId: string): Promise<Approval | null> {
  const { data, error } = await db.from("packet_approvals").select("content_hash, acknowledged, approved_at").eq("packet_id", packetId).eq("user_id", userId);
  if (error) throw error;
  const a = latest(((data ?? []) as Row[]).map((r): Row => ({ ...r, created_at: r.approved_at })));
  return a ? { contentHash: a.content_hash as string, acknowledged: (a.acknowledged as string[]) ?? [], approvedAt: a.approved_at as string } : null;
}

/** Build a NEW packet snapshot from what the student has now, and save it. Nothing existing is changed. */
export async function buildAndSavePacket(db: SupabaseClient, userId: string, applicationId: string, opts: BuildOptions, deps: Deps): Promise<PacketState> {
  const now = deps.now?.() ?? Date.now();
  const app = await loadApplication(db, userId, applicationId);
  const previous = await loadLatestPacket(db, userId, applicationId);
  const [{ job, description }, items, { data: profileRow }] = await Promise.all([
    loadLiveJob(db, app.job_id),
    loadProfileItems(db, userId),
    db.from("profiles").select("full_name, university, major, graduation_year, gpa, work_authorization, availability, github_url, linkedin_url, portfolio_url").eq("id", userId).maybeSingle(),
  ]);

  const resumeId = opts.resumeVersionId !== undefined ? opts.resumeVersionId : await defaultResumeId(db, userId, app, previous?.packet ?? null);
  let resume = null;
  if (resumeId) {
    const { data: v } = await db.from("resume_versions").select("id, label, kind, content").eq("id", resumeId).eq("user_id", userId).maybeSingle();
    if (!v) throw new HttpError(404, "That resume was not found.");
    if (v.kind === "legacy") throw new HttpError(422, "This is a legacy draft that FRIDAY cannot verify. Choose a resume built from your profile.");
    const doc = v.content as ResumeDoc;
    resume = { versionId: v.id as string, label: v.label as string, kind: v.kind as string, doc, verified: validateDoc(doc, items) };
  }

  // The cover letter: the student's text if they gave one; else the last packet's; else the tracker's draft. A text that is
  // exactly an AI draft FRIDAY saved stays marked as AI-drafted, so it cannot lose its confirmation by being re-saved untouched.
  const { data: docs } = await db.from("application_documents").select("kind, title, content").eq("application_id", applicationId).eq("user_id", userId);
  const docRows = (docs ?? []) as { kind: string; title?: string | null; content: string | null }[];
  const aiDrafts = docRows.filter((d) => d.kind === "cover_letter" && d.content).map((d) => d.content!.trim());
  // AI-drafted answers are saved as documents titled "Answer draft — …" (api/applications/[id]/answers). An answer that is
  // exactly one of them is marked ai_draft, whatever the browser claims; an edited one is the student's own.
  const answerDrafts = new Set(docRows.filter((d) => d.kind === "other" && d.title?.startsWith(ANSWER_DRAFT_TITLE) && d.content).map((d) => d.content!.trim()));
  const origin = (text: string) => (aiDrafts.includes(text.trim()) ? ("ai_draft" as const) : ("student" as const));
  let coverLetter: { text: string; origin: "student" | "ai_draft" } | null;
  if (opts.coverLetter === null) coverLetter = null;
  else if (typeof opts.coverLetter === "string") coverLetter = opts.coverLetter.trim() ? { text: opts.coverLetter, origin: origin(opts.coverLetter) } : null;
  else if (previous?.packet.coverLetter) coverLetter = previous.packet.coverLetter;
  else coverLetter = app.cover_letter?.trim() ? { text: app.cover_letter, origin: origin(app.cover_letter) } : null;

  const packet = buildPacket({
    job, description, profile: profileFrom(profileRow as Row | null, items), resume, coverLetter,
    eligibility: job.status === "active" ? await deps.eligibility(job.id) : null,
    extra: (opts.extra ?? previous?.packet.extra ?? []).map((e) => ({ ...e, origin: e.answer && answerDrafts.has(e.answer.trim()) ? ("ai_draft" as const) : ("student" as const) })),
    builtAt: new Date(now).toISOString(),
  });
  const contentHash = packetHash(packet);

  // Identical to the last snapshot: keep it (no duplicate rows, and its approval stays valid).
  if (previous && previous.contentHash === contentHash) return stateOf(db, userId, previous.id, previous.packet, now);

  const { data: saved, error } = await db.from("application_packets").insert({
    user_id: userId, application_id: applicationId, job_id: job.id, resume_version_id: resume?.versionId ?? null, packet, content_hash: contentHash, created_at: packet.builtAt,
  }).select("id").single();
  if (error) throw error;
  await db.from("application_events").insert({ application_id: applicationId, user_id: userId, kind: "packet_built", note: `Packet ${contentHash.slice(0, 8)}` });
  return stateOf(db, userId, saved.id as string, packet, now);
}

/** The listing's LIVE status, deadline and link laid over the snapshot — an approval is judged against reality, not against yesterday. */
async function overlayLive(db: SupabaseClient, packet: Packet): Promise<Packet> {
  const live = await loadLiveJob(db, packet.job.id).catch(() => null);
  if (!live) return { ...packet, job: { ...packet.job, status: "closed" } };
  return { ...packet, job: { ...packet.job, status: live.job.status, deadline: live.job.deadline, applyUrl: live.job.applyUrl } };
}

async function stateOf(db: SupabaseClient, userId: string, packetId: string, snapshot: Packet, now: number): Promise<PacketState> {
  const packet = await overlayLive(db, snapshot);
  const issues = assessPacket(packet, now);
  const approval = await loadApproval(db, userId, packetId);
  return {
    packetId, packet, contentHash: packetHash(packet), issues, confirmations: confirmationsNeeded(issues),
    readiness: readiness(issues, approval?.acknowledged ?? []), approval: approvalState(packet, approval), acknowledged: approval?.acknowledged ?? [],
  };
}

export async function getPacketState(db: SupabaseClient, userId: string, applicationId: string, deps: Pick<Deps, "now"> = {}): Promise<PacketState | null> {
  await loadApplication(db, userId, applicationId);
  const current = await loadLatestPacket(db, userId, applicationId);
  return current ? stateOf(db, userId, current.id, current.packet, deps.now?.() ?? Date.now()) : null;
}

/** Record the student's explicit approval of exactly this content. */
export async function approvePacket(db: SupabaseClient, userId: string, applicationId: string, input: { packetId: string; contentHash: string; acknowledged: string[] }, deps: Pick<Deps, "now"> = {}) {
  const now = deps.now?.() ?? Date.now();
  await loadApplication(db, userId, applicationId);
  const current = await loadLatestPacket(db, userId, applicationId);
  if (!current) throw new HttpError(404, "There is no packet to approve. Prepare one first.");
  if (current.id !== input.packetId) throw new HttpError(409, "A newer packet exists. Reload and review it.");
  const packet = await overlayLive(db, current.packet);
  const checked = validateApproval(packet, input.contentHash, input.acknowledged, now);
  if (!checked.ok) throw new HttpError(409, checked.reason);

  const { error } = await db.from("packet_approvals").insert({ user_id: userId, packet_id: current.id, application_id: applicationId, content_hash: checked.contentHash, acknowledged: input.acknowledged, approved_at: new Date(now).toISOString() });
  if (error) throw error;
  await db.from("application_events").insert({ application_id: applicationId, user_id: userId, kind: "packet_approved", note: `Approved packet ${checked.contentHash.slice(0, 8)}` });
  return stateOf(db, userId, current.id, current.packet, now);
}

/**
 * The student clicked "Open the official application". Re-checks everything now and returns the link only if it is still
 * approved, unchanged and open. Records that it happened. FRIDAY opens nothing itself.
 */
export async function handOff(db: SupabaseClient, userId: string, applicationId: string, deps: Pick<Deps, "now"> = {}): Promise<{ url: string }> {
  const now = deps.now?.() ?? Date.now();
  await loadApplication(db, userId, applicationId);
  const current = await loadLatestPacket(db, userId, applicationId);
  if (!current) throw new HttpError(404, "There is no packet. Prepare one first.");
  const packet = await overlayLive(db, current.packet);
  const approval = await loadApproval(db, userId, current.id);
  const verdict = canHandOff(packet, approval, now);
  if (!verdict.ok) throw new HttpError(409, verdict.reason);
  await db.from("application_events").insert({ application_id: applicationId, user_id: userId, kind: "packet_handoff", note: `Opened the official application with packet ${packetHash(packet).slice(0, 8)}` });
  return { url: packet.job.applyUrl! };
}
