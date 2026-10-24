/**
 * Tracking a listing and moving an application, shared by the tracker API and the hunter (Telegram / Gmail bridge),
 * so every path records the same events and follow-ups. Every query is scoped to `userId`, so it is safe with the admin client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { applyFollowUps } from "@/lib/data/followups";
import { plannedFollowUps } from "@/lib/domain/followups";
import { place, type AppStatus } from "@/lib/format";

type Row = Record<string, unknown>;

/** Track a listing. Already tracked → returned untouched (re-tracking must never reset a real status). */
export async function trackJob(db: SupabaseClient, userId: string, jobId: string, status: AppStatus = "saved"): Promise<{ application: Row; existing: boolean }> {
  const { data: existing } = await db.from("applications").select("*").eq("user_id", userId).eq("job_id", jobId).maybeSingle();
  if (existing) return { application: existing, existing: true };
  const { data: job } = await db
    .from("jobs")
    .select("id, title, apply_url, discovered_at, is_on_campus, city, location_text, is_remote, excluded_reason, imported_by, companies(name), job_sources(source_name, is_official)")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || (job.imported_by && job.imported_by !== userId)) throw new HttpError(404, "Opportunity not found");
  if (job.excluded_reason) throw new HttpError(409, "This job is excluded by FRIDAY's job-search rules (dining and food service), so FRIDAY does not track an application for it.");
  const sources = (job.job_sources as unknown as { source_name: string; is_official: boolean }[]) ?? [];
  const row = {
    job_id: job.id,
    company_name: (job.companies as unknown as { name: string } | null)?.name ?? "Unknown",
    job_title: job.title,
    location: place(job),
    source: (sources.find((s) => s.is_official) ?? sources[0])?.source_name ?? null,
    original_url: job.apply_url,
    application_url: job.apply_url,
    discovered_at: job.discovered_at,
    status,
  };
  const { data: app, error } = await db.from("applications").upsert({ ...row, user_id: userId }, { onConflict: "user_id,job_id", ignoreDuplicates: false }).select("*").single();
  if (error) throw error;
  await db.from("application_events").insert({ application_id: app.id, user_id: userId, kind: "created", to_status: app.status });
  return { application: app, existing: false };
}

/**
 * Move an application to `to`, recording the event and the planned follow-ups exactly as the tracker does. Only moves
 * forward from pre-submission states: an application already applied / interviewing is never pulled back.
 */
export async function moveStatus(db: SupabaseClient, userId: string, applicationId: string, to: AppStatus, opts: { evidence?: string; note?: string } = {}) {
  const { data: current } = await db.from("applications").select("id, status, applied_at").eq("id", applicationId).eq("user_id", userId).maybeSingle();
  if (!current) throw new HttpError(404, "Application not found");
  const order = ["saved", "preparing", "ready", "applied"];
  const from = current.status as string;
  if (!order.includes(from) || order.indexOf(from) >= order.indexOf(to)) return { moved: false, status: from };

  const update: Row = { status: to };
  if (to === "applied" && !current.applied_at) update.applied_at = new Date().toISOString();
  if (opts.evidence) Object.assign(update, { submission_evidence: opts.evidence.slice(0, 2000), submission_confirmed_at: new Date().toISOString() });
  const { error } = await db.from("applications").update(update).eq("id", applicationId).eq("user_id", userId);
  if (error) throw error;
  await db.from("application_events").insert({ application_id: applicationId, user_id: userId, kind: "status", from_status: from, to_status: to, ...(opts.note ? { note: opts.note.slice(0, 500) } : {}) });
  await applyFollowUps(db, { userId, applicationId, status: to, planned: plannedFollowUps({ from, to }) });
  return { moved: true, status: to };
}
