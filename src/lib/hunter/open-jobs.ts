/**
 * The /open reply: SJSU jobs open to apply right now, counted from the public catalog (feed-discovered rows only; a
 * student's private imports are never shown to the bot).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDeskJob } from "@/lib/domain/campus-fit";
import { campusOverview, type OverviewJob } from "@/lib/domain/campus-overview";
import { todayISODate } from "@/lib/domain/hunt";
import { openJobsNotice, type TgMessage } from "./message";

export async function openJobsMessage(db: SupabaseClient, appUrl: string, now: number = Date.now()): Promise<TgMessage> {
  const { data, error } = await db
    .from("jobs")
    .select("id, title, excluded_reason, deadline, discovered_at, is_baseline, pay_hourly_min, pay_hourly_max, campus_roles, physical_demand, companies(name)")
    .eq("is_on_campus", true)
    .eq("status", "active")
    .is("imported_by", null)
    .limit(1000);
  if (error) throw error;
  const jobs: OverviewJob[] = (data ?? []).map((r) => ({ ...(r as unknown as OverviewJob), company: (r.companies as unknown as { name: string } | null)?.name ?? "" }));
  const o = campusOverview(jobs, [], [], now);
  const today = todayISODate(now);
  const open = jobs
    .filter((j) => !j.excluded_reason && (!j.deadline || j.deadline.slice(0, 10) >= today))
    .map((j) => ({ id: j.id, title: j.title, company: j.company, deadline: j.deadline, desk: isDeskJob(j.campus_roles, j.physical_demand) }))
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  return openJobsNotice(o, open, appUrl);
}
