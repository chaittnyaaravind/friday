/**
 * Transparent match engine. Every point of the score comes from a named reason the
 * user can see — no hidden model output. Pure and deterministic, so it runs in the
 * discovery agent for every user×job pair and in unit tests.
 */
import { distanceMiles } from "./geo";
import { SKILLS as ALL_SKILLS, skillBySlug, type SkillCategory } from "./skills";
import type { EmploymentType } from "./normalize";

export type MatchProfile = {
  major: string | null;
  skills: string[]; // taxonomy slugs
  origin: { lat: number; lng: number };
  radiusMiles: number;
  workplace: "onsite" | "hybrid" | "remote" | "any";
  desiredTitles: string[];
  /** Used by the eligibility check, never by the score. */
  workAuthorization?: "f1" | "us_citizen" | "permanent_resident" | "other" | null;
  graduationYear?: number | null;
};

export type MatchJob = {
  title: string;
  employmentType: EmploymentType;
  category: string | null;
  isOnCampus: boolean;
  lat: number | null;
  lng: number | null;
  city: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  description: string | null;
  requirements: { slug: string | null; label: string; kind: "required" | "preferred" }[];
  /** Used by the eligibility check, never by the score. */
  status?: string;
  deadline?: string | null;
  hoursMax?: number | null;
  workStudy?: "required" | "eligible" | "not_required" | "unknown";
};

export type Reason = { label: string; kind: "skill" | "role" | "profile" | "location" };
export type Gap = { label: string; kind: "required" | "preferred" };

/** One component of the score: what it earned out of what it could, and why, in plain words. The points sum to the score. */
export type BreakdownPart = { key: "skills" | "role" | "profile" | "location"; label: string; points: number; max: number; detail: string };

export type MatchResult = {
  score: number;
  strong: Reason[];
  missing: Gap[];
  difficulty: "low" | "medium" | "high";
  distanceMiles: number | null;
  tier: "strong" | "good" | "stretch";
  /** Where every point of `score` came from. Sums to `score`. */
  breakdown: BreakdownPart[];
};

