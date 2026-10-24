/**
 * AI resume operations. The only place resume text reaches a model, and only through the
 * provider-agnostic client (./client) — the browser never talks to Groq/Gemini.
 *
 * Division of labour:
 *   deterministic (lib/resume/*)  parsing, validation, dates, ATS checks, keyword counting,
 *                                 weak-bullet / repetition detection, fact checking
 *   model (here)                  rewriting, summarizing, semantic matching, explanations
 *
 * Every model answer is untrusted: it is parsed against a schema, then run through the fact
 * guard (`screenSuggestions`), and anything that adds a fact is discarded or flagged before
 * the UI ever sees it. Cost control: bullet edits send only the bullet, its entry, and a few
 * keywords; only the summary/assistant/analysis calls send more; results are cached.
 */
import "server-only";
import { z } from "zod";
import { analyzeAts, type AtsFix, type AtsReport } from "@/lib/resume/ats";
import {
  allLines, basisOf, factDigest, findRepeats, findWeakBullets, localProposal, localSkillsProposal, quantifyProposal, screenSuggestions, skillsText,
  type EditOp, type Finding, type LineContext, type LineRef, type Proposal, type Repeat, type Target,
} from "@/lib/resume/edits";
import { docToText } from "@/lib/resume/generate";
import { hasTerm, numbersIn } from "@/lib/resume/guard";
import { randomId } from "@/lib/resume/ids";
import { analyzeDocument, type AnalysisItem } from "@/lib/resume/analysis";
import { matchJob, requirementLines, sanitizeExplanation, type JobMatch, type MatchExplanation } from "@/lib/resume/jobmatch";
import type { ResumeDoc } from "@/lib/resume/types";
import { cached } from "./cache";
import { AiNotConfiguredError, isAiConfigured, isAiUnavailable } from "./client";
import { bestMatches, embedForMatching } from "./embeddings";
import { structured } from "./tasks";
import { STYLE_GUIDE } from "@/lib/writing/style";

export { clearAiCache as _clearAiCache } from "./cache";

// ───────────────────────── prompts ─────────────────────────

const RULES = `You edit resume text for a student. The text you are given is the ONLY source of truth.

HARD RULES
- Never add facts. No new numbers, percentages, dollar amounts, user counts, team sizes, dates, employers, job titles, schools, projects, tools, languages, frameworks, certifications, awards or responsibilities.
- Never upgrade scope. Do not write led, managed, architected, owned, spearheaded, or words like distributed, large-scale, production, end-to-end unless the source says so. "Worked on" must never become "Led".
- Never claim a result (improved, reduced, increased, optimized, saved) the source does not state.
- You MAY reword, reorder, tighten, fix grammar, change sentence structure, clarify, use a stronger verb that means the same thing (built ≈ developed), and surface technologies the source already names.
- If a stronger version needs real data you do not have (a metric, scale, outcome), do NOT invent it. Say what the student could add in "missingEvidence" (e.g. "Add the measured response-time reduction if you have that data."). Never put numbers in missingEvidence.
- No first person. One idea per bullet, under 30 words.
- In sourceEvidence, quote (exactly, copied from the input) the resume text each change rests on.
- List anything you are unsure about in newFactsIntroduced (empty when none).

${STYLE_GUIDE}
Reply with JSON only.`;

const Suggestion = z.object({
  text: z.string(),
  reason: z.string().optional().default(""),
  newFactsIntroduced: z.array(z.string()).optional().default([]),
  sourceEvidence: z.array(z.string()).optional().default([]),
  requiresUserConfirmation: z.boolean().optional(),
});
const EditOut = z.object({
  operation: z.string().optional(),
  original: z.string().optional(),
  suggestions: z.array(Suggestion).max(8),
  missingEvidence: z.array(z.string()).optional().default([]),
});

type BulletOp = Exclude<EditOp, "summary" | "skills" | "assistant">;

