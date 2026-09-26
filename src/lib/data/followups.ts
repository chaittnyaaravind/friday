/**
 * Persist the follow-ups planned by lib/domain/followups. Idempotent by construction: migration 0008's partial
 * unique index allows one OPEN automatic follow-up per kind per application, and a violation of it (a repeat
 * request, a race, the student re-saving the same status) is treated as "already there", not as an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTerminal, type PlannedFollowUp } from "@/lib/domain/followups";

const UNIQUE_VIOLATION = "23505";

export async function applyFollowUps(db: SupabaseClient, o: { userId: string; applicationId: string; status: string | null; planned: PlannedFollowUp[] }) {
  let created = 0;

  if (isTerminal(o.status)) {
    // Nothing is pending once an outcome is known.
    await db.from("follow_ups").update({ done_at: new Date().toISOString() }).eq("application_id", o.applicationId).eq("user_id", o.userId).eq("auto", true).is("done_at", null);
    await db.from("applications").update({ follow_up_at: null }).eq("id", o.applicationId).eq("user_id", o.userId);
    return { created };
  }

  for (const p of o.planned) {
    const { error } = await db.from("follow_ups").insert({ application_id: o.applicationId, user_id: o.userId, due_at: p.dueAt, note: p.note, kind: p.kind, auto: true });
    if (!error) created++;
    else if (error.code !== UNIQUE_VIOLATION) throw error;
  }

  if (created) {
    // Keep the application's "next follow-up" in step with the soonest open one.
    const { data: next } = await db.from("follow_ups").select("due_at").eq("application_id", o.applicationId).eq("user_id", o.userId).is("done_at", null).order("due_at").limit(1).maybeSingle();
    if (next) await db.from("applications").update({ follow_up_at: next.due_at }).eq("id", o.applicationId).eq("user_id", o.userId);
  }
  return { created };
}
