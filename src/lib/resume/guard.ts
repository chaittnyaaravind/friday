/**
 * Fact guard for AI-written resume text. Pure and deterministic (safe on client and server).
 *
 * A suggestion may reword what the source says. It may NOT introduce a fact. Given the
 * suggestion and the evidence it is allowed to draw on (the original line, its entry, and
 * the profile item behind it), `newFactsIn` lists everything the suggestion asserts that
 * the evidence does not:
 *
 *   number / technology         → severity "reject"   (never shown as applicable)
 *   name / scope / outcome      → severity "confirm"  (user must attest before it applies)
 *
 * The model's own "newFactsIntroduced" self-report is never trusted on its own.
 */
import { skillMentions } from "./parse";

export type FactKind = "number" | "technology" | "name" | "scope" | "outcome";
export type NewFact = { claim: string; kind: FactKind; severity: "reject" | "confirm"; reason: string };
export type Verdict = "ok" | "confirm" | "reject";
/** How risky a suggestion is: none = adds nothing; low = an unstated result; medium = unstated scope/ownership/name; high = an unsupported number or technology. */
export type Risk = "none" | "low" | "medium" | "high";

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%$+#.]/g, "");

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|\+|(?:million|billion|thousand|k|m|x)\b)?/gi;
export const numbersIn = (text: string) => (text.match(NUM_RE) ?? []).map((n) => n.replace(/\s+/g, "").replace(/,/g, "").toLowerCase());

const NUMBER_WORDS = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundreds?|thousands?|millions?|billions?|dozens?|double[ds]?|tripled?|tenfold|half)\b/gi;
const wordNumbersIn = (text: string) => (text.match(NUMBER_WORDS) ?? []).map((w) => w.toLowerCase());

/** Whole-term, case-insensitive containment (so "Java" is not "found" inside "JavaScript"). */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const hasTerm = (haystack: string, term: string) => new RegExp(`(?<![A-Za-z0-9+#])${esc(term.trim())}(?:e?s)?(?![A-Za-z0-9+#])`, "i").test(haystack);

// Claims about seniority, ownership, scale or results. Each entry: [label, pattern, kind].
type Lex = [string, RegExp, "scope" | "outcome"];
const LEXICON: Lex[] = [
  ["led / lead", /\b(?:led|leads|leading|lead\s+(?:engineer|developer|role))\b/i, "scope"],
  ["architected", /\barchitect(?:ed|ing|s)?\b/i, "scope"],
  ["spearheaded", /\bspearhead(?:ed|ing)?\b/i, "scope"],
  ["managed", /\bmanag(?:ed|ing|es)\b/i, "scope"],
  ["directed / oversaw", /\b(?:directed|directing|oversaw|overseeing|supervis(?:ed|ing))\b/i, "scope"],
  ["owned", /\b(?:owned|owning|took\s+ownership)\b/i, "scope"],
  ["founded / pioneered", /\b(?:founded|co-?founded|pioneer(?:ed|ing)?)\b/i, "scope"],
  ["mentored", /\bmentor(?:ed|ing)\b/i, "scope"],
  ["orchestrated / drove", /\b(?:orchestrat(?:ed|ing)|drove|driving|championed)\b/i, "scope"],
  ["team of", /\bteam\s+of\b|\bcross-?functional\b|\bstakeholders?\b/i, "scope"],
  ["senior / principal", /\b(?:senior|principal|staff\s+engineer)\b/i, "scope"],
  ["distributed", /\bdistributed\b/i, "scope"],
  ["large-scale", /\b(?:large|enterprise|global|planet)-?\s?scale\b|\benterprise\b|\bhigh-?traffic\b|\bmission-?critical\b|\bfortune\s?\d*\b/i, "scope"],
  ["production", /\bin\s+production\b|\bproduction[- ](?:ready|grade|system|environment|deploy\w*)\b/i, "scope"],
  ["end-to-end", /\bend-?to-?end\b/i, "scope"],
  ["award-winning", /\baward-?winning\b|\bwon\b|\bawarded\b/i, "scope"],
  // Found live 2026-10-25: an AI summary called private repositories "open-source tools".
  ["open-source / published", /\bopen-?\s?sourced?\b|\bpublicly (?:available|released)\b|\bpublished\b/i, "scope"],
  ["users / adoption", /\b(?:used by|adopted by|users?|customers?|clients?|downloads?|installs?)\b/i, "outcome"],
  ["launched / released", /\b(?:launched|released|went live)\b/i, "outcome"],
  ["improved / increased", /\b(?:improv(?:ed|ing|es)|increas(?:ed|ing|es)|boost(?:ed|ing)|accelerat(?:ed|ing)|enhanc(?:ed|ing))\b/i, "outcome"],
  ["reduced / saved", /\b(?:reduc(?:ed|ing|es)|cut|saved|decreas(?:ed|ing)|eliminat(?:ed|ing)|minimi[sz](?:ed|ing))\b/i, "outcome"],
  ["optimized / streamlined", /\b(?:optimi[sz](?:ed|ing|es)|streamlin(?:ed|ing)|scal(?:ed|ing))\b/i, "outcome"],
];

