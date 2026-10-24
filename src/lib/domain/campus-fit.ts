/**
 * Campus fit: how well an SJSU on-campus job matches what THIS student asked for — role type, pay, physical demand,
 * hours, how recently the listing was verified, and its deadline. A transparent sum of six parts (100 points), each with
 * the sentence that explains it.
 *
 * It ranks; it never decides. Eligibility (eligibility.ts) is checked separately and shown separately, and an excluded
 * job (exclusions.ts) gets no fit at all. A high fit never hides a blocker, and unknown pay is never scored as known pay.
 */
import { z } from "zod";
import { CAMPUS_ROLE_LABEL, isCampusRole, type CampusRole } from "./campus";
import { todayISODate } from "./hunt";
import { BURDEN_LABEL, type PhysicalFlag, type PhysicalLevel } from "./physical";

/** California's statewide minimum wage for 2026 — the floor of the pay scale, not a claim about any posting. */
export const PAY_FLOOR = 16.9;
/** Hourly pay at which the pay part is full. */
export const PAY_TOP = 25;

export const CampusPrefsSchema = z.object({
  /** Jobs below this hourly rate are ranked as "below your minimum" (never hidden). */
  minHourly: z.number().min(0).max(200).nullable().default(null),
  maxWeeklyHours: z.number().int().min(1).max(40).nullable().default(null),
  /** Preferred role types, most wanted first. */
  roles: z.array(z.string().max(40)).max(12).default(["front_desk_admin", "it_support", "library_assistant", "student_assistant"]),
  avoidPhysical: z.boolean().default(true),
  avoidSchedule: z.boolean().default(true),
  /** Show and alert on desk-type campus jobs only (front desk, office, clerical, IT help desk, library). On by default. */
  deskOnly: z.boolean().default(true),
});
export type CampusPrefs = z.infer<typeof CampusPrefsSchema>;
export const DEFAULT_CAMPUS_PREFS: CampusPrefs = CampusPrefsSchema.parse({});

/** Stored preferences, or the defaults for anything missing or malformed. Unknown role names (and dining) are dropped. */
export function normalizeCampusPrefs(raw: unknown): CampusPrefs {
  const parsed = CampusPrefsSchema.safeParse(raw ?? {});
  const p = parsed.success ? parsed.data : DEFAULT_CAMPUS_PREFS;
  return { ...p, roles: p.roles.filter(isCampusRole).filter((r) => r !== "dining_retail") };
}

/** Role types that ARE desk work. Mirrored in search_jobs (migration 0017, p_desk_only): keep the two identical. */
export const DESK_ROLES = ["front_desk_admin", "it_support", "library_assistant"] as const;

/**
 * A desk job: its title names a desk/office/IT/library role, or its duties are stated as desk work — and it is never
 * physically demanding (a "front desk" job that requires lifting 50 lbs is not what a desk-only search asks for).
 */
export function isDeskJob(campusRoles: readonly string[] | null | undefined, physical: string | null | undefined): boolean {
  if (physical === "high") return false;
  return (campusRoles ?? []).some((r) => (DESK_ROLES as readonly string[]).includes(r)) || physical === "low";
}

export type FitJob = {
  campusRoles: string[];
  payHourlyMin: number | null;
  payHourlyMax: number | null;
  hoursMax: number | null;
  physical: PhysicalLevel;
  physicalFlags: PhysicalFlag[];
  deadline: string | null;
  lastVerifiedAt: string | null;
  official: boolean;
  status: string;
};

export type FitPart = { key: "role" | "pay" | "physical" | "hours" | "listing" | "deadline"; label: string; points: number; max: number; detail: string };
export type CampusFit = { score: number; parts: FitPart[]; reasons: string[]; cautions: string[] };

/** Role weight (out of 35) when the student has not named the role as a preference. Office / front-desk / computer work first. */
const BASE_ROLE: Record<CampusRole, number> = {
  front_desk_admin: 24, it_support: 22, library_assistant: 22, technical_media: 20, lab_assistant: 18, research_assistant: 18, student_assistant: 16,
  tutor_mentor: 14, teaching_assistant: 12, orientation_leader: 10, resident_advisor: 8, fitness_recreation: 5, dining_retail: 0, other: 8,
};

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const DAY = 86_400_000;

