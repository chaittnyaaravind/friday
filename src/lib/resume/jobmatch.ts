/**
 * Job-description matching — deterministic. Splits a pasted posting into requirements and
 * compares each against the structured resume. It never suggests claiming a skill: a missing
 * skill is reported as missing, with the reminder to add it only if it is genuinely yours.
 *
 *   matched   listed in Skills AND shown in a bullet or project
 *   weak      listed, but nothing shows you using it (or it only appears in coursework/education)
 *   unclear   used in a bullet but not listed in Skills — keyword filters may miss it
 *   missing   not on the resume
 */
import { extractRequirements } from "@/lib/domain/requirements";
import { extractSkills, resolveSkill, skillBySlug, type SkillCategory } from "@/lib/domain/skills";
import { allLines, type LineRef } from "./edits";
import { docToText } from "./generate";
import { hasTerm } from "./guard";
import { skillMentions } from "./parse";
import type { ResumeDoc } from "./types";

export type MatchStatus = "matched" | "weak" | "unclear" | "missing";

export type Evidence = { text: string; where: string; ref: LineRef | null };
export type SkillMatch = { slug: string; name: string; kind: "required" | "preferred"; status: MatchStatus; listedInSkills: boolean; message: string; evidence: Evidence[] };
export type JdAnalysis = { required: string[]; preferred: string[]; technologies: string[]; responsibilities: string[]; domain: string[]; education: string[]; experience: string[] };
export type Keyword = { term: string; present: boolean };
export type Relevance = { pct: number | null; label: "Strong" | "Moderate" | "Low" | "n/a"; bulletsWithMatch: number; bullets: number };

export type JobMatch = {
  jd: JdAnalysis;
  skills: SkillMatch[];
  counts: Record<MatchStatus, number>;
  /** present = mentioned anywhere; demonstrated = matched (listed and shown). null when the posting names none. */
  coverage: { present: number | null; demonstrated: number | null; requiredPresent: number | null };
  keywords: Keyword[];
  education: { requirement: string; found: boolean | null }[];
  relevance: Relevance;
  missingRequired: string[];
};

const TECH_CATEGORIES: SkillCategory[] = ["language", "frontend", "backend", "data", "ml", "cloud", "devops", "database", "mobile", "testing", "security", "systems"];
const DOMAIN_TERMS = ["fintech", "healthcare", "e-commerce", "gaming", "cybersecurity", "adtech", "edtech", "robotics", "autonomous", "computer vision", "natural language", "blockchain", "saas", "b2b", "iot", "developer tools", "payments", "biotech", "aerospace", "automotive", "distributed systems", "observability", "supply chain", "open source", "real-time", "machine learning", "data pipelines"];
const STOP = new Set("about across after also and are attention be been being both build can candidate company create ensure experience from have help including into job join looking must need new our part role skills strong team that the their them this through today using want we well what will with work working you your years plus etc requirements responsibilities qualifications preferred required".split(" "));