const INSTRUCTION: Record<BulletOp, string> = {
  improve: "Rewrite the bullet to be clearer and stronger while keeping every fact identical. Give 2 options.",
  shorten: "Make the bullet shorter (aim for at most 60% of its length) without losing any fact it states. Give 2 options.",
  clearer: "Rewrite so the bullet is easy to understand: replace vague words with the specific ones the source already contains, untangle unclear grammar, keep every fact. Give 2 options.",
  technical: "Make the bullet more technical by naming the technologies, methods or components the source ALREADY mentions (in the bullet or its entry). Add none. Give 2 options.",
  impactful: "Make the bullet more impactful with stronger verbs and clearer wording. State an outcome ONLY if the source states it. If real impact needs data the source lacks, say so in missingEvidence. Give 2 options.",
  grammar: "Fix grammar, spelling, tense consistency and punctuation only. Do not change the meaning. Give 1 option.",
  ats: "Rephrase so the <keywords> that the source already supports appear naturally. Never include a keyword the source does not support. Give 2 options.",
  alternatives: "Give three genuinely different rewrites (different structure or emphasis), each keeping every fact identical.",
  quantify: "The student supplied a verified fact in <student_provided_fact>. Work it into the bullet naturally and use it EXACTLY as given (same number, same meaning). Do not add any other number or claim. Give 2 options.",
};
const SHAPE = `JSON shape: {"operation":"rewrite_bullet","original":"...","suggestions":[{"text":"...","reason":"...","sourceEvidence":["exact quote from the input"],"newFactsIntroduced":[],"requiresUserConfirmation":false}],"missingEvidence":[]}`;

/** Missing-evidence hints that come from our own scan, never from the model. */
const noMetric = (text: string) => !/\d/.test(text) && text.trim().split(/\s+/).length >= 6;
const MISSING_METRIC = "Missing evidence: this bullet has no measurable result. If you have real data (size, time saved, users, speed), add it — FRIDAY won't invent it.";
const safeHints = (hints: string[]) => hints.filter((h) => h.trim() && !/\d/.test(h)).slice(0, 3);

// ───────────────────────── bullet edits ─────────────────────────

export type BulletEditInput = {
  op: BulletOp; target: Target; ctx: LineContext; evidence: string; keywords?: string[];
  /** A fact the student typed in (e.g. "Used by 5,000 students"). Used by "Quantify"; it counts as evidence because the student is the source. */
  userFacts?: string;
};

/**
 * Rewrite one bullet. Sends only the bullet, its entry header, up to 8 sibling bullets and
 * (for ATS) a few keywords. Grammar/shorten fall back to deterministic cleanup when no AI is
 * available; every other operation needs a provider and throws AiNotConfiguredError without one.
 */
export async function generateResumeEdit(input: BulletEditInput): Promise<Proposal> {
  const { op, ctx, target } = input;
  const userFacts = input.userFacts?.trim().slice(0, 200) || undefined;
  // The student's own fact is part of what the rewrite may draw on — and is recorded with it, so the saved line validates.
  const basis = userFacts ? `${input.evidence}\n${userFacts}` : input.evidence;
  if (op === "quantify" && !userFacts) {
    // No number, no model: ask the student for a real one instead of inventing it.
    return quantifyProposal(target, ctx.text, basis);
  }
  const local = (op === "grammar" || op === "shorten") ? () => localProposal(op, target, ctx.text, basis) : null;
  if (!isAiConfigured()) {
    if (local) {
      const p = local();
      return { ...p, note: p.note ?? "AI isn't configured, so FRIDAY used its built-in cleanup." };
    }
    throw new AiNotConfiguredError();
  }
  const keywords = (input.keywords ?? []).slice(0, 12);
  const user = [
    `<entry section="${ctx.section}" heading="${ctx.heading}" subheading="${ctx.subheading}" dates="${ctx.meta}">`,
    `<bullet>${ctx.text}</bullet>`,
    ctx.siblings.length ? `<other_bullets_in_entry>\n${ctx.siblings.map((s) => `- ${s}`).join("\n")}\n</other_bullets_in_entry>` : "",
    op === "ats" && keywords.length ? `<keywords>${keywords.join(", ")}</keywords>` : "",
    userFacts ? `<student_provided_fact>${userFacts}</student_provided_fact>` : "",
    "</entry>",
  ].filter(Boolean).join("\n");
  try {
    const raw = await cached({ op, user }, () => structured({ task: "resume_rewrite", schema: EditOut, maxTokens: 900, system: `${RULES}\n\nTASK: ${INSTRUCTION[op]}\n${SHAPE}`, user }));
    const { suggestions, rejected } = screenSuggestions(raw.suggestions, { original: ctx.text, evidence: input.evidence, userFacts, max: 3 });
    const missing = safeHints(raw.missingEvidence);
    if ((op === "impactful" || op === "improve" || op === "quantify") && noMetric(ctx.text) && !userFacts && !missing.length) missing.push(MISSING_METRIC);
    return {
      id: randomId(), op, target, original: ctx.text, basis, suggestions, rejected, missingEvidence: missing, via: "ai",
      note: !suggestions.length && rejected.length ? "The AI's suggestions were discarded because they added facts your resume doesn't contain." : !suggestions.length ? "No better wording found without adding information." : undefined,
    };
  } catch (e) {
    if (local && isAiUnavailable(e)) return { ...local(), note: "AI is unavailable right now — used FRIDAY's built-in cleanup." };
    throw e;
  }
}