const STOP_NAMES = new Set(["i", "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "as", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

/** Capitalized words in the middle of a sentence that the evidence never uses (possible invented names). */
function unseenNames(text: string, evidence: string): string[] {
  const out = new Set<string>();
  const words = text.split(/\s+/);
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+#.]+$/g, "").replace(/\.+$/, ""); // a sentence-final period is not part of the name
    if (!w || i === 0 || w.length < 3) return;
    if (!/^[A-Z][A-Za-z0-9+#.]*$/.test(w) && !/^[A-Z]{2,}$/.test(w)) return;
    if (/[.!?]$/.test(words[i - 1] ?? "")) return; // sentence start
    if (STOP_NAMES.has(w.toLowerCase())) return;
    if (!hasTerm(evidence, w)) out.add(w);
  });
  return [...out];
}

/** Everything `suggestion` asserts that `evidence` does not. */
export function newFactsIn(suggestion: string, evidence: string): NewFact[] {
  const facts: NewFact[] = [];
  const add = (f: NewFact) => facts.some((x) => x.claim.toLowerCase() === f.claim.toLowerCase() && x.kind === f.kind) || facts.push(f);
  const evNums = new Set(numbersIn(evidence));
  const evWords = new Set(wordNumbersIn(evidence));

  for (const n of numbersIn(suggestion)) {
    if (!evNums.has(n)) add({ claim: n, kind: "number", severity: "reject", reason: "This number isn't in your resume." });
  }
  for (const w of wordNumbersIn(suggestion)) {
    if (!evWords.has(w)) add({ claim: w, kind: "number", severity: "reject", reason: "This quantity isn't in your resume." });
  }
  for (const t of skillMentions(suggestion)) {
    if (!hasTerm(evidence, t)) add({ claim: t, kind: "technology", severity: "reject", reason: `${t} isn't in your resume.` });
  }
  for (const [label, re, kind] of LEXICON) {
    const m = suggestion.match(re);
    // "used by 50,000 users": the invented number already rejects the line and names the claim; don't name it twice.
    if (label === "users / adoption" && facts.some((f) => f.kind === "number")) continue;
    if (m && !re.test(evidence)) {
      add({
        claim: m[0].trim(),
        kind,
        severity: "confirm",
        reason: kind === "scope"
          ? `“${m[0].trim()}” claims more ownership or scale (${label}) than your resume states.`
          : `“${m[0].trim()}” claims a result (${label}) your resume doesn't state.`,
      });
    }
  }
  const named = new Set(facts.map((f) => norm(f.claim)));
  for (const name of unseenNames(suggestion, evidence)) {
    if (!named.has(norm(name))) add({ claim: name, kind: "name", severity: "confirm", reason: `“${name}” isn't mentioned anywhere in your resume.` });
  }
  return facts;
}

export const verdictOf = (facts: NewFact[]): Verdict => (facts.some((f) => f.severity === "reject") ? "reject" : facts.length ? "confirm" : "ok");

/** A skills line may only regroup, reorder or relabel skills the source already lists. */
export function skillsLineFacts(original: string, suggestion: string): NewFact[] {
  const tokens = (s: string) => s.replace(/^[^:]{1,40}:\s*/gm, "").split(/\s*[,;\n]\s*/).map((t) => t.trim()).filter(Boolean);
  const have = new Set(tokens(original).map(norm));
  return tokens(suggestion)
    .filter((t) => !have.has(norm(t)))
    .map((t) => ({ claim: t, kind: "technology" as const, severity: "reject" as const, reason: `${t} isn't in your current skills.` }));
}

/** Words in a line (used for length checks and diffs). */
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export const riskOf = (facts: NewFact[]): Risk =>
  facts.some((f) => f.severity === "reject") ? "high" : facts.some((f) => f.kind === "scope" || f.kind === "name") ? "medium" : facts.length ? "low" : "none";

/** "50000" → "50,000 users" (the number as written, with the words after it); other claims are shown as found. */
export function claimPhrase(text: string, f: NewFact): string {
  if (f.kind === "number") {
    for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|\+|(?:million|billion|thousand|k|m|x)\b))?(?:\s+[A-Za-z][A-Za-z-]*){0,2}/gi)) {
      if (numbersIn(m[0])[0] === f.claim) return m[0].replace(/(?:\s+(?:and|or|to|in|for|with|by|on|at|the|a|an|of|that|which|while|as|from|but|so|\w+ing))+\s*$/i, "").trim(); // "50,000 users and" → "50,000 users"
    }
  }
  return f.claim;
}
