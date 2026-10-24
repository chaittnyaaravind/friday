/**
 * The SJSU page's overview, computed from rows the page already reads: what is new, what pays (as stated), what changed,
 * what closes soon, and how the student's campus applications stand. Pure, so the numbers are testable and never padded:
 * excluded jobs are not counted as listings, unknown pay is counted as unknown, and an empty catalog gives zeros.
 */
import { isDeskJob } from "./campus-fit";
import { todayISODate } from "./hunt";

export type OverviewJob = {
  id: string; title: string; company: string; excluded_reason: string | null; deadline: string | null; discovered_at: string; is_baseline: boolean;
  pay_hourly_min: number | null; pay_hourly_max: number | null;
  campus_roles?: string[] | null; physical_demand?: string | null;
};
export type OverviewEvent = { job_id: string; kind: string; created_at: string; changes: Record<string, unknown> | null };
export type OverviewApp = { status: string; submission_evidence: string | null; job_id: string | null };

export type CampusOverview = {
  /** Listed and still open to apply: no stated deadline, or a deadline today or later. */
  open: number;
  /** Of those, desk jobs (campus-fit.ts isDeskJob). */
  desk: number;
  /** Open-to-apply count per employer, largest first. */
  byEmployer: { company: string; open: number; desk: number }[];
  excluded: number;
  newThisWeek: { id: string; title: string; company: string }[];
  pay: { stated: number; unknown: number; min: number | null; max: number | null };
  changed: { id: string; title: string; what: string[] }[];
  closing: { id: string; title: string; deadline: string }[];
  applications: { tracked: number; preparing: number; submittedUnverified: number; submittedConfirmed: number; interviewing: number };
};

const DAY = 86_400_000;

/** The earliest change event the overview reads (one week back). */
export const eventsSince = (now: number = Date.now()) => new Date(now - 7 * DAY).toISOString();
const FIELD_WORD: Record<string, string> = { pay_text: "pay", deadline: "deadline", title: "title", apply_url: "application link", description: "description", department: "department", location_text: "location", employment_type: "type" };

export function campusOverview(jobs: OverviewJob[], events: OverviewEvent[], apps: OverviewApp[], now: number = Date.now()): CampusOverview {
  const listed = jobs.filter((j) => !j.excluded_reason);
  const byId = new Map(listed.map((j) => [j.id, j]));
  const today = todayISODate(now);
  const weekAgo = now - 7 * DAY;

  const hourly = listed.map((j) => j.pay_hourly_max ?? j.pay_hourly_min).filter((v): v is number => v != null);
  const lows = listed.map((j) => j.pay_hourly_min ?? j.pay_hourly_max).filter((v): v is number => v != null);

  const changedMap = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.kind !== "updated" || Date.parse(e.created_at) < weekAgo || !byId.has(e.job_id)) continue;
    const set = changedMap.get(e.job_id) ?? new Set<string>();
    for (const k of Object.keys(e.changes ?? {})) set.add(FIELD_WORD[k] ?? k);
    changedMap.set(e.job_id, set);
  }

  const campusJobIds = new Set(jobs.map((j) => j.id));
  const mine = apps.filter((a) => a.job_id && campusJobIds.has(a.job_id));
  const submitted = mine.filter((a) => a.status === "applied");

  const applyable = listed.filter((j) => !j.deadline || j.deadline.slice(0, 10) >= today);
  const desk = applyable.filter((j) => isDeskJob(j.campus_roles, j.physical_demand));
  const per = new Map<string, { company: string; open: number; desk: number }>();
  for (const j of applyable) {
    const e = per.get(j.company) ?? { company: j.company, open: 0, desk: 0 };
    e.open++;
    if (isDeskJob(j.campus_roles, j.physical_demand)) e.desk++;
    per.set(j.company, e);
  }

  return {
    open: applyable.length,
    desk: desk.length,
    byEmployer: [...per.values()].sort((a, b) => b.open - a.open || a.company.localeCompare(b.company)),
    excluded: jobs.length - listed.length,
    newThisWeek: listed.filter((j) => !j.is_baseline && Date.parse(j.discovered_at) >= weekAgo).sort((a, b) => b.discovered_at.localeCompare(a.discovered_at)).slice(0, 5).map(({ id, title, company }) => ({ id, title, company })),
    pay: { stated: hourly.length, unknown: listed.length - hourly.length, min: lows.length ? Math.min(...lows) : null, max: hourly.length ? Math.max(...hourly) : null },
    changed: [...changedMap.entries()].slice(0, 5).map(([id, what]) => ({ id, title: byId.get(id)!.title, what: [...what] })),
    closing: listed.filter((j) => j.deadline && j.deadline.slice(0, 10) >= today && Date.parse(j.deadline.slice(0, 10)) - Date.parse(today) <= 14 * DAY)
      .sort((a, b) => a.deadline!.localeCompare(b.deadline!)).slice(0, 5).map((j) => ({ id: j.id, title: j.title, deadline: j.deadline!.slice(0, 10) })),
    applications: {
      tracked: mine.length,
      preparing: mine.filter((a) => ["saved", "preparing", "ready"].includes(a.status)).length,
      submittedUnverified: submitted.filter((a) => !a.submission_evidence?.trim()).length,
      submittedConfirmed: submitted.filter((a) => a.submission_evidence?.trim()).length,
      interviewing: mine.filter((a) => ["assessment", "interview", "final_round"].includes(a.status)).length,
    },
  };
}