export function computeCampusFit(j: FitJob, prefs: CampusPrefs, now: number = Date.now()): CampusFit {
  const reasons: string[] = [];
  const cautions: string[] = [];
  const parts: FitPart[] = [];

  // ── role (35) ──
  const roles = j.campusRoles.filter(isCampusRole);
  let role = -1;
  let roleDetail = "";
  for (const r of roles.length ? roles : (["other"] as CampusRole[])) {
    const idx = prefs.roles.indexOf(r);
    const pts = idx >= 0 ? Math.max(27, 35 - idx * 2) : BASE_ROLE[r];
    if (pts > role) {
      role = pts;
      roleDetail = idx >= 0 ? `${CAMPUS_ROLE_LABEL[r]} is one of the role types you prefer.` : r === "other" ? "The title does not name a role type FRIDAY recognises." : `${CAMPUS_ROLE_LABEL[r]} is not on your preferred list.`;
    }
  }
  parts.push({ key: "role", label: "Role type", points: role, max: 35, detail: roleDetail });
  if (role >= 27) reasons.push(roleDetail);

  // ── pay (25) — only stated hourly pay counts as known ──
  const hourly = j.payHourlyMax ?? j.payHourlyMin;
  let pay: number;
  let payDetail: string;
  if (hourly == null) {
    pay = 10;
    payDetail = "Pay is not stated as an hourly rate on the listing. Check it before you apply.";
  } else if (prefs.minHourly != null && hourly < prefs.minHourly) {
    pay = 0;
    payDetail = `Pays up to ${money(hourly)}/hr, below your ${money(prefs.minHourly)}/hr minimum.`;
    cautions.push(payDetail);
  } else {
    pay = Math.round(5 + Math.min(1, Math.max(0, (hourly - PAY_FLOOR) / (PAY_TOP - PAY_FLOOR))) * 20);
    const range = j.payHourlyMin != null && j.payHourlyMax != null && j.payHourlyMin !== j.payHourlyMax ? `${money(j.payHourlyMin)}–${money(j.payHourlyMax)}` : money(hourly);
    payDetail = `Pays ${range}/hr, as stated on the listing.`;
    if (pay >= 15) reasons.push(payDetail);
  }
  parts.push({ key: "pay", label: "Pay", points: pay, max: 25, detail: payDetail });

  // ── physical demand (15) ──
  const said = j.physicalFlags.filter((f) => f.kind !== "schedule").map((f) => `${BURDEN_LABEL[f.kind].toLowerCase()} (“${f.text}”)`).join("; ");
  const physical = { low: 15, unknown: 9, moderate: prefs.avoidPhysical ? 5 : 10, high: prefs.avoidPhysical ? 0 : 6 }[j.physical];
  const physicalDetail = {
    low: "The duties describe desk or computer work, with no physical demands stated.",
    unknown: "The listing does not describe the duties well enough to judge physical demand.",
    moderate: `The duties mention ${said}.`,
    high: `Physically demanding: ${said}.`,
  }[j.physical];
  parts.push({ key: "physical", label: "Physical demand", points: physical, max: 15, detail: physicalDetail });
  if (j.physical === "low") reasons.push(physicalDetail);
  if (j.physical === "moderate" || j.physical === "high") cautions.push(physicalDetail);

  // ── hours and schedule (10) ──
  const over = j.hoursMax != null && prefs.maxWeeklyHours != null && j.hoursMax > prefs.maxWeeklyHours;
  let hours = j.hoursMax == null ? 6 : over ? 2 : 10;
  let hoursDetail = j.hoursMax == null ? "Weekly hours are not stated." : `Up to ${j.hoursMax} hours a week${prefs.maxWeeklyHours != null ? `; you asked for at most ${prefs.maxWeeklyHours}` : ""}.`;
  if (over) cautions.push(hoursDetail);
  const schedule = j.physicalFlags.find((f) => f.kind === "schedule");
  if (schedule && prefs.avoidSchedule) {
    hours = Math.max(0, hours - 4);
    hoursDetail += ` The schedule may be hard: “${schedule.text}”.`;
    cautions.push(`Schedule: “${schedule.text}”.`);
  }
  parts.push({ key: "hours", label: "Hours & schedule", points: hours, max: 10, detail: hoursDetail });

  // ── listing open and recently verified (10) ──
  const ageDays = j.lastVerifiedAt ? (now - Date.parse(j.lastVerifiedAt)) / DAY : Infinity;
  let listing: number;
  let listingDetail: string;
  if (j.status !== "active") {
    listing = 0;
    listingDetail = "The listing is not open.";
    cautions.push(listingDetail);
  } else {
    listing = (ageDays <= 3 ? 7 : ageDays <= 14 ? 4 : 1) + (j.official ? 3 : 0);
    listingDetail = `${j.official ? "Read from an official SJSU source" : "Not from an official SJSU source"}; last verified ${ageDays <= 1 ? "within a day" : Number.isFinite(ageDays) ? `${Math.round(ageDays)} days ago` : "never"}.`;
    if (ageDays > 14) cautions.push("The listing has not been verified in over two weeks.");
  }
  parts.push({ key: "listing", label: "Listing verified", points: listing, max: 10, detail: listingDetail });

  // ── deadline (5) ──
  let deadline: number;
  let deadlineDetail: string;
  if (!j.deadline) {
    deadline = 3;
    deadlineDetail = "No deadline stated; postings like this can close without notice.";
  } else {
    const day = j.deadline.slice(0, 10);
    const left = Math.round((Date.parse(day) - Date.parse(todayISODate(now))) / DAY);
    if (left < 0) {
      deadline = 0;
      deadlineDetail = `The deadline (${day}) has passed.`;
      cautions.push(deadlineDetail);
    } else if (left <= 2) {
      deadline = 4;
      deadlineDetail = `Closes ${left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`} (${day}).`;
      cautions.push(deadlineDetail);
    } else {
      deadline = 5;
      deadlineDetail = `Open until ${day}.`;
    }
  }
  parts.push({ key: "deadline", label: "Deadline", points: deadline, max: 5, detail: deadlineDetail });

  const score = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.points, 0)));
  return { score, parts, reasons, cautions };
}

/** Hourly pay from a parsed pay range — ONLY when the posting states an hourly unit. Anything else stays unknown. */
export function hourlyFromPay(pay: { min: number | null; max: number | null; unit: string | null } | null): { min: number | null; max: number | null } {
  if (!pay || pay.unit !== "hour") return { min: null, max: null };
  const ok = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 && n < 500 ? n : null);
  return { min: ok(pay.min), max: ok(pay.max) };
}
