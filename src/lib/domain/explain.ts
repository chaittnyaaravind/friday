/**
 * Why a job matched — and why it did not — in plain sentences.
 *
 * Built ONLY from what the deterministic engine already decided: the score's breakdown, the skills it found and the ones
 * it did not, and the eligibility checks. No model writes this, so it can never name a skill as "matched" that the engine
 * did not find, and it can never make a gap sound smaller than it is. Pure and deterministic.
 */
import type { EligibilityResult } from "./eligibility";
import { learnSuggestion, type BreakdownPart, type MatchResult } from "./match";

export type MatchReasons = {
  /** One sentence: how strong the match is, what carries it, and whether eligibility is a problem. */
  headline: string;
  /** Where points were earned, each with its numbers and reason. */
  whyItMatches: string[];
  /** Where points were NOT earned, the skills that are missing, and eligibility problems. Empty when nothing holds the match back. */
  whyNot: string[];
  nextSteps: string[];
};

export const TIER_WORD: Record<MatchResult["tier"], string> = { strong: "Strong match", good: "Good match", stretch: "Stretch role" };

const line = (p: BreakdownPart) => `${p.label} — ${p.points} of ${p.max}: ${p.detail}`;

export function explainMatch(m: MatchResult, e: EligibilityResult | null = null): MatchReasons {
  // What carries the match: skills first, then role, location, profile.
  const order = { skill: 0, role: 1, location: 2, profile: 3 } as const;
  const carries = [...m.strong].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 3).map((r) => r.label);

  let headline = `${TIER_WORD[m.tier]} (${m.score}/100)${carries.length ? `: ${carries.join(", ")}.` : ": nothing on your profile lines up with it yet."}`;
  if (e?.verdict === "blocked") headline += ` But it is likely blocked — ${e.headline.replace(/^Likely blocked: /, "")}`;
  else if (e?.verdict === "verify") headline += " Verify your eligibility before applying.";

  const whyItMatches = m.breakdown.filter((p) => p.points > 0).map(line);

  const whyNot: string[] = m.breakdown.filter((p) => p.points < p.max).map(line);
  const req = m.missing.filter((g) => g.kind === "required").map((g) => g.label);
  const pref = m.missing.filter((g) => g.kind === "preferred").map((g) => g.label);
  if (req.length) whyNot.push(`Required skills you do not have on your profile: ${req.join(", ")}.`);
  if (pref.length) whyNot.push(`Preferred skills you do not have on your profile: ${pref.join(", ")}.`);
  const issues = (e?.checks ?? []).filter((c) => c.status === "fail" || c.status === "warn" || (c.status === "unknown" && c.material));
  for (const c of issues) whyNot.push(`Eligibility — ${c.label}: ${c.detail}`);

  const nextSteps = [
    ...req.slice(0, 2).map(learnSuggestion),
    ...issues.map((c) => (c.status === "fail" ? `Confirm "${c.label.toLowerCase()}" in the posting before spending time on an application.` : `Check ${c.label.toLowerCase()} before applying.`)),
  ].filter((s, i, all) => all.indexOf(s) === i);

  return { headline, whyItMatches, whyNot, nextSteps };
}