/** Three distinct rewrites of one bullet. */
export const generateBulletAlternatives = (input: Omit<BulletEditInput, "op">) => generateResumeEdit({ ...input, op: "alternatives" });

// ───────────────────────── summary ─────────────────────────

/** A professional summary written ONLY from facts already in the resume (its digest). */
export async function generateSummary(input: { doc: ResumeDoc; keywords?: string[] }): Promise<Proposal> {
  if (!isAiConfigured()) throw new AiNotConfiguredError();
  const digest = factDigest(input.doc);
  const existing = input.doc.sections.find((s) => s.kind === "summary")?.lines[0]?.text ?? "";
  const keywords = (input.keywords ?? []).slice(0, 10);
  const user = `<facts>\n${digest}\n</facts>${keywords.length ? `\n<target_keywords>${keywords.join(", ")}</target_keywords>` : ""}`;
  const raw = await cached({ op: "summary", user }, () => structured({ task: "resume_rewrite",
    schema: EditOut, maxTokens: 700,
    system: `${RULES}\n\nTASK: Write a professional summary for a student/new-grad resume: 2 sentences, at most 55 words, built ONLY from <facts>. No numbers unless they appear in <facts>. Do not state years of experience. No "passionate", "motivated", "results-driven". Only mention <target_keywords> that <facts> already support. Give 3 options.\n${SHAPE}`,
    user,
  }));
  const { suggestions, rejected } = screenSuggestions(raw.suggestions, { original: existing, evidence: digest, kind: "summary", max: 3 });
  return {
    id: randomId(), op: "summary", target: { kind: "summary" }, original: existing, basis: digest, suggestions, rejected, missingEvidence: safeHints(raw.missingEvidence), via: "ai",
    note: !suggestions.length ? (rejected.length ? "The AI's drafts were discarded because they added facts your resume doesn't contain." : "Couldn't write a summary from the information on your resume.") : undefined,
  };
}

// ───────────────────────── skills ─────────────────────────

/**
 * Reorder/regroup the skills the resume already lists. Deterministic keyword ordering always
 * runs; with a provider the model also offers regroupings. Nothing can be added: any skill
 * not already listed causes the suggestion to be discarded.
 */
export async function optimizeSkills(input: { doc: ResumeDoc; sectionId: string; keywords?: string[] }): Promise<Proposal> {
  const keywords = (input.keywords ?? []).slice(0, 15);
  const base = localSkillsProposal(input.doc, input.sectionId, keywords);
  if (!isAiConfigured() || !base.original) return base;
  try {
    const user = `<skills>\n${base.original}\n</skills>${keywords.length ? `\n<target_keywords>${keywords.join(", ")}</target_keywords>` : ""}`;
    const raw = await cached({ op: "skills", user }, () => structured({ task: "resume_rewrite",
      schema: EditOut, maxTokens: 700,
      system: `${RULES}\n\nTASK: Regroup and reorder the skills in <skills> for readability and relevance to <target_keywords>. Keep the "Label: a, b, c" line format, one group per line (lines separated by \\n inside "text"). Use ONLY skills already listed — do not add, rename or drop any. Give 2 options.\n${SHAPE}`,
      user,
    }));
    const { suggestions, rejected } = screenSuggestions(raw.suggestions, { original: base.original, evidence: base.original, kind: "skills", max: 2 });
    return { ...base, suggestions: [...base.suggestions, ...suggestions], rejected, via: base.suggestions.length && !suggestions.length ? "local" : "ai", note: undefined };
  } catch (e) {
    if (isAiUnavailable(e)) return base;
    throw e;
  }
}

