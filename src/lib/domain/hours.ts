/**
 * Weekly hours, read from a posting's own words. Only what the text states: no default, no guess.
 *
 * Campus postings state limits in a few recurring ways. Real examples (SJSU Student Union feed, 2026-09-27):
 *   "may work up to, but not in excess of 20 hours per week (among all concurrent positions)"   ← while school is in session
 *   "(summer break) may work up to, but not in excess of 40 hours per week"                     ← between terms
 *   "10-20 hours per week", "up to 20 hours/week", "20 hrs. a week"
 * The in-session limit is what matters for a student who must stay under a term cap (an F-1 student's on-campus limit
 * is the reason FRIDAY records it), so `max` prefers it and the break limit is kept separately.
 */
export type ParsedHours = {
  /** Display text, e.g. "Up to 20 hrs/week (40 on breaks)". */
  text: string;
  min: number | null;
  /** The weekly cap while school is in session — or the only cap stated. */
  max: number | null;
  /** A separately stated cap for breaks / summer, when the text gives one. */
  breakMax: number | null;
};

const PER_WEEK = String.raw`(?:hours?|hrs?\.?)\s*(?:per|a|each|every|\/)\s*(?:week|wk)\b|(?:hours?|hrs?\.?)\s+weekly\b`;
const RANGE = new RegExp(String.raw`\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:${PER_WEEK})`, "gi");
const CAP = new RegExp(String.raw`(?:up to|maximum(?: of)?|max\.?(?: of)?|no more than|not to exceed|not in excess of|at most|limited to)[\s,]*(?:but not (?:in excess of|to exceed)[\s,]*)?(?:of\s+)?(\d{1,2})\s*(?:${PER_WEEK})`, "gi");
const PLAIN = new RegExp(String.raw`\b(\d{1,2})\s*(?:${PER_WEEK})`, "gi");

const BREAK_CONTEXT = /\b(?:summer|winter|spring break|semester break|between (?:terms|semesters)|intersession|holiday|breaks?|not in session)\b/gi;
// "in session" must not match inside "NOT in session" (the real Student Union text says "When classes are not in session (i.e. summer break)").
const TERM_CONTEXT = /\b(?:school is in session|classes are in session|during the (?:academic )?(?:term|semester|school year)|(?<!not )in session|academic year)\b/gi;

/** Index where the last match of `rx` starts in `s`, or -1. */
const lastMatch = (rx: RegExp, s: string) => {
  let at = -1;
  for (const m of s.matchAll(rx)) at = m.index ?? at;
  return at;
};

const sane = (n: number) => n >= 1 && n <= 60; // more than 60 a week is not a weekly figure ("150 hours/semester" never matches PER_WEEK)

export function parseHours(input: string | null | undefined): ParsedHours | null {
  const text = (input ?? "").replace(/\s+/g, " ");
  if (!text) return null;

  // A stated range wins outright ("10–20 hours per week").
  for (const m of text.matchAll(RANGE)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (sane(lo) && sane(hi) && lo < hi) return { text: `${lo}–${hi} hrs/week`, min: lo, max: hi, breakMax: null };
  }

  // Caps, each classified by the words just before it (in session / on break).
  const caps: { n: number; kind: "term" | "break" | "unmarked" }[] = [];
  for (const m of text.matchAll(CAP)) {
    const n = Number(m[1]);
    if (!sane(n)) continue;
    // Whichever context marker is NEAREST before the cap decides what it is a cap for.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 90), m.index ?? 0);
    const term = lastMatch(TERM_CONTEXT, before);
    const brk = lastMatch(BREAK_CONTEXT, before);
    caps.push({ n, kind: brk > term ? "break" : term >= 0 ? "term" : "unmarked" });
  }
  if (caps.length) {
    const term = caps.find((c) => c.kind === "term") ?? caps.find((c) => c.kind === "unmarked");
    const brk = caps.find((c) => c.kind === "break");
    const max = term?.n ?? Math.min(...caps.map((c) => c.n));
    const breakMax = brk && brk.n !== max ? brk.n : null;
    return { text: `Up to ${max} hrs/week${breakMax ? ` (${breakMax} on breaks)` : ""}`, min: null, max, breakMax };
  }

  // A plain statement of weekly hours ("20 hours per week").
  for (const m of text.matchAll(PLAIN)) {
    const n = Number(m[1]);
    if (sane(n)) return { text: `${n} hrs/week`, min: n, max: n, breakMax: null };
  }
  return null;
}
