/**
 * Tracker views: the student-facing stage of an application and the board's quick filters. Pure, so the board, the
 * dashboard and the tests agree on what "needs attention" or "submission unverified" means.
 *
 * FRIDAY never submits and cannot see an employer's system, so "applied" is the student's own statement. It is shown as
 * "Submitted · unverified" until the student records evidence (a confirmation number or email), never as confirmed.
 */
import { isCampusRole } from "@/lib/domain/campus";
import { todayISODate } from "@/lib/domain/hunt";

export type TrackerApp = {
  status: string;
  applied_at: string | null;
  resume_version_id: string | null;
  submission_evidence?: string | null;
  updated_at: string;
  follow_ups: { due_at: string; done_at: string | null }[];
  jobs?: { deadline: string | null; status: string | null; pay_hourly_min?: number | null; pay_hourly_max?: number | null; campus_roles?: string[] | null; discovered_at?: string | null; is_on_campus?: boolean | null } | null;
};

export type Stage = { label: string; tone: "default" | "moss" | "amber" | "accent" };

const SUBMITTED = new Set(["applied", "assessment", "interview", "final_round", "offer"]);

/** The stage the board shows on a card, in the student's words. */
export function stageOf(a: TrackerApp): Stage {
  if (a.status === "saved") return a.resume_version_id ? { label: "Resume ready", tone: "default" } : { label: "Discovered", tone: "default" };
  if (a.status === "preparing") return { label: a.resume_version_id ? "Resume ready" : "Needs review", tone: "default" };
  if (a.status === "ready") return { label: "Awaiting your submission", tone: "amber" };
  if (a.status === "applied") return a.submission_evidence?.trim() ? { label: "Submitted · confirmed", tone: "moss" } : { label: "Submitted · unverified", tone: "amber" };
  if (a.status === "closed") return { label: "Listing closed", tone: "default" };
  return { label: "", tone: "default" };
}

export const TRACKER_FILTERS = ["all", "active", "attention", "closing", "new", "high_pay", "front_desk"] as const;
export type TrackerFilter = (typeof TRACKER_FILTERS)[number];
export const TRACKER_FILTER_LABEL: Record<TrackerFilter, string> = {
  all: "All", active: "Active", attention: "Needs attention", closing: "Closing soon", new: "Newly posted", high_pay: "High-paying", front_desk: "Front desk & office",
};

/** Stated hourly pay at or above this counts as "high-paying" (California's 2026 minimum wage is $16.90). */
export const HIGH_PAY_HOURLY = 20;
const DAY = 86_400_000;

/** Why an application needs the student now, or null. */
export function attentionReason(a: TrackerApp, now: number = Date.now()): string | null {
  const today = todayISODate(now);
  const nowIso = new Date(now).toISOString();
  const pre = a.status === "saved" || a.status === "preparing" || a.status === "ready";
  const dl = a.jobs?.deadline?.slice(0, 10) ?? null;
  if (pre && dl && dl >= today && Date.parse(dl) - Date.parse(today) <= 3 * DAY) return `Closes ${dl === today ? "today" : dl}`;
  if (a.status === "applied" && !a.submission_evidence?.trim()) return "No submission confirmation recorded";
  if (a.follow_ups.some((f) => !f.done_at && f.due_at < nowIso)) return "Follow-up overdue";
  if (a.status === "ready") return "Ready, not yet submitted";
  return null;
}

export function matchesFilter(a: TrackerApp, f: TrackerFilter, now: number = Date.now()): boolean {
  const today = todayISODate(now);
  const dl = a.jobs?.deadline?.slice(0, 10) ?? null;
  const active = !["rejected", "withdrawn", "closed", "offer"].includes(a.status);
  switch (f) {
    case "all": return true;
    case "active": return active;
    case "attention": return active && attentionReason(a, now) != null;
    case "closing": return active && !SUBMITTED.has(a.status) && dl != null && dl >= today && Date.parse(dl) - Date.parse(today) <= 7 * DAY;
    case "new": return a.jobs?.discovered_at != null && now - Date.parse(a.jobs.discovered_at) <= 3 * DAY;
    // Only STATED hourly pay counts; unknown pay is never treated as high.
    case "high_pay": return (a.jobs?.pay_hourly_max ?? a.jobs?.pay_hourly_min ?? 0) >= HIGH_PAY_HOURLY;
    case "front_desk": return (a.jobs?.campus_roles ?? []).filter(isCampusRole).some((r) => r === "front_desk_admin" || r === "library_assistant" || r === "it_support");
  }
}