// ───────────────────────── analysis ─────────────────────────

const Overview = z.object({ points: z.array(z.object({ text: z.string(), where: z.string().optional() })).max(8) });

export type ResumeAnalysis = {
  /** Categorized, deterministic recommendations (weak / repetitive / vague / missing context / formatting / long / short / unclear technical / missing evidence). */
  items: AnalysisItem[];
  counts: Record<string, number>;
  findings: Finding[];
  repeats: Repeat[];
  ats: AtsReport;
  overview: { text: string; where?: string }[] | null;
  via: "deterministic" | "ai";
};

/** Weak bullets + repeated words + ATS score (deterministic), plus a short grounded overview when AI is on. */
export async function analyzeResume(input: { doc: ResumeDoc; jd?: string }): Promise<ResumeAnalysis> {
  const match = input.jd?.trim() ? matchJob(input.doc, input.jd) : null;
  const deep = analyzeDocument(input.doc);
  const base: ResumeAnalysis = { items: deep.items, counts: deep.counts, findings: findWeakBullets(input.doc), repeats: findRepeats(input.doc), ats: analyzeAts(input.doc, { match }), overview: null, via: "deterministic" };
  if (!isAiConfigured()) return base;
  const digest = factDigest(input.doc);
  try {
    const raw = await cached({ op: "overview", digest }, () => structured({ task: "resume_analysis",
      schema: Overview, maxTokens: 700,
      system: `You review a student's resume. Give at most 5 specific, honest observations (strengths and weaknesses) that refer only to what is in <resume>. Never suggest inventing experience, numbers or skills; when something is missing, say what real information the student could add. Do not include numbers that are not in <resume>. Reply with JSON only: {"points":[{"text":"...","where":"section name"}]}`,
      user: `<resume>\n${digest}\n</resume>`,
    }));
    const have = new Set(numbersIn(digest));
    const points = raw.points.filter((p) => p.text.trim() && numbersIn(p.text).every((n) => have.has(n)));
    return { ...base, overview: points, via: "ai" };
  } catch (e) {
    if (isAiUnavailable(e)) return base;
    throw e;
  }
}

const Semantic = z.object({ items: z.array(z.object({ requirement: z.string(), quote: z.string(), note: z.string().optional().default("") })).max(10) });
export type SemanticMatch = {
  requirement: string; quote: string; note: string;
  /** cosine similarity, when found by embeddings */
  score?: number;
  /** "skill": a skill the posting names that the resume lacks/weakly shows. "requirement": a sentence of the posting. */
  kind: "skill" | "requirement";
  where?: string;
};
export type { MatchExplanation };
export type JobMatchResult = JobMatch & { semantic: SemanticMatch[]; explanation: MatchExplanation | null; via: "deterministic" | "ai" };

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/**
 * Minimum cosine similarity for an embedding hit to be shown (override with AI_EMBED_MIN_SIM). Calibrated on the real
 * nemotron-3-embed-1b: a genuinely related pair scored 0.55, unrelated pairs 0.25 or lower — so 0.40 sits between them.
 */
const embedMin = () => (Number(process.env.AI_EMBED_MIN_SIM) > 0 ? Number(process.env.AI_EMBED_MIN_SIM) : 0.4);

const Explain = z.object({ summary: z.string().optional().default(""), nextSteps: z.array(z.object({ requirement: z.string(), advice: z.string() })).max(8).optional().default([]) });

/**
 * A short plain-language read of a match result. The model only SYNTHESIZES numbers and lists that code already
 * computed; `sanitizeExplanation` then removes any sentence that would claim a skill the match found missing.
 */
