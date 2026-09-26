/**
 * Suggestion lifecycle for the AI editor — pure and deterministic, shared by the browser
 * and the server:  screen (guard) → present → accept / reject / edit → apply to the document.
 * A suggestion never touches the document by itself; `applySuggestion` is the only writer and
 * it returns a NEW document (the caller keeps the old one for undo and version history).
 */
import { claimPhrase, newFactsIn, norm, riskOf, skillsLineFacts, verdictOf, wordCount, type NewFact, type Risk } from "./guard";
import { resolveSkill } from "@/lib/domain/skills";
import { normalizeSentence } from "./generate";
import { randomId } from "./ids";
import { skillMentions } from "./parse";
import type { DocEntry, DocLine, DocSection, ResumeDoc } from "./types";

export type EditOp = "improve" | "shorten" | "clearer" | "technical" | "impactful" | "grammar" | "ats" | "alternatives" | "quantify" | "summary" | "skills" | "assistant";

export const OP_LABEL: Record<Exclude<EditOp, "assistant">, string> = {
  improve: "Improve",
  shorten: "Shorten",
  clearer: "Make clearer",
  technical: "Make more technical",
  impactful: "Make more impactful",
  grammar: "Fix grammar",
  ats: "ATS optimize",
  alternatives: "Generate alternatives",
  quantify: "Quantify",
  summary: "Professional summary",
  skills: "Skills optimization",
};

export type LineRef = { sectionId: string; entryId: string | null; lineId: string };
export type Target = ({ kind: "line" } & LineRef) | { kind: "summary" } | { kind: "skills"; sectionId: string };

export type Suggestion = {
  id: string;
  text: string;
  reason: string;
  /** Everything this text asserts that its evidence doesn't (computed here, never trusted from the model). */
  newFacts: NewFact[];
  requiresUserConfirmation: boolean;
  /** Same as requiresUserConfirmation, under the structured-response name. */
  requiresConfirmation: boolean;
  /** The new claims in plain words (e.g. "50,000 users") — empty when the suggestion only rewords. */
  newClaims: string[];
  riskLevel: Risk;
  /** Existing resume text that supports this suggestion (verbatim), plus anything the user supplied. */
  evidence: string[];
  /** Server signature (set by the AI route on guard-approved suggestions). An accepted AI line must carry it to be saved. */
  sig?: string;
  /** For skills suggestions: one signature per row (each row becomes its own line). */
  rowSigs?: string[];
};

/** A suggestion that was blocked because it asserts something the resume doesn't support. Shown flagged, never applicable. */
export type BlockedSuggestion = { text: string; reasons: string[]; newClaims: string[]; riskLevel: Risk; evidence: string[] };

export type Proposal = {
  id: string;
  op: EditOp;
  target: Target;
  original: string;
  /** The text the suggestion was allowed to draw on — recorded on the line if accepted. */
  basis: string;
  suggestions: Suggestion[];
  /** What real information would make this stronger (never invented by us). */
  missingEvidence: string[];
  /** Suggestions dropped because they introduced unverifiable facts. */
  rejected: BlockedSuggestion[];
  /** For "Quantify" without a user-provided fact: what real measurements the student could supply. Never a number. */
  questions?: string[];
  via: "ai" | "local";
  note?: string;
};

export type RawSuggestion = { text: string; reason?: string; newFactsIntroduced?: string[]; requiresUserConfirmation?: boolean; sourceEvidence?: string[] };

// ───────────────────────── document navigation ─────────────────────────

export type Located = { section: DocSection; entry: DocEntry | null; line: DocLine; list: DocLine[]; index: number };

export function findLine(doc: ResumeDoc, ref: LineRef): Located | null {
  const section = doc.sections.find((s) => s.id === ref.sectionId);
  if (!section) return null;
  const entry = ref.entryId ? section.entries.find((e) => e.id === ref.entryId) ?? null : null;
  if (ref.entryId && !entry) return null;
  const list = entry ? entry.bullets : section.lines;
  const index = list.findIndex((l) => l.id === ref.lineId);
  return index < 0 ? null : { section, entry, line: list[index], list, index };
}