const HEADING = /^\s*(?:about (?:us|the (?:team|company|role))|what you(?:'ll)? (?:do|need|bring)|responsibilities|requirements|qualifications|minimum qualifications|preferred qualifications|benefits|perks|compensation|nice to have|who you are|the role)\b.*$/i;
const RESP_HEAD = /^\s*(?:key\s+)?(?:responsibilities|what you(?:'ll)? do|your role|you will|the role|day[- ]to[- ]day)\b.*$/i;

const clean = (l: string) => l.replace(/^\s*[•*\-–▪·]\s*/, "").trim();
const name = (slug: string) => skillBySlug(slug)?.name ?? slug;

export function analyzeJd(text: string): JdAnalysis {
  const reqs = extractRequirements(text, 14);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const responsibilities: string[] = [];
  let inResp = false;
  for (const l of lines) {
    if (l.length < 80 && RESP_HEAD.test(l)) { inResp = true; continue; }
    if (l.length < 80 && HEADING.test(l)) { inResp = false; continue; }
    if (inResp && responsibilities.length < 8) responsibilities.push(clean(l).slice(0, 180));
  }
  const technologies = extractSkills(text).filter((s) => TECH_CATEGORIES.includes(skillBySlug(s)?.category as SkillCategory)).map(name).slice(0, 24);
  const lower = text.toLowerCase();
  return {
    required: reqs.filter((r) => r.kind === "required").map((r) => name(r.slug)),
    preferred: reqs.filter((r) => r.kind === "preferred").map((r) => name(r.slug)),
    technologies,
    responsibilities,
    domain: DOMAIN_TERMS.filter((d) => lower.includes(d)),
    education: lines.filter((l) => /\b(?:bachelor|master|ph\.?d|b\.?s\.?\b|m\.?s\.?\b|degree|enrolled|pursuing|currently (?:a )?student|graduat)/i.test(l)).map((l) => clean(l).slice(0, 160)).slice(0, 4),
    experience: lines.filter((l) => /\b\d+\+?\s*(?:-|to)?\s*\d*\s*years?\b/i.test(l)).map((l) => clean(l).slice(0, 160)).slice(0, 4),
  };
}

function frequentTerms(text: string, skip: Set<string>): string[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z+#-]{4,}/g) ?? []) if (!STOP.has(w) && !skip.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

const WORK = new Set(["experience", "projects", "activities"]);

export function matchJob(doc: ResumeDoc, jdText: string): JobMatch {
  const jd = analyzeJd(jdText);
  const reqs = extractRequirements(jdText, 14);

  // Where each taxonomy skill appears on the resume.
  const listed = new Set<string>();
  const shown = new Map<string, Evidence[]>(); // in bullets / project technologies
  const elsewhere = new Map<string, Evidence[]>(); // summary, education, coursework, certifications
  const push = (m: Map<string, Evidence[]>, slug: string, e: Evidence) => m.set(slug, [...(m.get(slug) ?? []), e]);

  for (const section of doc.sections) {
    if (section.kind === "skills") {
      for (const l of section.lines) for (const tok of l.text.replace(/^[^:]{1,40}:\s*/, "").split(/\s*[,;]\s*/)) { const s = resolveSkill(tok); if (s) listed.add(s); }
    }
    if (section.kind === "projects") {
      for (const e of section.entries) for (const s of extractSkills(e.subheading)) push(shown, s, { text: `${e.heading} — ${e.subheading}`, where: `Projects · ${e.heading}`, ref: null });
    }
  }
  for (const { ref, line, section, entry } of allLines(doc)) {
    if (section.kind === "skills") continue;
    const slugs = extractSkills(line.text);
    const ev: Evidence = { text: line.text, where: entry ? `${section.title} · ${entry.heading}` : section.title, ref };
    for (const s of slugs) push(WORK.has(section.kind) ? shown : elsewhere, s, ev);
  }
  for (const section of doc.sections) {
    if (!WORK.has(section.kind)) for (const e of section.entries) for (const s of extractSkills([e.heading, e.subheading].join(" "))) push(elsewhere, s, { text: e.heading, where: section.title, ref: null });
  }

  const skills: SkillMatch[] = reqs.map(({ slug, kind }) => {
    const n = name(slug);
    const inSkills = listed.has(slug);
    const inBullets = shown.get(slug) ?? [];
    const other = elsewhere.get(slug) ?? [];
    let status: MatchStatus;
    let message: string;
    if (inSkills && inBullets.length) {
      status = "matched";
      message = `Listed in Skills and shown in ${inBullets.length} place${inBullets.length > 1 ? "s" : ""}.`;
    } else if (inSkills) {
      status = "weak";
      message = `You list ${n}, but no bullet or project shows you using it. Add a real example if you have one.`;
    } else if (inBullets.length) {
      status = "unclear";
      message = `${n} appears in your bullets but isn't in your Skills section, so keyword filters may miss it.`;
    } else if (other.length) {
      status = "weak";
      message = `${n} only appears in ${other[0].where}. It reads as familiarity, not experience.`;
    } else {
      status = "missing";
      message = `You don't currently list ${n}. Only add it if you genuinely have this skill.`;
    }
    return { slug, name: n, kind, status, listedInSkills: inSkills, message, evidence: [...inBullets, ...other].slice(0, 4) };
  });

  const counts: JobMatch["counts"] = { matched: 0, weak: 0, unclear: 0, missing: 0 };
  for (const s of skills) counts[s.status]++;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
  const required = skills.filter((s) => s.kind === "required");

  const text = docToText(doc);
  const skillWords = new Set(skills.map((s) => s.name.toLowerCase()));
  const keywords: Keyword[] = [...jd.domain, ...frequentTerms(jdText, skillWords)].map((term) => ({ term, present: hasTerm(text, term) }));

  // Education requirements: only ever "found" or "can't tell" — never a suggestion to claim one.
  const eduText = doc.sections.filter((s) => s.kind === "education").flatMap((s) => s.entries.map((e) => `${e.heading} ${e.subheading} ${e.meta}`)).join(" ");
  const education = jd.education.map((requirement) => {
    const level = /ph\.?d|doctor/i.test(requirement) ? /ph\.?d|doctor/i : /master|\bm\.?s\.?\b/i.test(requirement) ? /master|\bm\.?s\.?\b|m\.?eng/i : /bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b/i.test(requirement) ? /bachelor|\bb\.?s\.?\b|\bb\.?a\.?\b|b\.?eng/i : null;
    return { requirement, found: level ? level.test(eduText) : null };
  });

  // Relevance: how much of the actual work history speaks to this posting.
  const jdSlugs = new Set(reqs.map((r) => r.slug));
  const terms = keywords.map((k) => k.term);
  let total = 0;
  let hit = 0;
  for (const { line, section, entry } of allLines(doc)) {
    if (!entry || !WORK.has(section.kind)) continue;
    total++;
    if (extractSkills(line.text).some((s) => jdSlugs.has(s)) || terms.some((t) => hasTerm(line.text, t))) hit++;
  }
  const rp = pct(hit, total);
  const relevance: Relevance = { pct: rp, label: rp === null || !reqs.length ? "n/a" : rp >= 60 ? "Strong" : rp >= 30 ? "Moderate" : "Low", bulletsWithMatch: hit, bullets: total };

  return {
    jd,
    skills,
    counts,
    coverage: { present: pct(skills.filter((s) => s.status !== "missing").length, skills.length), demonstrated: pct(counts.matched, skills.length), requiredPresent: pct(required.filter((s) => s.status !== "missing").length, required.length) },
    keywords,
    education,
    relevance,
    missingRequired: required.filter((s) => s.status === "missing").map((s) => s.name),
  };
}

// ───────────────────────── semantic matching helpers (pure) ─────────────────────────

/**
 * Lines of a posting that read as requirements or responsibilities — the sentences worth matching
 * against the resume by meaning, beyond exact skill keywords. At most `max`, longest signal first.
 */
export function requirementLines(text: string, max = 8): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let inList = true;
  for (const raw of lines) {
    if (raw.length < 60 && /^(?:about|benefits|perks|compensation|equal opportunity|our (?:mission|culture)|why join)\b/i.test(raw)) { inList = false; continue; }
    if (raw.length < 60 && /^(?:requirements|qualifications|responsibilities|what you|minimum|preferred|nice to have|the role|you will|who you are)\b/i.test(raw)) { inList = true; continue; }
    const t = raw.replace(/^\s*[•*\-–▪·]\s*/, "").trim();
    if (!inList || t.length < 20 || t.length > 220 || !/[a-z]/i.test(t)) continue;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, max);
}

export type MatchExplanation = { summary: string; nextSteps: { requirement: string; advice: string }[] };

const NEGATION = /\b(?:no|not|isn'?t|aren'?t|doesn'?t|don'?t|missing|lack\w*|without|only if|if you|unless|gap|need\w*|would|could|might|consider|weak\w*)\b/i;

/**
 * A model's explanation of a match result, made safe: it may not assert that the student has a skill the
 * deterministic match found missing or weak. Sentences that name one without a negation or condition are
 * dropped; next steps must be about a real gap, and every "missing" step starts with our own fixed wording.
 */
export function sanitizeExplanation(exp: { summary?: string; nextSteps?: { requirement: string; advice: string }[] } | null | undefined, m: JobMatch): MatchExplanation | null {
  if (!exp) return null;
  const gapNames = m.skills.filter((s) => s.status !== "matched").map((s) => s.name);
  const claim = (sentence: string) => gapNames.some((n) => hasTerm(sentence, n)) && !NEGATION.test(sentence);
  const summary = (exp.summary ?? "").split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !claim(s) && !/\d/.test(s.replace(/\bJD\b/g, ""))).join(" ").trim();
  const byName = new Map(m.skills.map((s) => [s.name.toLowerCase(), s]));
  const nextSteps: MatchExplanation["nextSteps"] = [];
  for (const step of exp.nextSteps ?? []) {
    const s = byName.get(step.requirement.trim().toLowerCase());
    if (!s || s.status === "matched") continue; // about a real gap only
    // Advice may only be conditional ("If you have…") and may not name any OTHER technology — that would put tools in the student's mouth.
    const others = (x: string) => skillMentions(x).filter((t) => !hasTerm(s.name, t) && !hasTerm(t, s.name));
    const extra = step.advice.split(/(?<=[.!?])\s+/).filter((x) => x.trim() && !claim(x) && !/\d/.test(x) && /\b(?:if|when|where)\b/i.test(x) && !others(x).length).join(" ").trim();
    nextSteps.push({ requirement: s.name, advice: [s.message, extra].filter(Boolean).join(" ") });
  }
  return summary || nextSteps.length ? { summary, nextSteps: nextSteps.slice(0, 6) } : null;
}