async function explainMatch(base: JobMatch, semantic: SemanticMatch[]): Promise<MatchExplanation | null> {
  const names = (st: string) => base.skills.filter((s) => s.status === st).map((s) => s.name);
  const facts = { counts: base.counts, matched: names("matched"), weakEvidence: names("weak"), unclear: names("unclear"), missing: names("missing"), relatedButNotProof: semantic.slice(0, 6).map((s) => ({ requirement: s.requirement, resumeText: s.quote })) };
  const raw = await cached({ op: "match-explain", facts }, () => structured({
    task: "job_matching", schema: Explain, maxTokens: 700,
    system: `You explain a job-match result to a student. The data in <result> was computed by code — do not change it and do not add skills, experience or numbers. Never say the student has a skill listed under "missing" or "weakEvidence"; "relatedButNotProof" entries are similar wording only, not proof of a technology. Address the student as "you". Write: "summary" (2–3 sentences: what is strong, what is missing) and "nextSteps" (for each missing/weak/unclear requirement, one sentence starting with "If you have…" describing what real evidence would show it — without naming any tool or technology that is not already the requirement itself). Reply with JSON only: {"summary":"...","nextSteps":[{"requirement":"exact name","advice":"..."}]}`,
    user: `<result>\n${JSON.stringify(facts)}\n</result>`,
  }));
  return sanitizeExplanation(raw, base);
}

/**
 * Deterministic match (source of truth), plus meaning-based evidence and a plain-language explanation.
 *  1. Embeddings rank the resume's OWN bullets against each skill gap and each requirement sentence of the posting —
 *     they can only point at text that exists. A hit is "related wording", never proof of a technology.
 *  2. Only if no embedding provider works does an LLM get asked to quote evidence (verbatim-verified).
 *  3. With `explain`, Nemotron Super synthesizes the result into advice — through a filter that removes any claim of a missing skill.
 * Nothing is ever added to the resume.
 */
