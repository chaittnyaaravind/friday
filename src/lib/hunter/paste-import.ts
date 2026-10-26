/**
 * A job the student pasted into Telegram (pasted-job.ts) → a private import → a hunt item, so the usual card with a
 * resume tailored to that description follows. The student asked for this job, so their desk-only preference does not
 * filter it; FRIDAY's exclusions (dining, staff roles, …) still apply and are said plainly.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rematchAll, skillIdMap, syncCatalog } from "@/lib/discovery/agent";
import { IMPORT_DAILY_LIMIT } from "@/lib/discovery/import-scope";
import { importPosting } from "@/lib/discovery/ingest";
import { excludedMessage } from "@/lib/domain/exclusions";
import { esc, type TgMessage } from "./message";
import type { PastedJob } from "./pasted-job";

const say = (text: string): TgMessage => ({ text, buttons: [] });

/** Returns the reply, and whether a card is now queued for this student. */
export async function importPasted(db: SupabaseClient, userId: string, job: PastedJob): Promise<{ reply: TgMessage; queued: boolean }> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await db.from("job_sources").select("id", { count: "exact", head: true }).eq("imported_by", userId).gte("first_seen_at", since);
  if ((count ?? 0) >= IMPORT_DAILY_LIMIT) return { reply: say(`You've added ${IMPORT_DAILY_LIMIT} jobs today, the daily limit. Paste this one again tomorrow.`), queued: false };

  await syncCatalog(db);
  const employer = job.employer ?? (job.onCampus ? "San José State University" : "Employer not stated");
  const { jobId } = await importPosting(db, { url: job.url, title: job.title, company: employer, source: "handshake", onCampus: job.onCampus, description: job.description, pay: job.payText }, await skillIdMap(db), userId);
  await rematchAll(db, { userId });

  const read = `<b>${esc(job.title)}</b> · ${esc(employer)}${job.payText ? ` · ${esc(job.payText)}` : ""}`;
  const { data: row } = await db.from("jobs").select("excluded_reason, status").eq("id", jobId).maybeSingle();
  if (row?.excluded_reason) return { reply: say(`📥 Read as ${read}.\nFRIDAY won't prepare it: ${esc(excludedMessage(row.excluded_reason as string))}`), queued: false };
  if (row?.status && row.status !== "active") return { reply: say(`📥 Read as ${read}.\nFRIDAY has this job as closed, so no card was prepared.`), queued: false };

  const { data: existing } = await db.from("hunt_items").select("id, state").eq("user_id", userId).eq("job_id", jobId).maybeSingle();
  if (existing && !["stale", "failed", "skipped"].includes(existing.state as string)) {
    return { reply: say(`📥 ${read} is already in your FRIDAY chat${existing.state === "queued" || existing.state === "preparing" ? " — its card is being prepared" : " above"}.`), queued: existing.state === "queued" };
  }
  const reset = { state: "queued", attempts: 0, error: null, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await db.from("hunt_items").update(reset).eq("id", existing.id)
    : await db.from("hunt_items").insert({ user_id: userId, job_id: jobId });
  if (error) throw error;
  const hint = job.employer ? "" : "\nIf that's misread, paste it again with “Title: …” and “Employer: …” as the first lines.";
  return { reply: say(`📥 Got it: ${read}.\nTailoring your resume to this description now. The card arrives here in a moment.${hint}`), queued: true };
}
