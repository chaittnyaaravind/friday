/**
 * The writing-quality layer shared by every piece of text FRIDAY drafts: resume summaries, skill lines, experience and
 * project bullets, cover letters and short application answers.
 *
 * Two halves, used together:
 *   styleFor(kind)            — the rules given to a model, so every prompt asks for the same voice.
 *   lintWriting(text, kind)   — a deterministic check of what came back. It never rewrites anything; it reports.
 *
 * The goal is clear, specific, credible student writing for U.S. campus employers. It is NOT detection evasion: nothing
 * here adds typos, invented anecdotes or deliberate irregularity.
 */

export type WritingKind = "summary" | "skills" | "bullet" | "project" | "cover_letter" | "answer";

export const STYLE_GUIDE = `WRITING STYLE (applies to everything you write)
- Plain, direct, professional U.S. English in a credible student / early-career voice. Confident, never inflated.
- Show, don't claim: name what was actually done and with what, using only the facts given. No empty self-praise.
- Lead with the employer's actual needs (from the posting) and connect them to real evidence from the profile.
- Use the posting's own terms where the facts support them, naturally, once or twice. Never keyword-stuff.
- Strong, accurate verbs (organized, assisted, answered, scheduled, built, maintained). Never upgrade scope: no led, managed,
  spearheaded, architected or oversaw unless the facts say so.
- Vary sentence openings and structure; keep sentences short enough to read in one pass.
- Consistent tense (past for finished work, present for current work), punctuation, capitalization and formatting.
- Banned: "I am writing to express my interest", "I am excited/thrilled to apply", "passionate", "lifelong passion",
  "results-driven", "self-starter", "go-getter", "synergy", "leverage" (as a verb), "dynamic", "hard-working team player",
  "perfect fit", "dream job", "wear many hats", "fast-paced environment", "proven track record", "seasoned", "expert",
  "mastery", "world-class", "cutting-edge".
- Never invent numbers, percentages, dollar amounts, dates, employers, titles, certifications, tools or outcomes. If a stronger
  sentence needs data you do not have, write the honest version without it.`;

const PER_KIND: Record<WritingKind, string> = {
  summary: "SUMMARY: 2 sentences, at most 55 words, specific to this role. No years-of-experience claims. Do not reuse a generic summary.",
  skills: "SKILLS: only skills present in the facts, grouped plainly (e.g. 'Office: ...'). No proficiency adjectives (expert, advanced) unless stated.",
  bullet: "BULLET: one idea, under 30 words, starts with a verb, no first person.",
  project: "PROJECT: what was built, with what, and what it does, from the facts only. One or two bullets of under 30 words.",
  cover_letter: "COVER LETTER: under 280 words, 3-4 short paragraphs. Open with the specific role and one real reason you fit, then evidence, then availability only if the facts state it. Close plainly. Sign with the student's name if given.",
  answer: "APPLICATION ANSWER: answer the question asked in 2-5 sentences (under 120 words) unless a length is stated. First person is fine. Use only the facts given; if they do not answer the question, say so instead of inventing.",
};

/** The full instruction block for one kind of text. */
export const styleFor = (kind: WritingKind) => `${STYLE_GUIDE}\n${PER_KIND[kind]}`;

export type LintSeverity = "error" | "warn";
export type LintIssue = { code: string; severity: LintSeverity; message: string; excerpt?: string };