export type LineContext = { section: string; sectionKind: DocSection["kind"]; heading: string; subheading: string; meta: string; siblings: string[]; text: string };

/** The minimum surrounding context an edit needs (cost control: never the whole resume). */
export function lineContext(doc: ResumeDoc, ref: LineRef): LineContext | null {
  const at = findLine(doc, ref);
  if (!at) return null;
  return {
    section: at.section.title,
    sectionKind: at.section.kind,
    heading: at.entry?.heading ?? "",
    subheading: at.entry?.subheading ?? "",
    meta: at.entry?.meta ?? "",
    siblings: at.list.filter((l) => l.id !== ref.lineId).map((l) => l.text).slice(0, 8),
    text: at.line.text,
  };
}

/** Text a rewrite of this line may draw on: the line, its entry header, and the entry's other lines. */
export const basisOf = (c: LineContext) => [c.text, c.heading, c.subheading, c.meta, ...c.siblings].filter(Boolean).join("\n");

/** A stored profile record as readable lines (title, organization, dates, each bullet…), for use as evidence text. */
export function evidenceLines(data: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") { if (v.trim()) out.push(v.trim()); }
    else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(data);
  return out;
}

/** Every bullet/line in reading order. */
export function* allLines(doc: ResumeDoc): Generator<{ ref: LineRef; line: DocLine; section: DocSection; entry: DocEntry | null }> {
  for (const section of doc.sections) {
    for (const entry of section.entries) for (const line of entry.bullets) yield { ref: { sectionId: section.id, entryId: entry.id, lineId: line.id }, line, section, entry };
    for (const line of section.lines) yield { ref: { sectionId: section.id, entryId: null, lineId: line.id }, line, section, entry: null };
  }
}

/** Compact digest of the facts in a document — the only source a generated summary may use. */
export function factDigest(doc: ResumeDoc, maxChars = 3200): string {
  const lines: string[] = [];
  if (doc.header.name) lines.push(`Name: ${doc.header.name}`);
  for (const s of doc.sections) {
    if (s.kind === "summary") continue;
    lines.push(`${s.title}:`);
    for (const e of s.entries) {
      lines.push(`- ${[e.heading, e.subheading, e.meta].filter(Boolean).join(" | ")}`);
      for (const b of e.bullets) lines.push(`  • ${b.text}`);
    }
    for (const l of s.lines) lines.push(`- ${l.text}`);
  }
  let out = lines.join("\n");
  // Over budget: drop bullet detail before dropping headings.
  if (out.length > maxChars) out = lines.filter((l) => !l.startsWith("  •")).join("\n").slice(0, maxChars);
  return out;
}

// ───────────────────────── screening (the guard applied to model output) ─────────────────────────

export type ScreenOptions = {
  original: string; evidence: string; kind?: "bullet" | "skills" | "summary"; max?: number;
  /** A fact the student typed in themselves (e.g. "Used by 5,000 students"). It counts as evidence — the student is the source. */
  userFacts?: string;
};

