import { formatDistanceToNowStrict, format, differenceInCalendarDays, parseISO } from "date-fns";

export const TYPE_LABEL: Record<string, string> = {
  internship: "Internship",
  on_campus: "On-campus",
  part_time: "Part-time",
  full_time: "Full-time",
  research: "Research",
  co_op: "Co-op",
};

export const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  amazon: "Amazon Jobs",
  microsoft: "Microsoft Careers",
  sjsu_page: "Official SJSU page",
  handshake_import: "Handshake (imported)",
  linkedin_import: "LinkedIn (imported)",
  indeed_import: "Indeed (imported)",
  manual: "Added by you",
};

export const STATUS_LABEL: Record<string, string> = {
  saved: "Saved",
  preparing: "Preparing",
  ready: "Ready to apply",
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  final_round: "Final round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
export const STATUS_ORDER = ["saved", "preparing", "ready", "applied", "assessment", "interview", "final_round", "offer", "rejected", "withdrawn"] as const;
export type AppStatus = (typeof STATUS_ORDER)[number];

export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  return format(parseISO(iso), "MMM d");
}

export function longDate(iso: string | null | undefined) {
  if (!iso) return "";
  return format(parseISO(iso), "MMM d, yyyy");
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "";
  return format(parseISO(iso), "EEE, MMM d · h:mm a");
}

/** "Closes in 3 days" / "Closes today" / null */
export function deadlineLabel(date: string | null | undefined): { text: string; urgent: boolean } | null {
  if (!date) return null;
  const d = differenceInCalendarDays(parseISO(date), new Date());
  if (d < 0) return { text: "Deadline passed", urgent: false };
  if (d === 0) return { text: "Closes today", urgent: true };
  if (d === 1) return { text: "Closes tomorrow", urgent: true };
  return { text: d <= 14 ? `Closes in ${d} days` : `Closes ${format(parseISO(date), "MMM d")}`, urgent: d <= 7 };
}

export function place(job: { is_on_campus: boolean; city: string | null; location_text: string | null; is_remote: boolean }) {
  if (job.is_on_campus) return "SJSU Campus";
  if (job.city) return `${job.city}, CA`;
  if (job.is_remote) return "Remote (US)";
  return job.location_text?.split(/;|\n/)[0]?.slice(0, 40) ?? "";
}

export function miles(d: number | null | undefined) {
  if (d == null) return null;
  return d < 1 ? "<1 mi" : `${Math.round(d)} mi`;
}

export function greeting(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(now));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