export async function matchResumeToJob(input: { doc: ResumeDoc; jd: string; explain?: boolean }): Promise<JobMatchResult> {
  const base = matchJob(input.doc, input.jd);
  const gapSkills = base.skills.filter((s) => s.status === "missing" || s.status === "weak").slice(0, 10);
  const gaps = gapSkills.map((s) => s.name);
  const plain: JobMatchResult = { ...base, semantic: [], explanation: null, via: "deterministic" };
  if (!isAiConfigured()) return plain;

  const passages = [...allLines(input.doc)]
    .filter((x) => x.entry && ["experience", "projects", "activities"].includes(x.section.kind) && x.line.text.trim())
    .slice(0, 60)
    .map((x) => ({ text: x.line.text.trim(), where: `${x.section.title} · ${x.entry!.heading || "entry"}` }));
  const jdLines = input.jd.split(/\n+/).map((l) => l.trim());
  const gapQueries = gaps.map((g) => (jdLines.find((l) => l.length > 8 && hasTerm(l, g)) ?? `Experience with ${g}`).slice(0, 300));
  // Sentences of the posting that name none of the gap skills: matched by meaning ("Develop RESTful services" ↔ "Built backend APIs").
  // Only sentences that name NO skill the posting is scored on — a sentence naming a matched skill is already covered
  // deterministically, and one naming a gap is covered by that gap's own query. This keeps "related" hits meaningful.
  const lineQueries = requirementLines(input.jd).filter((l) => !base.skills.some((k) => hasTerm(l, k.name))).slice(0, 6);
  const queries = [...gapQueries, ...lineQueries];

  const emb = passages.length && queries.length ? await embedForMatching(queries, passages.map((p) => p.text)) : null;
  let semantic: SemanticMatch[] = [];
  let usedAi = false;
  if (emb) {
    usedAi = true;
    const seen = new Set<string>();
    for (const m of bestMatches(emb, embedMin())) {
      const passage = passages[m.passage];
      if (m.query < gaps.length) {
        const name = gaps[m.query];
        if (hasTerm(passage.text, name)) continue; // a literal mention is already handled deterministically
        semantic.push({ kind: "skill", requirement: name, quote: passage.text, where: passage.where, score: m.score, note: `Similar wording (${m.score.toFixed(2)}) in ${passage.where}. This is related wording — it does not show you've used ${name}. Only claim it if it's true.` });
      } else {
        const line = lineQueries[m.query - gaps.length];
        const key = `${line}|${passage.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        semantic.push({ kind: "requirement", requirement: line, quote: passage.text, where: passage.where, score: m.score, note: `Similar wording (${m.score.toFixed(2)}) in ${passage.where}. Related, not proof — check that it really covers this.` });
      }
    }
    semantic.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  } else if (gaps.length) {
    // No embedding model reachable: ask an LLM to quote evidence, and keep only quotes that appear verbatim in the resume.
    const digest = factDigest(input.doc);
    try {
      const raw = await cached({ op: "semantic", digest, gaps }, () => structured({ task: "job_matching",
        schema: Semantic, maxTokens: 700,
        system: `For each requirement in <requirements>, decide whether <resume> already shows evidence of it in different words (e.g. "REST" ↔ "built HTTP endpoints"). Only report a requirement if you can quote the exact resume text that shows it — the quote must be copied verbatim from <resume>. Skip requirements with no evidence. Never invent evidence. Reply with JSON only: {"items":[{"requirement":"...","quote":"exact resume text","note":"why it counts"}]}`,
        user: `<requirements>${gaps.join("; ")}</requirements>\n<resume>\n${digest}\n</resume>`,
      }));
      const hay = flat(docToText(input.doc));
      semantic = raw.items
        .filter((i) => gaps.some((g) => flat(g) === flat(i.requirement)) && i.quote.trim().length > 8 && hay.includes(flat(i.quote)))
        .map((i) => ({ ...i, kind: "skill" as const, note: `${i.note || "Related wording."} It does not show you've used ${i.requirement} — only claim it if it's true.` }));
      usedAi = true;
    } catch (e) {
      if (!isAiUnavailable(e)) throw e;
    }
  }

  let explanation: MatchExplanation | null = null;
  if (input.explain && (gapSkills.length || base.skills.length)) {
    try {
      explanation = await explainMatch(base, semantic);
      usedAi = true;
    } catch (e) {
      if (!isAiUnavailable(e)) throw e;
    }
  }
  return { ...base, semantic, explanation, via: usedAi ? "ai" : "deterministic" };
}

const Plan = z.object({ actions: z.array(z.object({ fix: z.number().int(), why: z.string() })).max(6) });
export type AtsAnalysis = AtsReport & { plan: { fix: AtsFix; why: string }[] | null };

/** The deterministic ATS report; with `explain` and a provider, a prioritized plan over its own fixes (no new advice). */
export async function analyzeATS(input: { doc: ResumeDoc; jd?: string; explain?: boolean }): Promise<AtsAnalysis> {
  const match = input.jd?.trim() ? matchJob(input.doc, input.jd) : null;
  const report = analyzeAts(input.doc, { match });
  if (!input.explain || !isAiConfigured()) return { ...report, plan: null };
  const fixes = report.components.flatMap((c) => c.fixes.map((f) => ({ ...f, component: c.label })));
  if (!fixes.length) return { ...report, plan: [] };
  try {
    const list = fixes.map((f, i) => `${i}. [${f.component}] ${f.message}`).join("\n");
    const raw = await cached({ op: "plan", list }, () => structured({ task: "ats_analysis",
      schema: Plan, maxTokens: 600,
      system: `You prioritize resume fixes for an ATS. From the numbered <fixes>, choose the 3–5 with the biggest effect on being parsed and matched and say in one sentence why each matters. Refer to fixes ONLY by their number. Do not add new fixes. Reply with JSON only: {"actions":[{"fix":0,"why":"..."}]}`,
      user: `<fixes>\n${list}\n</fixes>`,
    }));
    const plan = raw.actions.filter((a) => a.fix >= 0 && a.fix < fixes.length).map((a) => ({ fix: fixes[a.fix], why: a.why.trim() })).filter((a) => a.why);
    return { ...report, plan };
  } catch (e) {
    if (isAiUnavailable(e)) return { ...report, plan: null };
    throw e;
  }
}

// ───────────────────────── assistant ─────────────────────────

export type Intent = "weak" | "repeats" | "missing" | "match" | "ats" | "summary" | "edit";

/** Deterministic routing: requests that don't need a model never cost one. */
export function classifyIntent(message: string): Intent {
  const m = message.toLowerCase();
  if (/\b(?:repeat(?:ed|ing)?|repetit\w*|overused|same word)\b/.test(m)) return "repeats";
  if (/\b(?:weak|poor|bad|worst)\b.*\b(?:bullets?|lines?|points?)\b|\bfind\b.*\bweak\b/.test(m)) return "weak";
  if (/\bmissing\b.*\b(?:tech\w*|skills?|keywords?)\b|\bwhat(?:'s| is)? missing\b/.test(m)) return "missing";
  if (/\b(?:compare|match|fit|gap)\b.*\b(?:job|posting|description|role|jd)\b|\bjob description\b/.test(m)) return "match";
  if (/\bats\b|\bapplicant tracking\b|\bresume score\b|\bscore\b/.test(m)) return "ats";
  if (/\bsummary\b/.test(m)) return "summary";
  return "edit";
}

/** Which bullet operation a free-text request about ONE selected bullet means. */
export function classifyBulletOp(message: string): BulletOp {
  const m = message.toLowerCase();
  if (/\b(?:shorten|shorter|trim|concise|condense|cut)\b/.test(m)) return "shorten";
  if (/\b(?:technical|technically)\b/.test(m)) return "technical";
  if (/\b(?:impact\w*|stronger|powerful)\b/.test(m)) return "impactful";
  if (/\b(?:grammar|typo|spelling|proofread)\b/.test(m)) return "grammar";
  if (/\b(?:alternatives?|options|variations?)\b/.test(m)) return "alternatives";
  if (/\bats\b|\bkeywords?\b/.test(m)) return "ats";
  return "improve";
}

const SECTION_WORDS: [RegExp, string][] = [[/\bexperience|work history|jobs?\b/, "experience"], [/\bprojects?\b/, "projects"], [/\beducation|coursework\b/, "education"], [/\bactivit\w+|leadership|clubs?\b/, "activities"]];

const AssistantOut = z.object({
  reply: z.string().optional().default(""),
  edits: z.array(z.object({ id: z.string(), text: z.string(), reason: z.string().optional().default(""), newFactsIntroduced: z.array(z.string()).optional().default([]) })).max(10),
  missingEvidence: z.array(z.string()).optional().default([]),
});

export type AssistantResult = { reply: string; proposals: Proposal[]; findings: Finding[]; repeats: Repeat[]; match: JobMatch | null; ats: AtsReport | null; usedAi: boolean };
const EMPTY: AssistantResult = { reply: "", proposals: [], findings: [], repeats: [], match: null, ats: null, usedAi: false };
const NEEDS_AI = "AI features need a free API key — add GROQ_API_KEY or GEMINI_API_KEY on the server. Weak-bullet checks, repeated words, ATS scoring and job matching all work without one.";

/**
 * Resume chat. Returns structured edits (proposals to accept/reject), not just prose, whenever
 * a change is requested. `evidenceFor` supplies the text a given line may draw on.
 */
export async function runResumeAssistant(input: {
  message: string;
  doc: ResumeDoc;
  jd?: string;
  selection?: LineRef | null;
  contextFor: (ref: LineRef) => LineContext | null;
  evidenceFor: (ref: LineRef) => string;
}): Promise<AssistantResult> {
  const { doc, jd, selection } = input;
  const intent = classifyIntent(input.message);
  const hasJd = Boolean(jd?.trim());

  if (intent === "weak") {
    const findings = findWeakBullets(doc);
    const weak = findings.filter((f) => f.severity === "weak");
    return { ...EMPTY, findings, reply: weak.length ? `I found ${weak.length} weak bullet${weak.length === 1 ? "" : "s"}${findings.length > weak.length ? ` and ${findings.length - weak.length} where a real measurement would help` : ""}. Click one to improve it.` : findings.length ? "No structurally weak bullets. Some could be stronger with real measurements, if you have them." : "No weak bullets found." };
  }
  if (intent === "repeats") {
    const repeats = findRepeats(doc);
    return { ...EMPTY, repeats, reply: repeats.length ? `Repeated wording: ${repeats.slice(0, 4).map((r) => `“${r.word}” ×${r.count}`).join(", ")}.` : "No overused words or repeated bullet openers." };
  }
  if (intent === "match" || intent === "missing") {
    if (!hasJd) return { ...EMPTY, reply: "Paste the job description in the Job Match tab (or in your message) and I'll compare it with your resume." };
    const match = matchJob(doc, jd!);
    const miss = match.skills.filter((s) => s.status === "missing");
    return { ...EMPTY, match, reply: intent === "missing"
      ? miss.length ? `Not on your resume: ${miss.map((s) => s.name).join(", ")}. Only add one if you genuinely have that skill.` : "Every skill the posting names appears on your resume."
      : `${match.counts.matched} matched, ${match.counts.weak} weak, ${match.counts.unclear} unclear, ${match.counts.missing} missing. ${miss.length ? `Missing: ${miss.map((s) => s.name).join(", ")} — only add what you genuinely have.` : ""}`.trim() };
  }
  if (intent === "ats") {
    const ats = analyzeAts(doc, { match: hasJd ? matchJob(doc, jd!) : null });
    return { ...EMPTY, ats, reply: `ATS score ${ats.score}/100 (${ats.rating}). ${ats.components.filter((c) => c.rating !== "Good").slice(0, 3).map((c) => `${c.label}: ${c.reason}`).join(" ")}`.trim() };
  }

  // Everything below rewrites text and needs a model.
  if (!isAiConfigured()) return { ...EMPTY, reply: NEEDS_AI };

  if (intent === "summary") {
    const p = await generateSummary({ doc, keywords: hasJd ? matchJob(doc, jd!).skills.filter((s) => s.status !== "missing").map((s) => s.name) : [] });
    return { ...EMPTY, usedAi: true, proposals: [p], reply: p.suggestions.length ? "Here are summary drafts built only from what's on your resume." : p.note ?? "" };
  }

  if (selection) {
    const ctx = input.contextFor(selection);
    if (ctx) {
      const p = await generateResumeEdit({ op: classifyBulletOp(input.message), target: { kind: "line", ...selection }, ctx, evidence: input.evidenceFor(selection), keywords: hasJd ? matchJob(doc, jd!).skills.map((s) => s.name) : [] });
      return { ...EMPTY, usedAi: p.via === "ai", proposals: [p], reply: p.suggestions.length ? `Here ${p.suggestions.length === 1 ? "is a suggestion" : "are suggestions"} for the selected bullet.` : p.note ?? "" };
    }
  }

  // Section-level request: send only that section's lines (or the first 24 work bullets).
  const m = input.message.toLowerCase();
  const kind = SECTION_WORDS.find(([re]) => re.test(m))?.[1];
  const lines = [...allLines(doc)].filter((l) => l.entry && l.line.text.trim() && (!kind || l.section.kind === kind)).slice(0, 24);
  if (!lines.length) return { ...EMPTY, usedAi: true, reply: "There are no bullets there to edit yet." };
  const byId = new Map(lines.map((l) => [l.line.id, l]));
  const user = `<request>${input.message.slice(0, 400)}</request>\n${hasJd ? `<keywords>${matchJob(doc, jd!).skills.map((s) => s.name).slice(0, 12).join(", ")}</keywords>\n` : ""}<lines>\n${lines.map((l) => `[${l.line.id}] (${l.entry!.heading}) ${l.line.text}`).join("\n")}\n</lines>`;
  const raw = await cached({ op: "assistant", user }, () => structured({ task: "resume_rewrite",
    schema: AssistantOut, maxTokens: 1400,
    system: `${RULES}\n\nTASK: Follow the student's <request> by editing the lines in <lines>. Return edits ONLY for lines that truly need a change (at most 8), each with the line's id. Keep every fact identical. "reply" is one or two sentences about what you did. Shape: {"reply":"...","edits":[{"id":"...","text":"...","reason":"...","newFactsIntroduced":[]}],"missingEvidence":[]}`,
    user,
  }));
  const proposals: Proposal[] = [];
  for (const e of raw.edits) {
    const at = byId.get(e.id);
    if (!at) continue; // the model referred to a line that doesn't exist
    const evidence = input.evidenceFor(at.ref);
    const { suggestions, rejected } = screenSuggestions([{ text: e.text, reason: e.reason, newFactsIntroduced: e.newFactsIntroduced }], { original: at.line.text, evidence, max: 1 });
    if (suggestions.length || rejected.length) proposals.push({ id: randomId(), op: "assistant", target: { kind: "line", ...at.ref }, original: at.line.text, basis: evidence, suggestions, rejected, missingEvidence: [], via: "ai" });
  }
  const dropped = proposals.reduce((n, p) => n + (p.suggestions.length ? 0 : 1), 0);
  return {
    ...EMPTY, usedAi: true, proposals,
    reply: `${raw.reply.trim() || "Here are my suggestions."}${dropped ? ` ${dropped} edit${dropped === 1 ? " was" : "s were"} discarded because ${dropped === 1 ? "it" : "they"} added facts your resume doesn't contain.` : ""}${safeHints(raw.missingEvidence).length ? `\n\n${safeHints(raw.missingEvidence).join("\n")}` : ""}`.trim(),
  };
}

export { basisOf, skillsText };