const STOPW = new Set("that this with from have been were their there which using used into over than then them they your about after also and are but can for its not the was who will has had how may our out per via".split(" "));
const contentWords = (t: string) => (t.toLowerCase().match(/[a-z][a-z0-9+#.]{3,}/g) ?? []).filter((w) => !STOPW.has(w));

/**
 * The existing resume text a suggestion rests on: the original line first, then any line of the
 * evidence that shares real words with it, plus anything the student supplied. Model-cited evidence
 * is kept only if it appears verbatim in the evidence text — the model can't cite what isn't there.
 */
export function supportingEvidence(suggestion: string, original: string, evidence: string, cited: string[] = [], userFacts?: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { const t = s.trim(); if (t && !out.some((x) => norm(x) === norm(t))) out.push(t); };
  add(original);
  const hay = norm(evidence);
  for (const c of cited) if (norm(c).length > 3 && hay.includes(norm(c))) add(c);
  const words = new Set(contentWords(suggestion));
  for (const l of evidence.split("\n")) if (contentWords(l).some((w) => words.has(w))) add(l);
  if (userFacts?.trim()) add(`You provided: ${userFacts.trim()}`);
  return out.slice(0, 5);
}

/** Split raw model suggestions into presentable ones and rejected ones. Malformed items are dropped. */
export function screenSuggestions(raw: RawSuggestion[], o: ScreenOptions): { suggestions: Suggestion[]; rejected: Proposal["rejected"] } {
  const suggestions: Suggestion[] = [];
  const rejected: Proposal["rejected"] = [];
  const seen = new Set([norm(o.original)]);
  const maxWords = o.kind === "summary" ? 75 : o.kind === "skills" ? 200 : 45;
  // What the suggestion may draw on: the resume text, plus a fact the student supplied.
  const evidenceText = o.userFacts?.trim() ? `${o.evidence}\n${o.userFacts.trim()}` : o.evidence;
  for (const r of raw.slice(0, o.max ?? 5)) {
    // Skills suggestions are one group per line, so newlines must survive; everything else is a single line.
    const text = typeof r?.text !== "string" ? "" : o.kind === "skills" ? r.text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") : r.text.replace(/\s+/g, " ").trim();
    if (!text || seen.has(norm(text))) continue;
    seen.add(norm(text));
    if (wordCount(text) > maxWords) {
      rejected.push({ text, reasons: [`Too long (over ${maxWords} words).`], newClaims: [], riskLevel: "low", evidence: [] });
      continue;
    }
    const facts = o.kind === "skills" ? skillsLineFacts(evidenceText, text) : newFactsIn(text, evidenceText);
    for (const claim of r.newFactsIntroduced ?? []) {
      const c = String(claim).trim();
      if (!c || facts.some((f) => f.claim.toLowerCase() === c.toLowerCase())) continue;
      facts.push({ claim: c, kind: "name", severity: /\d/.test(c) ? "reject" : "confirm", reason: "The AI reported this as new information." });
    }
    const verdict = verdictOf(facts);
    const cited = supportingEvidence(text, o.original, o.evidence, r.sourceEvidence, o.userFacts);
    const claims = facts.map((f) => claimPhrase(text, f));
    if (verdict === "reject") {
      rejected.push({ text, reasons: facts.filter((f) => f.severity === "reject").map((f) => f.reason), newClaims: claims, riskLevel: "high", evidence: cited });
      continue;
    }
    suggestions.push({
      id: randomId(), text, reason: (r.reason ?? "").trim().slice(0, 240), newFacts: facts, requiresUserConfirmation: verdict === "confirm", requiresConfirmation: verdict === "confirm",
      newClaims: claims, riskLevel: riskOf(facts), evidence: cited,
    });
  }
  // Safest first: an option that adds nothing is listed above one that needs confirmation (stable within a level).
  const rank: Record<Risk, number> = { none: 0, low: 1, medium: 2, high: 3 };
  suggestions.sort((x, y) => rank[x.riskLevel] - rank[y.riskLevel]);
  return { suggestions, rejected };
}

/** A suggestion may be applied only when it adds no fact — or the user has explicitly attested to each one. */
export const canApply = (s: Suggestion, attested: boolean) => !s.newFacts.some((f) => f.severity === "reject") && (!s.requiresUserConfirmation || attested);

// ───────────────────────── applying ─────────────────────────

export type ApplyOptions = { attested?: boolean; userEdited?: boolean; op: EditOp; basis: string; now?: string; sig?: string; rowSigs?: string[] };

/**
 * Returns a new document with `text` written at `target`. AI text is stored with origin "ai" and
 * its trace (validated on save and export); text the user attested to — or edited — becomes "user".
 */
export function applySuggestion(doc: ResumeDoc, target: Target, text: string, o: ApplyOptions): ResumeDoc {
  const next = structuredClone(doc);
  const asUser = Boolean(o.attested || o.userEdited);
  const make = (prev?: DocLine, sig: string | undefined = o.sig): DocLine => ({
    id: prev?.id ?? randomId(),
    text,
    origin: asUser ? "user" : "ai",
    sourceItemId: asUser ? null : prev?.sourceItemId ?? null,
    ...(asUser ? {} : { ai: { basis: o.basis.slice(0, 6000), op: o.op, at: o.now ?? new Date().toISOString(), ...(sig ? { sig } : {}) } }),
  });

  if (target.kind === "summary") {
    let s = next.sections.find((x) => x.kind === "summary");
    if (!s) {
      s = { id: randomId(), kind: "summary", title: "Summary", entries: [], lines: [] };
      next.sections.unshift(s);
    }
    s.lines = [make(s.lines[0])];
    return next;
  }
  if (target.kind === "skills") {
    const s = next.sections.find((x) => x.id === target.sectionId && x.kind === "skills");
    if (!s) throw new Error("That section no longer exists.");
    const rows = text.split("\n").map((t) => t.trim()).filter(Boolean);
    s.lines = rows.map((row, i) => ({ ...make(s.lines[i], o.rowSigs?.[i]), text: row }));
    return next;
  }
  const at = findLine(next, target);
  if (!at) throw new Error("That line no longer exists.");
  at.list[at.index] = make(at.line);
  return next;
}

/** The text a proposal was generated from, as it is in `doc` right now — used to refuse a stale proposal. */
export function currentText(doc: ResumeDoc, target: Target): string | null {
  if (target.kind === "summary") return doc.sections.find((s) => s.kind === "summary")?.lines[0]?.text ?? "";
  if (target.kind === "skills") return doc.sections.some((s) => s.id === target.sectionId && s.kind === "skills") ? skillsText(doc, target.sectionId) : null;
  return findLine(doc, target)?.line.text ?? null;
}

/** "Experience · Software Intern", "Summary", "Skills" — where an edit lands, for labels and history. */
export function describeTarget(doc: ResumeDoc, target: Target): string {
  if (target.kind === "summary") return "Summary";
  if (target.kind === "skills") return "Skills";
  const at = findLine(doc, target);
  return at ? [at.section.title, at.entry?.heading].filter(Boolean).join(" · ") : "Resume";
}

/** The current text of a skills section, one line per group — the basis for regrouping/reordering it. */
export const skillsText = (doc: ResumeDoc, sectionId: string) => doc.sections.find((s) => s.id === sectionId)?.lines.map((l) => l.text).join("\n") ?? "";

/** Deterministic: move the skills a job asks for to the front of each group. Never adds or drops one. */
export function localSkillsProposal(doc: ResumeDoc, sectionId: string, keywords: string[]): Proposal {
  const original = skillsText(doc, sectionId);
  const wanted = new Set(keywords.map((k) => resolveSkill(k) ?? k.toLowerCase()));
  const isWanted = (t: string) => wanted.has(resolveSkill(t) ?? t.toLowerCase());
  const text = original.split("\n").map((row) => {
    const m = row.match(/^([^:]{1,40}:\s*)(.*)$/);
    const toks = (m ? m[2] : row).split(/\s*,\s*/).filter(Boolean);
    const sorted = [...toks.filter(isWanted), ...toks.filter((t) => !isWanted(t))];
    return (m ? m[1] : "") + sorted.join(", ");
  }).join("\n");
  const { suggestions, rejected } = screenSuggestions(text !== original ? [{ text, reason: "Skills the job asks for now come first in each group. Nothing added or removed." }] : [], { original, evidence: original, kind: "skills" });
  return {
    id: randomId(), op: "skills", target: { kind: "skills", sectionId }, original, basis: original, suggestions, rejected, missingEvidence: [], via: "local",
    note: suggestions.length ? undefined : keywords.length ? "Your skills already lead with what this job asks for." : "Add a job description to order your skills by relevance.",
  };
}

// ───────────────────────── local (no-AI) suggestions ─────────────────────────

const verbForm = (m: string) => (/ed$/i.test(m) ? "used" : /ing$/i.test(m) ? "using" : "use");
const SWAPS: [RegExp, string | ((m: string) => string)][] = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\butili[sz](?:e|ed|ing)\b/gi, verbForm],
  [/\bleverag(?:e|ed|ing)\b/gi, verbForm],
  [/\b(?:very|really|basically|actually|quite|extremely)\s+/gi, ""],
  [/\ba variety of\s+/gi, ""],
];

/** Deterministic grammar/consistency cleanup: whitespace, capitalization, doubled words, "i" → "I". Adds no words. */
export function localGrammar(text: string): string {
  const t = text.replace(/\b(\w+)(\s+\1\b)+/gi, "$1").replace(/\bi\b/g, "I").replace(/([,;:])(?=[A-Za-z])/g, "$1 ");
  return normalizeSentence(t);
}

/** Deterministic tightening: filler phrases and inflated verbs only. Never removes technologies or numbers. */
export function localShorten(text: string): string {
  let t = text;
  for (const [re, to] of SWAPS) t = t.replace(re, to as string);
  return normalizeSentence(t.replace(/\s{2,}/g, " "));
}

export function localProposal(op: "grammar" | "shorten", target: Target, original: string, basis: string): Proposal {
  const fixed = op === "grammar" ? localGrammar(original) : localShorten(original);
  const changed = fixed !== original.trim();
  const { suggestions, rejected } = screenSuggestions(changed ? [{ text: fixed, reason: op === "grammar" ? "Spacing, capitalization and repeated-word cleanup — no wording added." : "Removed filler words." }] : [], { original, evidence: basis });
  return {
    id: randomId(), op, target, original, basis, suggestions, rejected, missingEvidence: [], via: "local",
    note: suggestions.length ? undefined : op === "grammar" ? "No grammar or spacing problems found." : "Nothing to trim without changing what it says.",
  };
}

/** What real measurements could strengthen this bullet. Deterministic, and never contains a number. */
export function quantifyQuestions(text: string): string[] {
  const t = text.toLowerCase();
  const q: string[] = [];
  if (/\b(?:web|app|application|website|site|platform|tool|dashboard|portal|bot)\b/.test(t)) q.push("How many people use it (students, teammates, customers)?");
  if (/\b(?:script|automat\w*|pipeline|import\w*|export\w*|batch|job|scheduler|cron)\b/.test(t)) q.push("How much time or manual work did it save, or how often does it run?");
  if (/\b(?:api|apis|service|services|backend|endpoint\w*|server)\b/.test(t)) q.push("How many requests, endpoints or records does it handle, or how fast is it?");
  if (/\b(?:sql|quer\w*|database|report\w*|data)\b/.test(t)) q.push("How many records, tables or reports — or how much faster did it get?");
  if (/\b(?:test\w*|qa|coverage|bug|bugs|fix\w*)\b/.test(t)) q.push("How many tests or bugs, or what changed in error rates?");
  if (/\b(?:team|led|organi[sz]\w*|club|event|mentor\w*|tutor\w*)\b/.test(t)) q.push("How many people, attendees or members were involved?");
  if (!q.length) q.push("Who or what did this affect, and by how much (users, time, size, speed)?");
  q.push("Only give a number you can stand behind — FRIDAY will never make one up.");
  return q.slice(0, 4);
}


/** The "Quantify" first step: no number, no model — ask the student for a real measurement instead of inventing one. */
export function quantifyProposal(target: Target, original: string, basis: string): Proposal {
  return { id: randomId(), op: "quantify", target, original, basis, suggestions: [], rejected: [], missingEvidence: [], questions: quantifyQuestions(original), via: "local", note: "Tell FRIDAY a real number and it will work it into the bullet." };
}

// ───────────────────────── analysis (deterministic) ─────────────────────────

export type Finding = { ref: LineRef; text: string; where: string; issues: string[]; severity: "weak" | "tip" };

const WEAK_START = /^(?:worked\s+(?:on|with)|helped(?:\s+(?:with|to|out))?|assisted(?:\s+with|\s+in)?|responsible\s+for|involved\s+in|participated\s+in|tasked\s+with|duties\s+(?:included|include)|handled|did|made)\b/i;
const FIRST_PERSON = /\b(?:I|my|me|we|our)\b/;
const PASSIVE = /\b(?:was|were|is|are|been)\s+\w+ed\b/i;
const NON_VERB_START = /^(?:a|an|the|this|that|these|my|our|various|several)\b|^\w+ing\b/i;
const WORK_SECTIONS = ["experience", "projects", "activities"];

export function findWeakBullets(doc: ResumeDoc): Finding[] {
  const out: Finding[] = [];
  for (const { ref, line, section, entry } of allLines(doc)) {
    if (!entry || !WORK_SECTIONS.includes(section.kind)) continue;
    const t = line.text.trim();
    if (!t) continue;
    const issues: string[] = [];
    const n = wordCount(t);
    if (WEAK_START.test(t)) issues.push("Starts with a weak phrase — say what you actually did.");
    else if (NON_VERB_START.test(t)) issues.push("Doesn't start with an action verb.");
    if (n < 6) issues.push("Very short — it doesn't show what you did or how.");
    if (n > 32) issues.push(`Long (${n} words) — split it or trim it to one idea.`);
    if (FIRST_PERSON.test(t)) issues.push("Uses first person (I / my / we) — drop it.");
    if (PASSIVE.test(t)) issues.push("Passive voice — lead with what you did.");
    const where = `${section.title} · ${entry.heading || "Entry"}`;
    if (issues.length) out.push({ ref, text: t, where, issues, severity: "weak" });
    else if (!/\d/.test(t) && n >= 6) out.push({ ref, text: t, where, issues: ["Missing evidence: no measurable result. If you have real data (size, time, users, speed), add it — otherwise leave it as is."], severity: "tip" });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "weak" ? -1 : 1));
}

