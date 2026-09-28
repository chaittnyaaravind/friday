/**
 * Keeps the tracker honest when a listing stops being listed.
 *
 * An application still in saved / preparing / ready (nothing submitted) whose opportunity has closed or expired becomes
 * "closed"; if the listing comes back, the application returns to exactly the status it had. Rules, each tested:
 *   - It NEVER touches an application that was already submitted (applied and beyond), withdrawn or rejected.
 *   - Every move is recorded in application_events (kind listing_closed / listing_reopened) with the status it came from.
 *   - It reverses only moves IT made. A student who set "closed" themselves keeps it, even if the listing is open.
 *   - Idempotent: running it twice changes nothing the second time. It never deletes anything.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PRE_SUBMISSION = ["saved", "preparing", "ready"];
const NOT_LISTED = ["closed", "expired"];

export type SyncResult = { closed: number; reopened: number };

export async function syncApplicationsWithListings(db: SupabaseClient): Promise<SyncResult> {
  let closed = 0;
  let reopened = 0;

  // 1. Pre-submission applications whose listing is gone → closed.
  const { data: open, error } = await db.from("applications").select("id, user_id, job_id, status").in("status", PRE_SUBMISSION).not("job_id", "is", null);
  if (error) throw error;
  if (open?.length) {
    const jobIds = [...new Set(open.map((a) => a.job_id as string))];
    const { data: jobs, error: jobErr } = await db.from("jobs").select("id, status").in("id", jobIds);
    if (jobErr) throw jobErr;
    const gone = new Set((jobs ?? []).filter((j) => NOT_LISTED.includes(j.status as string)).map((j) => j.id as string));
    for (const a of open.filter((x) => gone.has(x.job_id as string))) {
      const { error: upErr } = await db.from("applications").update({ status: "closed" }).eq("id", a.id).eq("status", a.status);
      if (upErr) throw upErr;
      const { error: evErr } = await db.from("application_events").insert({ application_id: a.id, user_id: a.user_id, kind: "listing_closed", from_status: a.status, to_status: "closed", note: "The listing is no longer open" });
      if (evErr) throw evErr;
      closed += 1;
    }
  }

  // 2. Applications closed BY US whose listing is open again → back to the status they had.
  const { data: shut, error: shutErr } = await db.from("applications").select("id, user_id, job_id").eq("status", "closed").not("job_id", "is", null);
  if (shutErr) throw shutErr;
  if (shut?.length) {
    const jobIds = [...new Set(shut.map((a) => a.job_id as string))];
    const { data: jobs, error: jobErr } = await db.from("jobs").select("id, status").in("id", jobIds);
    if (jobErr) throw jobErr;
    const active = new Set((jobs ?? []).filter((j) => j.status === "active").map((j) => j.id as string));
    const candidates = shut.filter((a) => active.has(a.job_id as string));
    if (candidates.length) {
      const { data: events, error: evErr } = await db.from("application_events").select("application_id, kind, from_status, to_status, created_at").in("application_id", candidates.map((a) => a.id as string)).eq("to_status", "closed");
      if (evErr) throw evErr;
      for (const a of candidates) {
        const last = (events ?? []).filter((e) => e.application_id === a.id).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
        if (!last || last.kind !== "listing_closed") continue; // the student chose "closed" — leave it
        const back = PRE_SUBMISSION.includes(last.from_status as string) ? (last.from_status as string) : "saved";
        const { error: upErr } = await db.from("applications").update({ status: back }).eq("id", a.id).eq("status", "closed");
        if (upErr) throw upErr;
        const { error: insErr } = await db.from("application_events").insert({ application_id: a.id, user_id: a.user_id, kind: "listing_reopened", from_status: "closed", to_status: back, note: "The listing is open again" });
        if (insErr) throw insErr;
        reopened += 1;
      }
    }
  }
  return { closed, reopened };
}
