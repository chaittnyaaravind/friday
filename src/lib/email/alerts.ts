/**
 * Decides which emails each student should get, then hands them to sendMail (which enforces configuration,
 * duplicate suppression, rate limits and logging). Respects each student's notification preferences and opt-out.
 * `dryRun` reports what WOULD be sent without sending or logging anything — used to verify against real data.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePrefs } from "@/lib/domain/notify-prefs";
import { emailConfigured, sendMail, type EmailKind } from "./send";
import { followUpEmail, interviewEmail, newMatchesEmail, statusChangeEmail, type Mail } from "./templates";
import { unsubscribeUrl } from "./token";

export type AlertReport = {
  configured: boolean;
  dryRun: boolean;
  users: number;
  sent: number;
  failed: number;
  wouldSend: number;
  skipped: Record<string, number>;
};

type Planned = { kind: EmailKind; dedupeKey: string; mail: Mail };
const HOUR = 3_600_000;
type Ref = { id: string; company_name: string; job_title: string } | null;

export async function runEmailAlerts(db: SupabaseClient, opts: { siteUrl?: string; now?: number; dryRun?: boolean } = {}): Promise<AlertReport> {
  const now = opts.now ?? Date.now();
  const report: AlertReport = { configured: emailConfigured(), dryRun: Boolean(opts.dryRun), users: 0, sent: 0, failed: 0, wouldSend: 0, skipped: {} };
  const skip = (why: string) => void (report.skipped[why] = (report.skipped[why] ?? 0) + 1);
  const siteUrl = (opts.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

  if (!report.configured && !opts.dryRun) return report; // nothing to do, and nothing is claimed
  if (!siteUrl) {
    skip("no_site_url"); // links in an email must be absolute
    return report;
  }

  const { data: users, error } = await db.from("profiles").select("id, full_name, notification_prefs").not("onboarded_at", "is", null).is("email_unsubscribed_at", null);
  if (error) throw error;

  for (const u of users ?? []) {
    report.users++;
    const prefs = normalizePrefs(u.notification_prefs);
    const { data: auth } = await db.auth.admin.getUserById(u.id as string);
    const to = auth?.user?.email;
    if (!to) {
      skip("no_email");
      continue;
    }
    const ctx = { siteUrl, unsubscribeUrl: unsubscribeUrl(siteUrl, u.id as string), name: u.full_name as string | null };
    const plan: Planned[] = [];

    if (prefs.email.new_matches) {
      const { data } = await db
        .from("job_matches")
        .select("score, jobs!inner(id, title, city, is_remote, status, discovered_at, companies(name))")
        .eq("user_id", u.id)
        .gte("score", prefs.min_match_score)
        .eq("jobs.status", "active")
        .gte("jobs.discovered_at", new Date(now - 26 * HOUR).toISOString())
        .order("score", { ascending: false })
        .limit(5);
      const jobs = (data ?? []).map((m) => {
        const j = m.jobs as unknown as { id: string; title: string; city: string | null; is_remote: boolean; companies: { name: string } | null };
        return { id: j.id, title: j.title, company: j.companies?.name ?? "", location: j.city ?? (j.is_remote ? "Remote" : null), score: m.score as number };
      });
      if (jobs.length) plan.push({ kind: "new_matches", dedupeKey: `new_matches:${new Date(now).toISOString().slice(0, 10)}`, mail: newMatchesEmail(ctx, jobs) });
    }

    if (prefs.email.follow_ups) {
      const { data } = await db
        .from("follow_ups")
        .select("id, due_at, note, applications!follow_ups_parent_owner_fk(id, company_name, job_title)")
        .eq("user_id", u.id)
        .is("done_at", null)
        .lte("due_at", new Date(now + 24 * HOUR).toISOString())
        .gte("due_at", new Date(now - 7 * 24 * HOUR).toISOString())
        .order("due_at")
        .limit(3);
      for (const f of data ?? []) {
        const a = f.applications as unknown as Ref;
        if (a) plan.push({ kind: "follow_up", dedupeKey: `follow_up:${f.id}`, mail: followUpEmail(ctx, { note: f.note as string | null, jobTitle: a.job_title, company: a.company_name, dueAt: f.due_at as string, applicationId: a.id }) });
      }
    }

    if (prefs.email.interviews) {
      const { data } = await db
        .from("interviews")
        .select("id, scheduled_at, kind, applications!interviews_parent_owner_fk(id, company_name, job_title)")
        .eq("user_id", u.id)
        .gte("scheduled_at", new Date(now).toISOString())
        .lte("scheduled_at", new Date(now + 36 * HOUR).toISOString())
        .order("scheduled_at")
        .limit(3);
      for (const i of data ?? []) {
        const a = i.applications as unknown as Ref;
        if (a) plan.push({ kind: "interview", dedupeKey: `interview:${i.id}`, mail: interviewEmail(ctx, { kind: i.kind as string, jobTitle: a.job_title, company: a.company_name, at: i.scheduled_at as string, applicationId: a.id }) });
      }
    }

    if (prefs.email.status_changes) {
      const { data } = await db
        .from("saved_jobs")
        .select("job_id, jobs!inner(id, title, status, last_verified_at, companies(name))")
        .eq("user_id", u.id)
        .in("jobs.status", ["closed", "expired"])
        .gte("jobs.last_verified_at", new Date(now - 4 * 24 * HOUR).toISOString())
        .limit(3);
      for (const s of data ?? []) {
        const j = s.jobs as unknown as { id: string; title: string; status: "closed" | "expired"; companies: { name: string } | null };
        plan.push({ kind: "status_change", dedupeKey: `status:${j.id}:${j.status}`, mail: statusChangeEmail(ctx, { jobId: j.id, jobTitle: j.title, company: j.companies?.name ?? "", state: j.status }) });
      }
    }

    for (const p of plan) {
      if (opts.dryRun) {
        report.wouldSend++;
        continue;
      }
      const r = await sendMail(db, { userId: u.id as string, to, kind: p.kind, dedupeKey: p.dedupeKey, mail: p.mail, unsubscribeUrl: ctx.unsubscribeUrl }, { now });
      if (r.status === "sent") report.sent++;
      else if (r.status === "failed") report.failed++;
      else skip(r.reason ?? "skipped");
      if (r.reason === "rate_limited") break; // this student has had enough for today
    }
  }
  return report;
}
