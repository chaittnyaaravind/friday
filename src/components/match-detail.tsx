import { AlertTriangle, Check, CircleHelp, X } from "lucide-react";
import { VERDICT_LABEL, type CheckStatus, type EligibilityResult, type EligibilityVerdict } from "@/lib/domain/eligibility";
import type { MatchReasons } from "@/lib/domain/explain";
import type { BreakdownPart } from "@/lib/domain/match";
import { Chip, Label, cx } from "./ui";

/** Where every point of the score came from. The bars are the real fractions; the words say why. The parts sum to the score. */
export function ScoreBreakdown({ parts, score }: { parts: BreakdownPart[]; score: number }) {
  return (
    <div className="flex flex-col gap-4 border-t-[0.5px] border-hairline-strong pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label>How the score adds up</Label>
        <span className="num font-mono text-[12px] text-dim">{parts.map((p) => p.points).join(" + ")} = {score}</span>
      </div>
      <ul className="flex flex-col gap-3.5">
        {parts.map((p) => (
          <li key={p.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span>{p.label}</span>
              <span className="num font-mono text-[12.5px] text-muted">{p.points} <span className="text-dim">of {p.max}</span></span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-[rgb(var(--ink)/.08)]" role="img" aria-label={`${p.label}: ${p.points} of ${p.max}`}>
              <div className={cx("h-full rounded-full", p.points >= p.max ? "bg-moss" : "bg-[rgb(var(--ink)/.45)]")} style={{ width: `${p.max ? (p.points / p.max) * 100 : 0}%` }} />
            </div>
            <p className="text-[12.5px] leading-snug text-muted">{p.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_ICON: Record<CheckStatus, { icon: typeof Check; cls: string; word: string }> = {
  pass: { icon: Check, cls: "text-moss", word: "Fine" },
  warn: { icon: AlertTriangle, cls: "text-amber", word: "Check" },
  fail: { icon: X, cls: "text-accent", word: "Blocked" },
  unknown: { icon: CircleHelp, cls: "text-dim", word: "Unknown" },
};
const VERDICT_TONE: Record<EligibilityVerdict, "moss" | "amber" | "accent"> = { clear: "moss", verify: "amber", blocked: "accent" };

/**
 * Can you apply? Separate from the score. Every check is listed with its own reason, so the verdict is never a black box,
 * and the panel always says that FRIDAY compares text and cannot determine legal eligibility.
 */
export function EligibilityPanel({ result }: { result: EligibilityResult }) {
  return (
    <div className="flex flex-col gap-4 border-t-[0.5px] border-hairline-strong pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Label>Eligibility</Label>
        <Chip tone={VERDICT_TONE[result.verdict]}>{VERDICT_LABEL[result.verdict]}</Chip>
      </div>
      <p className="text-[14px] leading-snug">{result.headline}</p>
      {result.checks.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {result.checks.map((c) => {
            const { icon: Icon, cls, word } = STATUS_ICON[c.status];
            return (
              <li key={`${c.id}-${c.detail}`} className="flex items-start gap-2.5 text-[13.5px]">
                <Icon size={14} strokeWidth={2.2} className={cx("mt-[3px] shrink-0", cls)} aria-label={word} />
                <span><span className="font-medium">{c.label}.</span> <span className="text-muted">{c.detail}</span></span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11.5px] leading-snug text-dim">{result.disclaimer}</p>
    </div>
  );
}

/** Why it matched, and why it did not, in the engine's own numbers. */
export function ReasonsPanel({ reasons }: { reasons: MatchReasons }) {
  if (!reasons.whyItMatches.length && !reasons.whyNot.length) return null;
  return (
    <div className="grid gap-6 border-t-[0.5px] border-hairline-strong pt-5 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Label className="!text-moss">Why it matched</Label>
        <ul className="flex flex-col gap-2 text-[13px] leading-snug text-muted">
          {reasons.whyItMatches.length ? reasons.whyItMatches.map((l) => <li key={l}>{l}</li>) : <li>Nothing on your profile lines up with this yet.</li>}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <Label className="!text-amber">Why it did not match fully</Label>
        <ul className="flex flex-col gap-2 text-[13px] leading-snug text-muted">
          {reasons.whyNot.length ? reasons.whyNot.map((l) => <li key={l}>{l}</li>) : <li>Nothing is holding this match back.</li>}
        </ul>
      </div>
      {reasons.nextSteps.length > 0 && (
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>What you can do</Label>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-snug">
            {reasons.nextSteps.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