const CLICHES: [RegExp, string][] = [
  [/\bi am (?:writing|reaching out) to (?:express|apply)\b/i, "generic opening"],
  [/\bi(?:'m| am) (?:so |very |truly )?(?:excited|thrilled|delighted|eager) to\b/i, "stock enthusiasm"],
  [/\bpassion(?:ate)?\b|\blifelong\b/i, "claimed passion"],
  [/\bresults[- ]driven\b|\bself[- ]starter\b|\bgo[- ]getter\b|\bteam player\b|\bhard[- ]working\b/i, "empty self-description"],
  [/\bsynerg(?:y|ies|ize)\b|\bleverag(?:e|ed|ing)\b|\bdynamic\b|\bwear many hats\b|\bfast[- ]paced environment\b/i, "corporate filler"],
  [/\bproven track record\b|\bseasoned\b|\bworld[- ]class\b|\bcutting[- ]edge\b|\bperfect fit\b|\bdream job\b/i, "inflated claim"],
  [/\b(?:expert|mastery|master of|guru|ninja|rockstar)\b/i, "claimed mastery"],
  [/\bin today's (?:fast|ever)[- ]?\w*\b|\bas an ai\b|\bi hope this (?:letter|message) finds you well\b/i, "AI-style filler"],
];
const SCOPE = /\b(?:spearhead(?:ed|ing)?|architect(?:ed|ing)|led|managed|oversaw|directed|headed)\b/i;
const FIRST_PERSON = /\b(?:I|me|my|mine|we|our)\b/;
const STOP = new Set(["students", "student", "campus", "which", "their", "there", "would", "about", "these", "those", "other", "where", "while", "through"]);
const LIMIT: Partial<Record<WritingKind, number>> = { summary: 55, bullet: 30, project: 60, cover_letter: 300, answer: 160 };

const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z"“])/).map((s) => s.trim()).filter(Boolean);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);

/**
 * Deterministic checks of drafted text. `evidence` (the facts the text may use) enables the scope check: "led" is only
 * an issue when the facts never say it. Errors block saving a draft; warnings are shown to the student.
 */
export function lintWriting(text: string, kind: WritingKind, evidence = ""): LintIssue[] {
  const out: LintIssue[] = [];
  const t = text.trim();
  if (!t) return [{ code: "empty", severity: "error", message: "The draft is empty." }];

  for (const [re, what] of CLICHES) {
    const m = re.exec(t);
    if (m) out.push({ code: "cliche", severity: "warn", message: `Remove the ${what} (“${m[0]}”) and show the evidence instead.`, excerpt: m[0] });
  }

  const scope = SCOPE.exec(t);
  if (scope && !new RegExp(`\\b${scope[0]}\\b`, "i").test(evidence)) {
    out.push({ code: "scope", severity: "error", message: `“${scope[0]}” claims a scope of responsibility your profile does not state.`, excerpt: scope[0] });
  }

  const n = words(t).length;
  const limit = LIMIT[kind];
  if (limit && n > limit) out.push({ code: "length", severity: "warn", message: `${n} words; aim for at most ${limit}.` });

  const sents = sentences(t);
  const long = sents.find((s) => words(s).length > 38);
  if (long) out.push({ code: "long_sentence", severity: "warn", message: "A sentence runs over 38 words; split it.", excerpt: long.slice(0, 80) });

  // Repetitive openings: the same first word on three or more sentences/bullets ("I" is allowed more often in prose).
  const lines = kind === "bullet" || kind === "project" || kind === "skills";
  const units = lines ? t.split(/\n+/).map((l) => l.replace(/^[•\-*]\s*/, "")).filter(Boolean) : sents;
  const firsts = new Map<string, number>();
  for (const u of units) {
    const w = u.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z']/g, "");
    if (w) firsts.set(w, (firsts.get(w) ?? 0) + 1);
  }
  const rep = [...firsts.entries()].find(([w, c]) => (w === "i" ? c >= 4 && c / units.length > 0.6 : c >= 3));
  if (rep) out.push({ code: "repetitive", severity: "warn", message: `${rep[1]} ${lines ? "lines" : "sentences"} start with “${rep[0]}”; vary the openings.` });

  // Keyword stuffing: one content word (5+ letters) more than 4 times in a short text.
  const counts = new Map<string, number>();
  for (const w of t.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stuffed = [...counts.entries()].find(([w, c]) => c > 4 && n < 400 && !STOP.has(w));
  if (stuffed) out.push({ code: "stuffing", severity: "warn", message: `“${stuffed[0]}” appears ${stuffed[1]} times; it reads as keyword stuffing.` });

  if ((kind === "bullet" || kind === "project" || kind === "summary") && FIRST_PERSON.test(t)) out.push({ code: "first_person", severity: "warn", message: "Resume text should not use first person." });
  if (t.includes("!")) out.push({ code: "exclamation", severity: "warn", message: "Drop exclamation marks; they read as forced enthusiasm." });
  const doubled = /\b(\w+)\s+\1\b/i.exec(t);
  if (doubled && !/^\d+$/.test(doubled[1])) out.push({ code: "doubled_word", severity: "warn", message: `“${doubled[0]}”: a word is repeated.`, excerpt: doubled[0] });
  if (/\s[,.;:!?]/.test(t)) out.push({ code: "punctuation", severity: "warn", message: "There is a space before a punctuation mark." });
  return out;
}

/** True when the lint result has an issue that must stop the draft from being saved as-is. */
export const hasBlockingIssue = (issues: LintIssue[]) => issues.some((i) => i.severity === "error");
