/**
 * Explainable extras that sit next to the match score. Everything here is derived from the job's own text
 * and the student's own confirmed profile — nothing is inferred about the student that they did not provide.
 */
import type { CandidateItem, ExperienceData, ProjectData } from "@/lib/resume/types";
import { isEligible } from "@/lib/resume/types";
import { freshnessOf } from "./freshness";
import { isAuthRestricted } from "./match";
import { SKILLS } from "./skills";

export type Concern = { text: string; severity: "warn" | "info" };

export type ConcernInput = {
  job: {
    title: string;
    description: string | null;
    isOnCampus: boolean;
    isRemote: boolean;
    status: string;
    discoveredAt: string | null;
    lastVerifiedAt: string | null;
    deadline: string | null;
  };
  profile: { graduationYear: number | null; workAuthorization: "f1" | "us_citizen" | "permanent_resident" | "other" | null; radiusMiles: number };
  distanceMiles: number | null;
  missingRequired: string[];
};

export const ADVANCED = /\b(?:ph\.?d\.?|doctoral|master'?s(?: degree)? (?:required|only)|currently pursuing (?:a |an )?(?:ph\.?d|master))/i;
export const YEARS = /\b([3-9])\+?\s*(?:or more )?years?(?: of)?\s*(?:professional |industry |relevant |work )?experience/i;
const GRAD_CLAUSE = /(?:graduat(?:e|es|ing|ion)|expected graduation)[^.\n]{0,80}/gi;

/** Graduation years a posting says it targets, e.g. "graduating between December 2026 and June 2027" → [2026, 2027]. */
export function targetGraduationYears(text: string): number[] {
  const years = new Set<number>();
  for (const clause of text.match(GRAD_CLAUSE) ?? []) {
    if (/\bgraduated\b/i.test(clause)) continue; // past tense describes someone else, not a target
    for (const m of clause.matchAll(/\b(20\d\d)\b/g)) years.add(Number(m[1]));
  }
  return [...years].sort();
}

export function matchConcerns(i: ConcernInput, now: number = Date.now()): Concern[] {
  const out: Concern[] = [];
  const text = `${i.job.title}\n${i.job.description ?? ""}`;

  const fresh = freshnessOf({ status: i.job.status, discovered_at: i.job.discoveredAt, last_verified_at: i.job.lastVerifiedAt, deadline: i.job.deadline }, now);
  if (fresh.state === "closed" || fresh.state === "expired") out.push({ text: `${fresh.label}: ${fresh.detail}`, severity: "warn" });
  else if (fresh.state === "stale") out.push({ text: fresh.detail, severity: "warn" });

  if (i.missingRequired.length) {
    out.push({ text: `Missing ${i.missingRequired.length} required skill${i.missingRequired.length > 1 ? "s" : ""}: ${i.missingRequired.slice(0, 4).join(", ")}${i.missingRequired.length > 4 ? "…" : ""}`, severity: i.missingRequired.length >= 3 ? "warn" : "info" });
  }
  if (ADVANCED.test(text)) out.push({ text: "Mentions a Ph.D. or master's degree requirement — check whether undergraduates are eligible.", severity: "warn" });
  const y = text.match(YEARS);
  if (y) out.push({ text: `Asks for ${y[1]}+ years of professional experience, which is unusual for an internship.`, severity: "warn" });
  if (isAuthRestricted(text)) {
    out.push({
      text: i.profile.workAuthorization === "f1" ? "Lists citizenship, clearance or no-sponsorship limits, which may not be compatible with F-1 status. Verify with SJSU ISSS." : "Lists citizenship, clearance or no-sponsorship limits. Read the posting carefully.",
      severity: "warn",
    });
  }

  const targets = targetGraduationYears(text);
  const gy = i.profile.graduationYear;
  if (targets.length && gy && !targets.includes(gy)) {
    out.push({ text: `Targets students graduating in ${targets.join(" or ")}; your profile says ${gy}.`, severity: "warn" });
  }

  if (!i.job.isOnCampus && !i.job.isRemote && i.distanceMiles != null && i.distanceMiles > i.profile.radiusMiles) {
    out.push({ text: `On-site ${Math.round(i.distanceMiles)} miles away, outside your ${i.profile.radiusMiles}-mile radius.`, severity: "info" });
  }
  if (i.job.deadline) {
    // Calendar days, not elapsed hours: a deadline two dates away is "2 days", however late in the day it is.
    const today = new Date(now).toISOString().slice(0, 10);
    const days = Math.round((Date.parse(`${i.job.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days >= 0 && days <= 3) out.push({ text: days === 0 ? "The application deadline is today." : `The application deadline is in ${days} day${days > 1 ? "s" : ""}.`, severity: "warn" });
  }
  return out;
}

// ───────────────────────── evidence: which real experience/projects back a matched skill ─────────────────────────

export type Evidence = {
  experience: { title: string; organization: string; skills: string[] }[];
  projects: { name: string; skills: string[] }[];
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SKILL_RX = new Map(
  SKILLS.map((s) => [s.name.toLowerCase(), new RegExp(`(?<![A-Za-z0-9+#])(?:${[s.name, ...s.aliases].map(esc).join("|")})(?![A-Za-z0-9+#])`, "i")]),
);

/**
 * For each skill the job wants that the student has, find the student's own confirmed experience and projects
 * that actually mention it. Only confirmed profile items count, and only the words already in them are matched.
 */
export function relevantEvidence(items: CandidateItem[], matchedSkillNames: string[]): Evidence {
  const wanted = matchedSkillNames.map((n) => [n, SKILL_RX.get(n.toLowerCase())] as const).filter((x): x is readonly [string, RegExp] => Boolean(x[1]));
  const hits = (text: string) => wanted.filter(([, rx]) => rx.test(text)).map(([n]) => n);
  const ev: Evidence = { experience: [], projects: [] };
  for (const it of items.filter(isEligible)) {
    if (it.section === "experience") {
      const d = it.data as ExperienceData;
      const skills = hits([d.title, ...d.bullets].join("\n"));
      if (skills.length) ev.experience.push({ title: d.title, organization: d.organization, skills });
    } else if (it.section === "project") {
      const d = it.data as ProjectData;
      const skills = hits([d.name, ...d.technologies, ...d.bullets].join("\n"));
      if (skills.length) ev.projects.push({ name: d.name, skills });
    }
  }
  const byCount = <T extends { skills: string[] }>(a: T, b: T) => b.skills.length - a.skills.length;
  ev.experience.sort(byCount);
  ev.projects.sort(byCount);
  return ev;
}
