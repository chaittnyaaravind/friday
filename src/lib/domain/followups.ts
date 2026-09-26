/**
 * Which follow-ups FRIDAY suggests when an application changes. Pure and deterministic.
 * They are suggestions the student can edit, complete or dismiss — never actions taken on their behalf.
 */
export type AutoKind = "follow_up" | "interview_prep" | "recruiter_response";
export type PlannedFollowUp = { kind: AutoKind; dueAt: string; note: string };

/** Once an application reaches one of these, nothing is pending: automatic follow-ups are closed. */
export const TERMINAL_STATUSES = ["offer", "rejected", "withdrawn"] as const;
export const isTerminal = (status: string | null | undefined) => (TERMINAL_STATUSES as readonly string[]).includes(status ?? "");

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function plannedFollowUps(o: { from: string | null; to: string | null; interviewAt?: string | null; now?: number }): PlannedFollowUp[] {
  const now = o.now ?? Date.now();
  const out: PlannedFollowUp[] = [];
  const moved = o.to !== o.from;

  if (moved && o.to === "applied") {
    out.push({ kind: "follow_up", dueAt: new Date(now + 7 * DAY).toISOString(), note: "Check in on your application" });
  }
  if (moved && o.to === "assessment") {
    out.push({ kind: "recruiter_response", dueAt: new Date(now + 3 * DAY).toISOString(), note: "Check for assessment results or a recruiter reply" });
  }

  const interviewMs = o.interviewAt ? Date.parse(o.interviewAt) : NaN;
  if (!Number.isNaN(interviewMs) && interviewMs > now) {
    // Prepare the day before, but never in the past.
    out.push({ kind: "interview_prep", dueAt: new Date(Math.max(now + HOUR, interviewMs - DAY)).toISOString(), note: "Prepare for your interview" });
  } else if (moved && (o.to === "interview" || o.to === "final_round")) {
    out.push({ kind: "interview_prep", dueAt: new Date(now + 2 * DAY).toISOString(), note: "Prepare for your interview" });
  }
  return out;
}
