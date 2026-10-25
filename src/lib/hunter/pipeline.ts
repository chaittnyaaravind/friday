/**
 * The hunter: new campus desk job → everything prepared → one Telegram card the student can approve from their phone.
 *
 *   enqueue()       which students get which new jobs (linked to Telegram, hunter on, the job is visible to them,
 *                   on campus or their own Handshake alert, and desk work if they asked for desk only — the default)
 *   processQueue()  per queued item: track it → tailored resume (deterministic, verified against the profile) →
 *                   application packet → optional AI summary → apply channel + email draft → Telegram card
 *
 * Nothing here sends anything to an employer. Approval and sending live in actions.ts and only follow the student's tap.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { packetDeps } from "@/lib/apply/packet-deps";
import { buildAndSavePacket } from "@/lib/apply/packet-service";
import { trackJob } from "@/lib/apply/track";
import { analyzeJob } from "@/lib/ai/tasks";
import { isAiConfigured } from "@/lib/ai/client";
import { loadActiveJobsForMatching, loadMatchProfile } from "@/lib/discovery/agent";
import { isDeskJob } from "@/lib/domain/campus-fit";
import { assessPhysical, isPhysicalLevel, type PhysicalFlag } from "@/lib/domain/physical";
import { parseTest, parseTestLine } from "@/lib/resume/parse-test";
import { tailorResume, type TailorCreated } from "@/lib/resume/tailor-service";
import type { ResumeDoc } from "@/lib/resume/types";
import { sendMessage, telegramConfigured } from "@/lib/telegram/bot";
import { applyChannel, type ApplyChannel } from "./apply-channel";
import { applicationEmail } from "./email-draft";
import { huntCard } from "./message";

const MAX_ATTEMPTS = 3;
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

type Link = { user_id: string; telegram_chat_id: number | null; bridge_token_hash: string | null; enabled: boolean };

async function activeLinks(db: SupabaseClient, userId?: string): Promise<Link[]> {
  let q = db.from("hunter_links").select("user_id, telegram_chat_id, bridge_token_hash, enabled").eq("enabled", true).not("telegram_chat_id", "is", null);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Link[];
}

/** Queue jobs for every student who would want them. Idempotent: one item per student and job, ever. */
export async function enqueue(db: SupabaseClient, jobIds: string[], opts: { userId?: string } = {}): Promise<number> {
  if (!jobIds.length) return 0;
  const links = await activeLinks(db, opts.userId);
  if (!links.length) return 0;
  const jobs = await loadActiveJobsForMatching(db, jobIds);
  let queued = 0;
  for (const l of links) {
    const profile = await loadMatchProfile(db, l.user_id);
    if (!profile) continue;
    const wanted = jobs.filter((j) => {
      if (j.imported_by && j.imported_by !== l.user_id) return false; // someone else's private import
      if (!j.is_on_campus && j.imported_by !== l.user_id) return false; // campus jobs, plus the student's own Handshake alerts
      return !profile.campusPrefs.deskOnly || isDeskJob(j.campus_roles, j.physical_demand);
    });
    if (!wanted.length) continue;
    const { data, error } = await db
      .from("hunt_items")
      .upsert(wanted.map((j) => ({ user_id: l.user_id, job_id: j.id })), { onConflict: "user_id,job_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    queued += data?.length ?? 0;
  }
  return queued;
}

/** Prepare and announce queued items until `deadline` (ms epoch). One failing item never stops the others. */
export async function processQueue(db: SupabaseClient, opts: { deadline: number; userId?: string; limit?: number }) {
  const report = { notified: 0, failed: 0, stale: 0, pending: 0, waiting: 0 };
  if (!telegramConfigured()) return { ...report, skipped: "telegram-not-configured" as const };
  // A claim older than CLAIM_TTL belongs to a run that died mid-way: give the item back to the queue.
  await db.from("hunt_items").update({ state: "queued", updated_at: new Date().toISOString() }).eq("state", "preparing").lt("updated_at", new Date(Date.now() - CLAIM_TTL_MS).toISOString());
  // Items waiting on a resume are left out of the batch (so they never crowd out other students' items) until their
  // student has resume facts; then they are released here and prepared in this same run.
  let w = db.from("hunt_items").select("user_id").eq("state", "queued").eq("error", NEEDS_RESUME).limit(200);
  if (opts.userId) w = w.eq("user_id", opts.userId);
  const { data: waitingRows } = await w;
  for (const uid of new Set((waitingRows ?? []).map((r) => r.user_id as string))) {
    const { data: facts } = await db.from("candidate_items").select("id").eq("user_id", uid).neq("status", "requires_confirmation").limit(1);
    if (facts?.length) await db.from("hunt_items").update({ error: null, updated_at: new Date().toISOString() }).eq("user_id", uid).eq("state", "queued").eq("error", NEEDS_RESUME);
    else report.waiting += (waitingRows ?? []).filter((r) => r.user_id === uid).length;
  }
  let q = db.from("hunt_items").select("id, user_id, job_id, attempts").eq("state", "queued").lt("attempts", MAX_ATTEMPTS).or(`error.is.null,error.neq.${NEEDS_RESUME}`).order("created_at").limit(opts.limit ?? 15);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: items, error } = await q;
  if (error) throw error;
  // A card without a tailored resume can't be approved, so a student with no confirmed resume facts gets ONE reminder
  // and their items wait (still queued, attempts untouched) until they upload; the next tick then prepares them.
  const ready = new Map<string, boolean>();
  for (const uid of new Set((items ?? []).map((i) => i.user_id as string))) {
    const { data: facts } = await db.from("candidate_items").select("id").eq("user_id", uid).neq("status", "requires_confirmation").limit(1);
    ready.set(uid, Boolean(facts?.length));
    if (!facts?.length) await remindToUpload(db, uid);
  }
  for (const it of items ?? []) {
    if (!ready.get(it.user_id as string)) {
      report.waiting++;
      continue;
    }
    if (Date.now() > opts.deadline) {
      report.pending++;
      continue;
    }
    // Claim it first: a concurrent run (the watch tick and a webhook) that loses the race skips it, so a card is sent once.
    const { data: claimed, error: claimError } = await db.from("hunt_items").update({ state: "preparing", updated_at: new Date().toISOString() }).eq("id", it.id).eq("state", "queued").select("id");
    // Until migration 0020 allows 'preparing', the claim is refused by the state check: prepare unclaimed (the old behaviour)
    // rather than stall the queue.
    if (claimError) console.error("hunter: claim unavailable (apply migration 0020):", claimError.message);
    else if (!claimed?.length) continue;
    try {
      const r = await prepareAndNotify(db, it as { id: string; user_id: string; job_id: string });
      report[r]++;
    } catch (e) {
      report.failed++;
      const attempts = (it.attempts as number) + 1;
      await db.from("hunt_items").update({ attempts, error: (e instanceof Error ? e.message : String(e)).slice(0, 500), state: attempts >= MAX_ATTEMPTS ? "failed" : "queued", updated_at: new Date().toISOString() }).eq("id", it.id);
    }
  }
  return report;
}

export const NEEDS_RESUME = "needs_resume";
const CLAIM_TTL_MS = 15 * 60_000;
/** The Gmail bridge counts as connected only once its Apps Script has checked in recently (it runs every 5 minutes). */
export const BRIDGE_LIVE_MS = 2 * 60 * 60_000;
export const bridgeLive = (l: { bridge_token_hash?: unknown; bridge_seen_at?: unknown } | null | undefined, now = Date.now()) =>
  Boolean(l?.bridge_token_hash && typeof l.bridge_seen_at === "string" && now - Date.parse(l.bridge_seen_at) < BRIDGE_LIVE_MS);

/** One reminder per wait: items already marked NEEDS_RESUME mean the student was told. */
async function remindToUpload(db: SupabaseClient, userId: string) {
  const { data: marked } = await db.from("hunt_items").select("id").eq("user_id", userId).eq("state", "queued").eq("error", NEEDS_RESUME).limit(1);
  if (marked?.length) return;
  const { data: link } = await db.from("hunter_links").select("telegram_chat_id").eq("user_id", userId).maybeSingle();
  const { data: waiting } = await db.from("hunt_items").select("id").eq("user_id", userId).eq("state", "queued");
  const count = waiting?.length ?? 0;
  if (link?.telegram_chat_id) {
    await sendMessage(link.telegram_chat_id as number, {
      text: `📄 ${count} SJSU desk job${count === 1 ? " is" : "s are"} waiting for you, but FRIDAY has no resume for this account yet.\nUpload your resume in FRIDAY → Resume and confirm what it found. Within 5 minutes the jobs arrive here with a tailored resume, ready to approve.`,
      buttons: [[{ text: "Upload resume", url: `${siteUrl()}/resume` }]],
    });
  }
  await db.from("hunt_items").update({ error: NEEDS_RESUME, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("state", "queued");
}

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

async function prepareAndNotify(db: SupabaseClient, it: { id: string; user_id: string; job_id: string }): Promise<"notified" | "stale"> {
  const userId = it.user_id;
  const [{ data: link }, [job]] = await Promise.all([
    db.from("hunter_links").select("telegram_chat_id, bridge_token_hash, bridge_seen_at").eq("user_id", userId).maybeSingle(),
    loadActiveJobsForMatching(db, [it.job_id]),
  ]);
  const stale = async (why: string) => {
    await db.from("hunt_items").update({ state: "stale", error: why, updated_at: new Date().toISOString() }).eq("id", it.id);
    return "stale" as const;
  };
  if (!link?.telegram_chat_id) return stale("Telegram is no longer linked");
  if (!job) return stale("The listing closed or was excluded before FRIDAY could prepare it");

  const [{ data: extra }, { data: match }, { data: sources }] = await Promise.all([
    db.from("jobs").select("pay_text, apply_url, deadline, description").eq("id", job.id).single(),
    db.from("job_matches").select("score").eq("user_id", userId).eq("job_id", job.id).maybeSingle(),
    // Public sources plus this student's own imports — never another student's private import of the same listing.
    db.from("job_sources").select("source_name, source, is_official").eq("job_id", job.id).or(`imported_by.is.null,imported_by.eq.${userId}`),
  ]);
  const description = (extra?.description as string | null) ?? null;
  const applyUrl = (extra?.apply_url as string | null) ?? null;

  const { application } = await trackJob(db, userId, job.id);
  const appId = application.id as string;

  let tailored: TailorCreated | null = null;
  let resumeProblem: string | null = null;
  try {
    tailored = (await tailorResume(db, userId, { jobId: job.id, accept: true })) as TailorCreated;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    resumeProblem = e.message;
  }
  const state = await buildAndSavePacket(db, userId, appId, tailored ? { resumeVersionId: tailored.version.id } : {}, packetDeps(db, userId));

  const research = description && description.length > 200 && isAiConfigured()
    ? await withTimeout(analyzeJob(job.title, job.companies?.name ?? "", description).catch(() => null), 25_000)
    : null;

  // The channel, decided now so the card says exactly what Approve will do.
  let channel: ApplyChannel = applyChannel(description, applyUrl);
  if (channel.kind === "email" && !bridgeLive(link)) {
    // A token alone is not a running bridge: unless the Apps Script has checked in, nothing would ever send the email.
    channel = { kind: "site", reason: link.bridge_token_hash
      ? `This job is applied to by email (${channel.to}), but your Gmail bridge hasn't checked in. Open the Apps Script and run setup(), and FRIDAY can send these from your Gmail.`
      : `This job is applied to by email (${channel.to}). Connect the Gmail bridge in FRIDAY → Settings and FRIDAY can send it from your Gmail next time.`, needs: [] };
  }
  let email: { to: string; subject: string; body: string } | null = null;
  if (channel.kind === "email") {
    const [{ data: p }, { data: auth }] = await Promise.all([
      db.from("profiles").select("full_name, university, major, graduation_year, availability").eq("id", userId).single(),
      db.auth.admin.getUserById(userId),
    ]);
    const draft = applicationEmail(
      { fullName: p?.full_name ?? null, university: p?.university ?? null, major: p?.major ?? null, graduationYear: p?.graduation_year ?? null, availability: p?.availability ?? null, email: auth?.user?.email ?? null },
      { title: job.title, employer: job.companies?.name ?? "your team" },
      state.packet.coverLetter?.text ?? null,
    );
    email = { to: channel.to, ...draft };
  }

  const flags = ((job.physical_flags ?? []) as PhysicalFlag[]).filter((f) => f.kind !== "schedule");
  const list = (sources ?? []) as { source_name: string; source: string; is_official: boolean }[];
  const viaHandshake = list.some((s) => s.source === "handshake_import");
  const report = tailored?.report;
  // The exact PDF Approve would send (actions.ts renders the same document, default template), read back like an ATS.
  let parsed: string | null = null;
  if (tailored) {
    const { data: v } = await db.from("resume_versions").select("content").eq("id", tailored.version.id).maybeSingle();
    const t = v ? await withTimeout(parseTest(v.content as ResumeDoc).catch(() => null), 15_000) : null;
    parsed = t ? parseTestLine(t) : null;
  }
  const blockers = [...(resumeProblem ? [resumeProblem] : []), ...state.issues.filter((i) => i.severity === "block").map((i) => i.message)];
  const card = huntCard({
    itemId: it.id,
    job: {
      title: job.title,
      employer: job.companies?.name ?? "SJSU",
      payText: (extra?.pay_text as string | null) ?? null,
      physical: isPhysicalLevel(job.physical_demand) ? job.physical_demand : "unknown",
      physicalWhy: flags.map((f) => (f.hedged ? `${f.text} (may be required)` : f.text)),
      deskWhy: assessPhysical(description).desk,
      source: viaHandshake ? "Your Handshake alert email" : list.find((s) => s.is_official) ? `Official page: ${list.find((s) => s.is_official)!.source_name}` : (list[0]?.source_name ?? "FRIDAY"),
      url: applyUrl,
      deadline: (extra?.deadline as string | null) ?? null,
    },
    score: (match?.score as number | undefined) ?? null,
    research: research ? { summary: research.summary, required: research.required } : null,
    resume: report
      ? {
          label: tailored!.version.label,
          matched: report.counts.matched ?? 0,
          total: report.requirements.length,
          missing: report.missing,
          changes: report.changedSections.map((c) => `${c.title}: ${c.detail}`),
          verified: report.verification.ok,
          rewrites: tailored!.ai.map((a) => ({ where: a.where, after: a.after })),
          parse: parsed,
        }
      : null,
    screens: tailored?.screens.map((s) => ({ label: s.label, covered: s.covered })),
    channel,
    email,
    confirmations: state.confirmations,
    blockers,
    appUrl: `${siteUrl()}/applications/${appId}/packet`,
  });
  const { messageId } = await sendMessage(link.telegram_chat_id as number, card);
  // The card is out: this write must land, or the item would look unsent. It stays claimed ('preparing') either way, so
  // a failed write is retried and logged, never answered by sending the card again.
  const done = () => db.from("hunt_items").update({
    state: "notified", application_id: appId, packet_id: state.packetId, content_hash: state.contentHash, confirmations: state.confirmations,
    channel: channel.kind, email_to: email?.to ?? null, email_subject: email?.subject ?? null, email_body: email?.body ?? null,
    research: research ?? null, telegram_message_id: messageId, notified_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
  }).eq("id", it.id);
  const { error: e1 } = await done();
  if (e1) {
    const { error: e2 } = await done();
    if (e2) console.error("hunter: card sent but not recorded", it.id, e2.message);
  }
  return "notified";
}
