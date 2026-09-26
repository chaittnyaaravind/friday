/**
 * ATS analysis — fully deterministic and explainable. Every component has a weight, a 0–100
 * score, a rating, and a plain-language reason; the overall score is the weighted average of
 * exactly the components listed. No model is involved and nothing is random.
 *
 * Keyword coverage only exists when a job description is supplied (via `matchJob`); without
 * one it is left out of the average and the report says so.
 */
import { findRepeats, findWeakBullets, allLines, type LineRef } from "./edits";
import { docToText } from "./generate";
import { wordCount } from "./guard";
import type { JobMatch } from "./jobmatch";
import type { ResumeDoc } from "./types";

export type Rating = "Good" | "Fair" | "Needs work";
export type AtsFix = { message: string; ref?: LineRef | null };
export type AtsComponent = { id: string; label: string; score: number; weight: number; rating: Rating; reason: string; details: string[]; fixes: AtsFix[] };
export type AtsReport = {
  score: number;
  rating: Rating;
  components: AtsComponent[];
  /** The headline lines, e.g. "Keyword coverage: 72%". */
  summary: { label: string; value: string }[];
  basis: string;
  hasJd: boolean;
};

export const rate = (score: number): Rating => (score >= 80 ? "Good" : score >= 60 ? "Fair" : "Needs work");
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const WORK = new Set(["experience", "projects", "activities"]);

const STANDARD_HEADINGS = new Set(["summary", "professional summary", "objective", "education", "experience", "work experience", "professional experience", "employment", "projects", "personal projects", "skills", "technical skills", "certifications", "awards", "honors", "awards & honors", "coursework", "relevant coursework", "leadership", "activities", "leadership & activities", "extracurricular activities", "publications", "research"]);

