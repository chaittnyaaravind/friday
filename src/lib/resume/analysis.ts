/**
 * Full-resume analysis — deterministic recommendations, nothing rewritten. Each item says WHAT is
 * off, WHERE, and what to do about it; the student decides. A model may add a narrative overview on
 * top (see lib/ai/resume.ts), but it is never the source of these findings: dates, headings, lengths,
 * repetition and formatting all come from code.
 */
import { extractSkills, resolveSkill, skillBySlug } from "@/lib/domain/skills";
import { analyzeAts } from "./ats";
import { allLines, findRepeats, findWeakBullets, type LineRef } from "./edits";
import { skillMentions } from "./parse";
import type { ResumeDoc } from "./types";

export type AnalysisCategory = "weak" | "repetitive" | "vague" | "missing_context" | "formatting" | "too_long" | "too_short" | "unclear_technical" | "missing_evidence";

export const CATEGORY_LABEL: Record<AnalysisCategory, string> = {
  weak: "Weak bullets",
  repetitive: "Repetitive wording",
  vague: "Vague statements",
  missing_context: "Missing context",
  formatting: "Inconsistent formatting",
  too_long: "Overly long bullets",
  too_short: "Overly short bullets",
  unclear_technical: "Unclear technical descriptions",
  missing_evidence: "Missing relevant evidence",
};

export type AnalysisItem = {
  category: AnalysisCategory;
  title: string;
  detail: string;
  /** What the student could do — a recommendation, never an automatic change. */
  suggestion: string;
  where?: string;
  ref?: LineRef | null;
};

const WORK = new Set(["experience", "projects", "activities"]);
const VAGUE = /\b(?:various|several|numerous|multiple|many|some|stuff|things?|etc\.?|a lot of|a variety of|different|miscellaneous|helped(?: with| to)?|assisted(?: with)?|involved in|worked on|responsible for|participated in)\b/i;
const GENERIC_TECH = /\b(?:back-?end|front-?end|full-?stack|apis?|databases?|systems?|platforms?|cloud|pipelines?|infrastructure|algorithms?|frameworks?|architecture|models?|services?|applications?|apps?|websites?)\b/i;

export function analyzeDocument(doc: ResumeDoc): { items: AnalysisItem[]; counts: Record<AnalysisCategory, number> } {
  const items: AnalysisItem[] = [];
  const add = (i: AnalysisItem) => items.push(i);

  // Weak / short / long / missing measurable result (from the same checks the editor's scan uses).
  for (const f of findWeakBullets(doc)) {
    if (f.severity === "tip") {
      add({ category: "missing_evidence", title: "No measurable result", detail: f.text, where: f.where, ref: f.ref, suggestion: "If you have a real number (users, time saved, size, speed), use Quantify — FRIDAY will ask for it and never invent one." });
      continue;
    }
    for (const issue of f.issues) {
      const category: AnalysisCategory = /^Very short/.test(issue) ? "too_short" : /^Long \(/.test(issue) ? "too_long" : "weak";
      add({ category, title: issue.replace(/ — .*$/, ""), detail: f.text, where: f.where, ref: f.ref, suggestion: category === "too_long" ? "Split it or trim it to one idea (try Shorten)." : category === "too_short" ? "Say what you built or did, and with what (try Make clearer)." : "Lead with what you actually did (try Improve)." });
    }
  }

  // Repetition.
  for (const r of findRepeats(doc)) {
    add({ category: "repetitive", title: r.kind === "opener" ? `${r.count} bullets start with “${r.word}”` : `“${r.word}” appears ${r.count} times`, detail: "Repeated wording makes bullets blur together.", ref: r.refs[0], suggestion: "Vary the verb or wording (try Generate alternatives on one of them)." });
  }

  // Vague statements, unclear technical descriptions, missing context.
  for (const { ref, line, section, entry } of allLines(doc)) {
    if (!entry || !WORK.has(section.kind)) continue;
    const t = line.text.trim();
    if (!t) continue;
    const where = `${section.title} · ${entry.heading || "Entry"}`;
    const vague = t.match(VAGUE);
    if (vague) add({ category: "vague", title: `Vague wording: “${vague[0]}”`, detail: t, where, ref, suggestion: "Say specifically what you did (try Make clearer)." });
    const known = skillMentions([t, entry.subheading].join(" ")).length + skillMentions(entry.bullets.map((b) => b.text).join(" ")).length;
    if (GENERIC_TECH.test(t) && known === 0) add({ category: "unclear_technical", title: "Technical, but no specifics", detail: t, where, ref, suggestion: "Name the language, framework or tool you used — only if it's true." });
  }

  // Entries with no description or no dates.
  for (const s of doc.sections) {
    if (!WORK.has(s.kind)) continue;
    for (const e of s.entries) {
      const where = `${s.title} · ${e.heading || "Entry"}`;
      if (!e.bullets.some((b) => b.text.trim())) add({ category: "missing_context", title: "Entry has no description", detail: e.heading, where, suggestion: "Add one or two bullets on what you did." });
      if (s.kind !== "projects" && !/\b(?:19|20)\d{2}\b/.test(e.meta)) add({ category: "missing_context", title: "No dates", detail: e.heading, where, suggestion: "Add when you did this — recruiters and ATS parsers look for dates." });
      if (s.kind === "projects" && e.bullets.length && !skillMentions([e.heading, e.subheading, ...e.bullets.map((b) => b.text)].join(" ")).length) {
        add({ category: "missing_context", title: "Project doesn't say what it was built with", detail: e.heading, where, suggestion: "List the technologies you used — only real ones." });
      }
    }
  }

  // Formatting problems, straight from the deterministic ATS checks.
  const report = analyzeAts(doc);
  for (const c of report.components.filter((c) => ["formatting", "dates", "sections"].includes(c.id))) {
    for (const f of c.fixes) add({ category: "formatting", title: c.label, detail: f.message, ref: f.ref ?? null, suggestion: f.message });
  }

  // Skills listed but never shown in the work: weak evidence.
  const shown = new Set<string>();
  for (const { line, section, entry } of allLines(doc)) if (entry && WORK.has(section.kind)) extractSkills(line.text).forEach((s) => shown.add(s));
  for (const s of doc.sections) if (s.kind === "projects") for (const e of s.entries) extractSkills(e.subheading).forEach((k) => shown.add(k));
  for (const s of doc.sections.filter((x) => x.kind === "skills")) {
    for (const l of s.lines) {
      for (const tok of l.text.replace(/^[^:]{1,40}:\s*/, "").split(/\s*[,;]\s*/)) {
        const slug = resolveSkill(tok);
        if (slug && !shown.has(slug) && !items.some((i) => i.category === "missing_evidence" && i.title.includes(`“${skillBySlug(slug)?.name}”`))) {
          add({ category: "missing_evidence", title: `“${skillBySlug(slug)?.name ?? tok}” is listed but no bullet shows it`, detail: "Skills with no example read as familiarity, not experience.", ref: { sectionId: s.id, entryId: null, lineId: l.id }, suggestion: "Add a bullet that uses it — only if you really did." });
        }
      }
    }
  }
  if (!doc.sections.some((s) => WORK.has(s.kind) && s.entries.length)) add({ category: "missing_evidence", title: "No experience, projects or activities", detail: "There's nothing showing what you've built or done.", suggestion: "Add a project or activity — coursework projects count." });

  const counts = Object.fromEntries((Object.keys(CATEGORY_LABEL) as AnalysisCategory[]).map((c) => [c, items.filter((i) => i.category === c).length])) as Record<AnalysisCategory, number>;
  return { items, counts };
}
