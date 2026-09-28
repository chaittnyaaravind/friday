/**
 * Eligibility: can this student actually apply? Separate from the match SCORE on purpose — a 95-point match that
 * requires U.S. citizenship is still a role an F-1 student cannot take, and a low-scoring role is not "ineligible".
 *
 * The verdict compares what the POSTING SAYS with what the STUDENT'S PROFILE SAYS, nothing more. FRIDAY cannot determine
 * legal eligibility, and every result says so. Three verdicts:
 *   clear    no blocker and nothing to check was found in the posting
 *   verify   something needs a human check before applying (or a needed profile fact is missing)
 *   blocked  the posting states a requirement the profile clearly does not meet, or the listing is closed
 * Every check is listed with its own status and reason, so the verdict is never a black box. Pure and deterministic.
 */
import { todayISODate } from "./hunt";
import { ADVANCED, targetGraduationYears, YEARS } from "./insights";
import { ISSS_NOTICE, type MatchJob, type MatchProfile } from "./match";

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type CheckId = "open" | "authorization" | "hours" | "graduation" | "degree" | "experience" | "work_study";

export type EligibilityCheck = {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Whether an "unknown" result should push the verdict to "verify" (a missing profile fact that matters) or is just informational. */
  material: boolean;
};

export type EligibilityVerdict = "clear" | "verify" | "blocked";
export type EligibilityResult = { verdict: EligibilityVerdict; headline: string; checks: EligibilityCheck[]; disclaimer: string };

export const VERDICT_LABEL: Record<EligibilityVerdict, string> = { clear: "No blockers found", verify: "Verify before applying", blocked: "Likely blocked" };

/** F-1 students may work at most 20 hours a week on campus while classes are in session (ISSS is the authority). */
export const F1_ON_CAMPUS_WEEKLY_LIMIT = 20;

const CITIZEN_REQUIRED = /\b(?:u\.?s\.? citizen(?:ship)? (?:is )?required|must be a u\.?s\.? citizen|(?:only )?u\.?s\.? citizens? (?:are )?(?:eligible|only|may apply)|citizenship (?:is )?required|requires? u\.?s\.? citizenship)\b/i;
const CLEARANCE = /\b(?:(?:active|current|valid|secret|top[- ]secret|ts\/sci)\s+(?:security\s+)?clearance|security clearance (?:is )?required|must (?:have|hold|obtain) (?:a |an )?(?:security )?clearance)\b/i;
const NO_SPONSOR = /\b(?:not (?:able|eligible|willing) to (?:provide|offer) (?:visa )?sponsorship|no (?:visa )?sponsorship|without (?:the need for )?(?:current or future )?(?:visa )?sponsorship|will not sponsor|unable to sponsor)\b/i;
const EXPORT = /\b(?:export[- ]control|itar)\b/i;

export type AuthRestriction = "citizen" | "clearance" | "no_sponsorship" | "export" | null;

/** The strongest work-authorization restriction the posting states, most restrictive first. */
export function authRestriction(text: string): AuthRestriction {
  if (CITIZEN_REQUIRED.test(text)) return "citizen";
  if (CLEARANCE.test(text)) return "clearance";
  if (NO_SPONSOR.test(text)) return "no_sponsorship";
  if (EXPORT.test(text)) return "export";
  return null;
}

const DAY = 86_400_000;