const BASE_VERBS = new Set("build lead write design develop manage create run maintain test analyze implement collaborate deploy support teach mentor organize coordinate research present review automate optimize built led ran wrote made taught drove began won set put cut held kept met sent spent".split(" "));
const startsWithVerb = (t: string) => {
  const w = (t.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return /^[a-z]{3,}ed$/.test(w) || BASE_VERBS.has(w);
};

const component = (id: string, label: string, weight: number, score: number, reason: string, details: string[] = [], fixes: AtsFix[] = []): AtsComponent => {
  const s = clamp(score);
  return { id, label, weight, score: s, rating: rate(s), reason, details, fixes };
};

export function analyzeAts(doc: ResumeDoc, opts: { match?: JobMatch | null } = {}): AtsReport {
  const text = docToText(doc);
  const comps: AtsComponent[] = [];

  // ── Contact information ──
  {
    const blob = [doc.header.name, ...doc.header.contact].join(" ");
    const has = {
      name: Boolean(doc.header.name.trim()),
      email: /[\w.+-]+@[\w-]+\.[\w.-]+/.test(blob),
      phone: /(?:\+?\d[\d\s().-]{8,}\d)/.test(blob),
      location: doc.header.contact.some((c) => /,\s*[A-Z]{2}\b|\b(?:remote|california|ca)\b/i.test(c)) || doc.header.contact.some((c) => /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+$/.test(c)),
      link: /linkedin\.com|github\.com|\.dev\b|\.io\b|portfolio/i.test(blob),
    };
    const pts = { name: 30, email: 25, phone: 20, location: 10, link: 15 };
    const score = (Object.keys(pts) as (keyof typeof pts)[]).reduce((n, k) => n + (has[k] ? pts[k] : 0), 0);
    const missing = (Object.keys(has) as (keyof typeof has)[]).filter((k) => !has[k]);
    comps.push(component("contact", "Contact information", 15, score,
      missing.length ? `Missing: ${missing.join(", ")}.` : "Name, email, phone, location and a profile link are all present.",
      (Object.keys(has) as (keyof typeof has)[]).map((k) => `${has[k] ? "✓" : "✗"} ${k}`),
      missing.map((k) => ({ message: `Add your ${k === "link" ? "LinkedIn or GitHub link" : k} if you have one.` }))));
  }

  // ── Section headings ──
  {
    const kinds = new Set(doc.sections.map((s) => s.kind));
    const odd = doc.sections.filter((s) => !STANDARD_HEADINGS.has(s.title.trim().toLowerCase()));
    let score = (kinds.has("education") ? 40 : 0) + (kinds.has("experience") || kinds.has("projects") ? 35 : 0) + (kinds.has("skills") ? 25 : 0) - odd.length * 8;
    score = Math.max(0, score);
    const need: string[] = [];
    if (!kinds.has("education")) need.push("Education");
    if (!kinds.has("experience") && !kinds.has("projects")) need.push("Experience or Projects");
    if (!kinds.has("skills")) need.push("Skills");
    comps.push(component("sections", "Section headings", 15, score,
      need.length ? `Missing standard section${need.length > 1 ? "s" : ""}: ${need.join(", ")}.` : odd.length ? `${odd.length} heading${odd.length > 1 ? "s aren't" : " isn't"} a standard name an ATS recognizes.` : "All headings use standard names an ATS recognizes.",
      doc.sections.map((s) => `${STANDARD_HEADINGS.has(s.title.trim().toLowerCase()) ? "✓" : "✗"} ${s.title}`),
      [...need.map((n) => ({ message: `Add a ${n} section if you have content for it.` })), ...odd.map((s) => ({ message: `Rename “${s.title}” to a standard heading (e.g. Experience, Projects, Skills).` }))]));
  }

  // ── Bullet quality ──
  {
    const bullets = [...allLines(doc)].filter((x) => x.entry && x.line.text.trim());
    const n = bullets.length;
    const words = bullets.map((b) => wordCount(b.line.text));
    const ideal = words.filter((w) => w >= 8 && w <= 28).length;
    const long = bullets.filter((_, i) => words[i] > 35);
    const short = bullets.filter((_, i) => words[i] < 5);
    const verbs = bullets.filter((b) => startsWithVerb(b.line.text)).length;
    const score = n ? (ideal / n) * 60 + (verbs / n) * 40 : 0;
    comps.push(component("bullets", "Bullet length & phrasing", 15, score,
      n ? `${ideal} of ${n} bullets are a readable length (8–28 words); ${verbs} of ${n} start with an action verb.` : "No bullets found to evaluate.",
      [`${long.length} over 35 words`, `${short.length} under 5 words`],
      [...long.slice(0, 4).map((b) => ({ message: `Too long (${wordCount(b.line.text)} words): “${b.line.text.slice(0, 70)}…”`, ref: b.ref })), ...short.slice(0, 4).map((b) => ({ message: `Too short to show impact: “${b.line.text}”`, ref: b.ref }))]));
  }

  // ── Dates ──
  {
    const entries = doc.sections.filter((s) => ["education", "experience", "activities", "projects"].includes(s.kind)).flatMap((s) => s.entries.map((e) => ({ s, e })));
    const withYear = entries.filter(({ e }) => /\b(?:19|20)\d{2}\b/.test(e.meta));
    const style = (m: string) => (/\b[A-Z][a-z]{2}\.? (?:19|20)\d{2}\b/.test(m) && !/\b(?:January|February|March|April|June|July|August|September|October|November|December) /.test(m) ? "Mon YYYY" : /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) (?:19|20)\d{2}\b/.test(m) ? "Month YYYY" : /\b\d{1,2}\/(?:19|20)\d{2}\b/.test(m) ? "MM/YYYY" : "YYYY");
    const styles = new Set(withYear.map(({ e }) => style(e.meta)));
    const share = entries.length ? withYear.length / entries.length : 0;
    const score = entries.length ? share * 60 + (styles.size <= 1 ? 40 : styles.size === 2 ? 15 : 0) : 0;
    const undated = entries.filter(({ e }) => !/\b(?:19|20)\d{2}\b/.test(e.meta));
    comps.push(component("dates", "Dates", 10, score,
      !entries.length ? "No dated entries found." : undated.length ? `${undated.length} of ${entries.length} entries have no date.` : styles.size > 1 ? `Dates use ${styles.size} different formats (${[...styles].join(", ")}).` : "Every entry is dated, in one consistent format.",
      [...styles].map((s) => `Format: ${s}`),
      [...undated.slice(0, 4).map(({ s, e }) => ({ message: `Add dates to “${e.heading || s.title}”.` })), ...(styles.size > 1 ? [{ message: "Use one date format throughout (e.g. “Jun 2025 – Aug 2025”)." }] : [])]));
  }

  // ── Formatting compatibility ──
  {
    const symbolLines = [...allLines(doc)].filter((x) => /[←-➿⬀-⯿\u{1F000}-\u{1FAFF}-]/u.test(x.line.text));
    const bullets = [...allLines(doc)].filter((x) => x.entry && x.line.text.trim());
    const period = bullets.filter((b) => /\.$/.test(b.line.text.trim())).length;
    const inconsistentPunct = bullets.length >= 4 && period / bullets.length > 0.15 && period / bullets.length < 0.85;
    const lower = bullets.filter((b) => /^[a-z]/.test(b.line.text.trim())).length;
    const longLines = [...allLines(doc)].filter((x) => x.line.text.length > 260).length;
    const score = 100 - Math.min(45, symbolLines.length * 15) - (inconsistentPunct ? 12 : 0) - Math.min(20, lower * 6) - Math.min(15, longLines * 8);
    const issues = [symbolLines.length && `${symbolLines.length} line(s) contain symbols/emoji ATS parsers often drop`, inconsistentPunct && "Bullet punctuation is inconsistent (some end with a period, some don't)", lower && `${lower} bullet(s) start with a lowercase letter`, longLines && `${longLines} very long line(s)`].filter(Boolean) as string[];
    comps.push(component("formatting", "Formatting compatibility", 10, score,
      issues.length ? issues.join("; ") + "." : "Single-column, text-only layout with no tables, images, columns or unusual symbols.",
      ["Layout: single column, real text (no tables, text boxes, images or graphics)", "Fonts: standard"],
      [...symbolLines.slice(0, 3).map((x) => ({ message: `Replace symbols in: “${x.line.text.slice(0, 60)}”`, ref: x.ref })), ...(inconsistentPunct ? [{ message: "Pick one bullet style: end all with a period, or none." }] : [])]));
  }

  // ── Repetition ──
  {
    const reps = findRepeats(doc);
    const openers = reps.filter((r) => r.kind === "opener");
    const words = reps.filter((r) => r.kind === "word");
    const score = 100 - openers.length * 14 - words.length * 8;
    comps.push(component("repetition", "Repeated words", 5, score,
      reps.length ? `${openers.length} repeated opener${openers.length === 1 ? "" : "s"} and ${words.length} overused word${words.length === 1 ? "" : "s"}.` : "No overused openers or words.",
      reps.slice(0, 6).map((r) => `“${r.word}” ×${r.count} (${r.kind === "opener" ? "starts bullets" : "used often"})`),
      reps.slice(0, 4).map((r) => ({ message: `Vary “${r.word}” — it appears ${r.count} times.`, ref: r.refs[0] }))));
  }

  // ── Length ──
  {
    const words = wordCount(text);
    const pages = Math.round((words / 500) * 10) / 10;
    const score = words >= 250 && words <= 700 ? 100 : words >= 150 && words <= 900 ? 72 : 40;
    comps.push(component("length", "Length", 10, score,
      words < 150 ? `Only ${words} words — likely too little to evaluate.` : words > 900 ? `${words} words (~${pages} pages) — likely over one page.` : `${words} words (~${pages} page${pages === 1 ? "" : "s"}).`,
      [`${doc.sections.length} sections`], words > 900 ? [{ message: "Trim older or less relevant bullets to keep it to one page." }] : words < 150 ? [{ message: "Add real detail where you have it — projects, coursework, tools." }] : []));
  }

  // ── Quantification ──
  {
    const bullets = [...allLines(doc)].filter((x) => x.entry && WORK.has(x.section.kind) && x.line.text.trim());
    const withNum = bullets.filter((b) => /\d/.test(b.line.text)).length;
    const share = bullets.length ? withNum / bullets.length : 0;
    comps.push(component("quantification", "Measurable results", 5, Math.min(100, (share / 0.4) * 100),
      bullets.length ? `${withNum} of ${bullets.length} bullets include a number.` : "No experience or project bullets to evaluate.",
      ["Only add numbers you can verify — FRIDAY never invents them."],
      findWeakBullets(doc).filter((f) => f.severity === "tip").slice(0, 3).map((f) => ({ message: `Missing evidence for “${f.text.slice(0, 60)}…” — add a real measurement if you have one.`, ref: f.ref }))));
  }

  // ── Keyword coverage (job description required) ──
  const m = opts.match && opts.match.skills.length ? opts.match : null;
  if (m) {
    const present = m.coverage.present ?? 0;
    const shown = m.coverage.demonstrated ?? 0;
    comps.push(component("keywords", "Keyword coverage", 15, present * 0.7 + shown * 0.3,
      `${present}% of the posting's skills appear on your resume; ${shown}% are both listed and shown in your work.`,
      [...m.skills.filter((s) => s.status === "missing").map((s) => `Missing: ${s.name} (${s.kind})`), ...m.skills.filter((s) => s.status === "weak" || s.status === "unclear").map((s) => `${s.status === "weak" ? "Weak" : "Unclear"}: ${s.name}`)].slice(0, 12),
      m.skills.filter((s) => s.status === "missing" && s.kind === "required").slice(0, 5).map((s) => ({ message: s.message }))));
  }

  const totalWeight = comps.reduce((n, c) => n + c.weight, 0);
  const score = clamp(comps.reduce((n, c) => n + c.score * c.weight, 0) / totalWeight);
  const formatting = comps.find((c) => c.id === "formatting")!;

  return {
    score,
    rating: rate(score),
    components: comps,
    hasJd: Boolean(m),
    summary: [
      { label: "Keyword coverage", value: m ? `${m.coverage.present}%` : "n/a — add a job description" },
      { label: "Formatting compatibility", value: formatting.rating },
      { label: "Experience relevance", value: m ? (m.relevance.label === "n/a" ? "n/a" : `${m.relevance.label} (${m.relevance.bulletsWithMatch}/${m.relevance.bullets} bullets)`) : "n/a — add a job description" },
      { label: "Missing required skills", value: m ? String(m.missingRequired.length) : "n/a — add a job description" },
    ],
    basis: `Weighted average of ${comps.length} components (${comps.map((c) => `${c.label} ${c.weight}`).join(", ")}).${m ? "" : " Keyword coverage is excluded until you add a job description."}`,
  };
}