export type Repeat = { word: string; count: number; kind: "opener" | "word"; refs: LineRef[] };

const STOP = new Set("about after also and are been being both build built but can could each for from had has have into its more most not out over that the their them then there these they this those through using used use was were which while with within would your our you a an as at be by do in is it of on or so to up we".split(" "));

// Verbs like "built" are fine as words but a bullet opener repeated 3+ times is worth flagging.
const OPENER_SKIP = new Set(["the", "a", "an", "and", "of", "to", "in", "for", "with", "on", "at"]);

export function findRepeats(doc: ResumeDoc): Repeat[] {
  const openers = new Map<string, LineRef[]>();
  const words = new Map<string, { n: number; refs: LineRef[] }>();
  for (const { ref, line, section, entry } of allLines(doc)) {
    if (!entry || !WORK_SECTIONS.includes(section.kind)) continue;
    const toks = line.text.toLowerCase().match(/[a-z][a-z+#.-]*/g) ?? [];
    if (toks[0]) openers.set(toks[0], [...(openers.get(toks[0]) ?? []), ref]);
    const techs = new Set(skillMentions(line.text).map((s) => s.toLowerCase()));
    for (const w of new Set(toks)) {
      if (w.length < 5 || STOP.has(w) || techs.has(w)) continue;
      const cur = words.get(w) ?? { n: 0, refs: [] };
      cur.n++;
      cur.refs.push(ref);
      words.set(w, cur);
    }
  }
  const out: Repeat[] = [];
  for (const [word, refs] of openers) if (refs.length >= 3 && !OPENER_SKIP.has(word)) out.push({ word, count: refs.length, kind: "opener", refs });
  for (const [word, v] of words) if (v.n >= 4) out.push({ word, count: v.n, kind: "word", refs: v.refs });
  return out.sort((a, b) => b.count - a.count).slice(0, 12);
}