const CS_MAJOR = /\b(?:computer science|computer engineering|software engineering|data science|cs|cmpe|se|electrical engineering|information|informatics|mathematics|math|statistics|applied data)\b/i;
const HARD_SIGNALS = /\b(?:ph\.?d|doctoral|master'?s (?:degree )?(?:required|only)|currently pursuing (?:a )?(?:ph\.?d|master)|[3-9]\+? years (?:of )?(?:professional |industry )?experience|security clearance|active clearance)\b/i;

export function computeMatch(p: MatchProfile, j: MatchJob): MatchResult {
  const strong: Reason[] = [];
  const missing: Gap[] = [];
  const have = new Set(p.skills);
  let score = 0;
  const breakdown: BreakdownPart[] = [];

  // ── Skills (60) ──
  const req = j.requirements.filter((r) => r.kind === "required");
  const pref = j.requirements.filter((r) => r.kind === "preferred");
  const covered = (r: MatchJob["requirements"][number]) => Boolean(r.slug && have.has(r.slug));
  const nameOf = (r: MatchJob["requirements"][number]) => (r.slug ? skillBySlug(r.slug)?.name ?? r.label : r.label);

  for (const r of [...req, ...pref]) {
    if (covered(r)) strong.push({ label: nameOf(r), kind: "skill" });
    else missing.push({ label: nameOf(r), kind: r.kind });
  }
  let skillPts: number;
  let skillDetail: string;
  if (req.length + pref.length === 0) {
    skillPts = 30; // unknown requirements: neutral, not a penalty
    skillDetail = "The posting lists no skills, so FRIDAY gives a neutral 30 of 60 rather than guessing.";
  } else {
    const reqRatio = req.filter(covered).length / (req.length || 1);
    const prefRatio = pref.filter(covered).length / (pref.length || 1);
    const coverage = req.length && pref.length ? reqRatio * 0.8 + prefRatio * 0.2 : req.length ? reqRatio : prefRatio;
    // Few listed requirements = little evidence: pull toward neutral (0.5) instead of claiming a perfect fit.
    const confidence = Math.min(1, (req.length + pref.length * 0.5) / 4);
    skillPts = Math.round(60 * (confidence * coverage + (1 - confidence) * 0.5));
    const counts = [req.length ? `${req.filter(covered).length} of ${req.length} required` : "", pref.length ? `${pref.filter(covered).length} of ${pref.length} preferred` : ""].filter(Boolean).join(" and ");
    skillDetail = `You have ${counts} skills${confidence < 1 ? "; only a few skills are listed, so the score is pulled toward the middle rather than trusting a small sample" : ""}.`;
  }
  score += skillPts;
  breakdown.push({ key: "skills", label: "Skills", points: skillPts, max: 60, detail: skillDetail });

  // ── Role fit (15) ──
  const studentType = ["internship", "on_campus", "co_op", "research", "part_time"].includes(j.employmentType);
  let rolePts = 0;
  let roleDetail = "Not marked as a student or early-career role, so it earns no role points.";
  if (j.isOnCampus) {
    strong.push({ label: "SJSU on-campus position", kind: "role" });
    score += 15;
    rolePts = 15;
    roleDetail = "An SJSU on-campus position.";
  } else if (studentType) {
    strong.push({ label: j.employmentType === "internship" ? "Internship position" : "Student-friendly role", kind: "role" });
    score += 15;
    rolePts = 15;
    roleDetail = j.employmentType === "internship" ? "An internship." : "A student-friendly role.";
  } else if (/new grad|early career|entry/i.test(j.title)) {
    strong.push({ label: "Early-career role", kind: "role" });
    score += 8;
    rolePts = 8;
    roleDetail = "An early-career role (worth less than an internship or campus job).";
  }
  const wantsTitle = p.desiredTitles.some((t) => t && j.title.toLowerCase().includes(t.toLowerCase().replace(/\s*intern(ship)?$/, "")));
  if (wantsTitle) {
    strong.push({ label: "Matches a title you want", kind: "role" });
    roleDetail += " It also matches a title you want (shown for context; it adds no points).";
  }
  breakdown.push({ key: "role", label: "Role type", points: rolePts, max: 15, detail: roleDetail });

  // ── Profile (10) ──
  const technical = j.category !== null && j.category !== "Product/Technical";
  // Hardware/embedded roles only count as a major fit if the student shows hardware skills.
  const hardwareOk = j.category !== "Embedded" || ["embedded", "verilog", "vhdl", "fpga", "computer-architecture", "assembly"].some((s) => have.has(s));
  let profilePts = 0;
  let profileDetail = "Your major is not recognised as related to this technical role, so it earns no profile points.";
  if (p.major && CS_MAJOR.test(p.major) && technical && hardwareOk) {
    strong.push({ label: `${shortMajor(p.major)} student`, kind: "profile" });
    score += 10;
    profilePts = 10;
    profileDetail = `Your major (${shortMajor(p.major)}) fits a technical role.`;
  } else if (!technical || j.isOnCampus) {
    score += 5;
    profilePts = 5;
    profileDetail = "Not a technical role (or on campus), so major matters less: a neutral 5 of 10.";
  } else if (!p.major) {
    profileDetail = "No major on your profile yet, so a technical role earns no profile points.";
  } else if (j.category === "Embedded" && !hardwareOk) {
    profileDetail = "Hardware and embedded roles count as a fit only when your skills show hardware experience.";
  }
  breakdown.push({ key: "profile", label: "Profile fit", points: profilePts, max: 10, detail: profileDetail });

  // ── Location (15) ──
  let dist: number | null = null;
  let locPts = 0;
  let locDetail = "No location is known for this posting, so it earns no location points.";
  if (j.lat != null && j.lng != null) {
    dist = Math.round(distanceMiles(p.origin, { lat: j.lat, lng: j.lng }) * 10) / 10;
    if (dist <= p.radiusMiles) {
      strong.push({ label: j.isOnCampus ? "On campus" : `${j.city ?? "Nearby"} · ${dist < 1 ? "<1" : Math.round(dist)} mi`, kind: "location" });
      locPts = dist <= 10 ? 15 : 11;
      locDetail = `${j.isOnCampus ? "On campus" : `About ${dist < 1 ? "under a mile" : `${Math.round(dist)} miles`} away`}, inside your ${p.radiusMiles}-mile radius${dist <= 10 ? "" : " (farther than 10 miles earns slightly less)"}.`;
    } else {
      locPts = 3;
      locDetail = `About ${Math.round(dist)} miles away, outside your ${p.radiusMiles}-mile radius, so only a token 3 of 15.`;
    }
  } else if (j.isRemote && p.workplace !== "onsite") {
    strong.push({ label: "Remote", kind: "location" });
    locPts = 10;
    locDetail = "Remote, and you are open to remote work.";
  } else if (j.isRemote) {
    locDetail = "Remote, but your profile prefers on-site work, so it earns no location points.";
  }
  score += locPts;
  breakdown.push({ key: "location", label: "Location", points: locPts, max: 15, detail: locDetail });
  if (j.isHybrid && (p.workplace === "hybrid" || p.workplace === "any")) strong.push({ label: "Hybrid", kind: "location" });

  score = Math.max(0, Math.min(100, score));

  // ── Difficulty ──
  const missingRequired = missing.filter((m) => m.kind === "required").length;
  let difficulty: MatchResult["difficulty"] = "medium";
  if (HARD_SIGNALS.test(j.description ?? "") || missingRequired >= 3) difficulty = "high";
  else if ((j.isOnCampus || missingRequired === 0) && !/research scientist|phd/i.test(j.title)) difficulty = "low";

  const tier = score >= 75 ? "strong" : score >= 55 ? "good" : "stretch";
  return { score, strong: dedupe(strong), missing: dedupeGaps(missing), difficulty, distanceMiles: dist, tier, breakdown };
}

function shortMajor(m: string) {
  if (/computer science/i.test(m)) return "Computer Science";
  if (/computer engineering|cmpe/i.test(m)) return "Computer Engineering";
  if (/software engineering/i.test(m)) return "Software Engineering";
  if (/data science/i.test(m)) return "Data Science";
  return m;
}
const dedupe = (rs: Reason[]) => rs.filter((r, i) => rs.findIndex((x) => x.label === r.label) === i);
const dedupeGaps = (gs: Gap[]) => gs.filter((g, i) => gs.findIndex((x) => x.label === g.label) === i);

// ───────────────────────── work authorization ─────────────────────────

export const ISSS_URL = "https://www.sjsu.edu/isss/current-students/employment/index.php";
export const ISSS_ON_CAMPUS_URL = "https://www.sjsu.edu/isss/current-students/employment/campus.php";
export const ISSS_NOTICE = "Verify eligibility with SJSU ISSS before accepting employment.";

export type AuthGuidance = {
  status: "potentially_relevant" | "requires_verification" | "posting_restricts" | "not_applicable";
  headline: string;
  detail: string;
  link: string | null;
};

const RESTRICTS = /\b(?:u\.?s\.? citizen(?:ship)? (?:is )?required|must be a u\.?s\.? citizen|(?:active|secret|top secret) (?:security )?clearance|not (?:able|eligible) to (?:provide|offer) (?:visa )?sponsorship|no (?:visa )?sponsorship|without (?:the need for )?(?:current or future )?(?:visa )?sponsorship|export control|itar)\b/i;

/** True when a posting states citizenship / clearance / no-sponsorship limits. */
export function isAuthRestricted(text: string | null | undefined) {
  return RESTRICTS.test(text ?? "");
}

/**
 * Informational only — never legal advice, never a claim that CPT/OPT is approved.
 * Only shown for F-1 users; other statuses get a neutral note when a posting restricts.
 */
export function authGuidance(
  auth: "f1" | "us_citizen" | "permanent_resident" | "other" | null,
  job: { employmentType: EmploymentType; isOnCampus: boolean; description: string | null },
): AuthGuidance {
  const restricted = RESTRICTS.test(job.description ?? "");
  if (auth !== "f1") {
    return restricted
      ? { status: "posting_restricts", headline: "Posting mentions work-authorization limits", detail: "The employer lists citizenship, clearance, or sponsorship restrictions. Read the posting carefully.", link: null }
      : { status: "not_applicable", headline: "", detail: "", link: null };
  }
  if (restricted) {
    return {
      status: "posting_restricts",
      headline: "Posting lists authorization restrictions",
      detail: "This employer mentions citizenship, clearance, or no-sponsorship requirements, which may not be compatible with F-1 status. " + ISSS_NOTICE,
      link: ISSS_URL,
    };
  }
  if (job.isOnCampus || job.employmentType === "on_campus") {
    return {
      status: "potentially_relevant",
      headline: "On-campus employment — potentially relevant for F-1",
      detail: "On-campus jobs are generally the most accessible option for F-1 students, subject to hour limits during the academic term. " + ISSS_NOTICE,
      link: ISSS_ON_CAMPUS_URL,
    };
  }
  if (["internship", "co_op", "part_time", "full_time", "research"].includes(job.employmentType)) {
    return {
      status: "requires_verification",
      headline: "May be compatible with CPT/OPT — requires verification",
      detail: "Off-campus work for F-1 students requires authorization such as CPT or OPT. FRIDAY cannot determine eligibility. " + ISSS_NOTICE,
      link: ISSS_URL,
    };
  }
  return { status: "requires_verification", headline: "Requires verification", detail: ISSS_NOTICE, link: ISSS_URL };
}

// ───────────────────────── learning suggestions ─────────────────────────

const LEARN: Partial<Record<SkillCategory, (n: string) => string>> = {
  backend: (n) => `Build a small ${n} REST API backed by a database and deploy it — e.g. a job-tracker API.`,
  frontend: (n) => `Build and deploy a small ${n} app (a clean dashboard or tracker UI) and link it from your resume.`,
  cloud: (n) => `Deploy one of your projects on ${n}'s free tier and note the services you used.`,
  devops: (n) => `Add ${n} to an existing project (containerize it or automate its build) and document it in the README.`,
  database: (n) => `Model a small schema in ${n} and query it from one of your projects.`,
  data: (n) => `Do a short analysis with ${n} on a public dataset and publish the notebook on GitHub.`,
  ml: (n) => `Train and evaluate a small ${n} model on a public dataset; write up results in the repo README.`,
  language: (n) => `Solve 15–20 practice problems in ${n}, then port one feature of an existing project to it.`,
  cs: (n) => `Two weeks of focused ${n} practice (LeetCode-style), then re-check this role.`,
  testing: (n) => `Add ${n} to an existing project with meaningful coverage and mention it on your resume.`,
  systems: (n) => `Take on a small ${n} project (course lab or open-source issue) and summarize what you built.`,
  mobile: (n) => `Ship a tiny ${n} app (one or two screens) and put the repo on GitHub.`,
  security: (n) => `Complete a hands-on ${n} lab (e.g. a CTF or TryHackMe path) and list it under projects.`,
};

/** A concrete, honest next step for a missing requirement. */
export function learnSuggestion(label: string): string {
  const k = SKILL_BY_NAME.get(label.toLowerCase());
  const fn = k ? LEARN[k.category] : undefined;
  return fn ? fn(label) : `Add a small project that uses ${label}, then re-check this role.`;
}
const SKILL_BY_NAME = new Map(ALL_SKILLS.map((s) => [s.name.toLowerCase(), s]));