export function checkEligibility(p: MatchProfile, j: MatchJob, distanceMiles: number | null = null, now: number = Date.now()): EligibilityResult {
  void distanceMiles; // distance is a matter of the score's location points, not of eligibility
  const auth = p.workAuthorization ?? null;
  const text = `${j.title}\n${j.description ?? ""}`;
  const checks: EligibilityCheck[] = [];

  // ── still open ──
  // Deadlines are dates, judged in SJSU's (Pacific) calendar: the deadline day itself is still open.
  const status = j.status ?? "active";
  const today = todayISODate(now);
  if (status !== "active") {
    checks.push({ id: "open", label: "Still open", status: "fail", material: true, detail: status === "expired" ? "This listing has expired: no source has confirmed it for a long time." : "The employer's site no longer lists this opportunity." });
  } else if (j.deadline && j.deadline < today) {
    checks.push({ id: "open", label: "Still open", status: "fail", material: true, detail: `The application deadline (${j.deadline}) has passed.` });
  } else if (j.deadline) {
    const days = Math.round((Date.parse(`${j.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
    checks.push({ id: "open", label: "Still open", status: "pass", material: false, detail: days <= 3 ? `Closes ${j.deadline} — ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}.` : `Open until ${j.deadline}.` });
  }

  // ── work authorization ──
  const restriction = authRestriction(text);
  const onCampus = j.isOnCampus || j.employmentType === "on_campus";
  const push = (status: CheckStatus, detail: string, material = true) => checks.push({ id: "authorization", label: "Work authorization", status, material, detail });
  if (restriction === "citizen") {
    if (auth === "us_citizen") push("pass", "The posting requires U.S. citizenship, and your profile says you are a U.S. citizen.", false);
    else if (auth === null) push("unknown", "The posting requires U.S. citizenship. Add your work authorization to your profile so FRIDAY can check it.");
    else push("fail", "The posting states that U.S. citizenship is required, which your profile's work authorization does not meet.");
  } else if (restriction === "clearance") {
    if (auth === null) push("unknown", "The posting requires a security clearance. Add your work authorization to your profile so FRIDAY can check it.");
    else if (auth === "us_citizen") push("warn", "The posting requires an active security clearance. FRIDAY cannot tell whether you hold one.");
    else push("fail", "The posting requires a security clearance, which generally requires U.S. citizenship.");
  } else if (restriction === "no_sponsorship") {
    if (auth === "us_citizen" || auth === "permanent_resident") push("pass", "The posting says it does not sponsor visas, which does not affect you.", false);
    else if (auth === "f1") push("warn", "The posting says it will not sponsor visas. That may exclude students who would need sponsorship later; CPT or OPT may still apply. Confirm with the employer and SJSU ISSS.");
    else push("unknown", "The posting says it will not sponsor visas. Add your work authorization to your profile so FRIDAY can check it.");
  } else if (restriction === "export") {
    if (auth === "us_citizen" || auth === "permanent_resident") push("pass", "The posting mentions export controls, which generally do not limit U.S. citizens or permanent residents.", false);
    else if (auth === null) push("unknown", "The posting mentions export controls. Add your work authorization to your profile so FRIDAY can check it.");
    else push("warn", "The posting mentions export controls (ITAR/EAR), which can limit who may work on the role. FRIDAY cannot tell whether it applies to you; ask the employer.");
  } else if (auth === "f1") {
    if (onCampus) push("pass", "On-campus employment is generally available to F-1 students, subject to hour limits while classes are in session.", false);
    else push("warn", "Work off campus needs authorization such as CPT or OPT. FRIDAY cannot confirm that you have it; check with SJSU ISSS.");
  } else if (auth === null && !onCampus) {
    push("unknown", "Add your work authorization to your profile so FRIDAY can tell whether this off-campus role needs anything from you.");
  }

  // ── weekly hours (F-1, on campus) ──
  if (auth === "f1" && onCampus) {
    if (j.hoursMax == null) {
      checks.push({ id: "hours", label: "Weekly hours", status: "unknown", material: false, detail: `The posting does not state weekly hours. F-1 students may work at most ${F1_ON_CAMPUS_WEEKLY_LIMIT} hours a week on campus while classes are in session.` });
    } else if (j.hoursMax > F1_ON_CAMPUS_WEEKLY_LIMIT) {
      checks.push({ id: "hours", label: "Weekly hours", status: "warn", material: true, detail: `The posting allows up to ${j.hoursMax} hours a week. F-1 on-campus work is limited to ${F1_ON_CAMPUS_WEEKLY_LIMIT} hours a week while classes are in session; confirm the in-session limit with ISSS.` });
    } else {
      checks.push({ id: "hours", label: "Weekly hours", status: "pass", material: false, detail: `The posting's hours (up to ${j.hoursMax} a week) are within the F-1 on-campus limit of ${F1_ON_CAMPUS_WEEKLY_LIMIT}.` });
    }
  }

  // ── graduation timing ──
  const targets = targetGraduationYears(text);
  if (targets.length) {
    const gy = p.graduationYear ?? null;
    if (gy == null) checks.push({ id: "graduation", label: "Graduation timing", status: "unknown", material: false, detail: `The posting targets students graduating in ${targets.join(" or ")}. Add your graduation year to your profile.` });
    else if (targets.includes(gy)) checks.push({ id: "graduation", label: "Graduation timing", status: "pass", material: false, detail: `The posting targets ${targets.join(" or ")} graduates, and your profile says ${gy}.` });
    else checks.push({ id: "graduation", label: "Graduation timing", status: "warn", material: true, detail: `The posting targets students graduating in ${targets.join(" or ")}; your profile says ${gy}.` });
  }

  // ── degree level, experience, work-study ──
  if (ADVANCED.test(text)) checks.push({ id: "degree", label: "Degree level", status: "warn", material: true, detail: "The posting mentions a Ph.D. or master's requirement. FRIDAY does not know your degree level; check whether undergraduates can apply." });
  const years = text.match(YEARS);
  if (years) checks.push({ id: "experience", label: "Experience asked", status: "warn", material: true, detail: `The posting asks for ${years[1]}+ years of professional experience, which is unusual for an internship.` });
  if (j.workStudy === "required") checks.push({ id: "work_study", label: "Work-Study", status: "warn", material: true, detail: "The posting requires a Federal Work-Study award. FRIDAY cannot see whether you have one; ask the Financial Aid office." });

  const fails = checks.filter((c) => c.status === "fail");
  const toVerify = checks.filter((c) => c.status === "warn" || (c.status === "unknown" && c.material));
  const verdict: EligibilityVerdict = fails.length ? "blocked" : toVerify.length ? "verify" : "clear";
  const headline =
    verdict === "blocked" ? `Likely blocked: ${fails[0].detail}` : verdict === "verify" ? `Verify before applying: ${toVerify.length} thing${toVerify.length === 1 ? "" : "s"} to check.` : "No blockers found in the posting.";
  const disclaimer = `FRIDAY compares what the posting says with what your profile says. It cannot determine legal eligibility.${auth === "f1" ? ` ${ISSS_NOTICE}` : ""}`;
  return { verdict, headline, checks, disclaimer };
}
