import { AlertTriangle, Check, CircleHelp, X } from "lucide-react";
import { VERDICT_LABEL, type CheckStatus, type EligibilityResult, type EligibilityVerdict } from "@/lib/domain/eligibility";
import type { MatchReasons } from "@/lib/domain/explain";
import type { CampusFit } from "@/lib/domain/campus-fit";
import type { BreakdownPart } from "@/lib/domain/match";
import { BURDEN_LABEL, LEVEL_LABEL, type PhysicalFlag, type PhysicalLevel } from "@/lib/domain/physical";
import { Chip, Label, cx } from "./ui";

/** Where every point of the score came from. The bars are the real fractions; the words say why. The parts sum to the score. */
export function ScoreBreakdown({ parts, score, title = "How the score adds up" }: { parts: (Omit<BreakdownPart, "key"> & { key: string })[]; score: number; title?: string }) {
  return (
    <div className="flex flex-col gap-4 border-t-[0.5px] border-hairline-strong pt-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label>{title}</Label>
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

/**
 * Campus fit: how this on-campus job lines up with the student's own preferences (role type, stated pay, physical demand,
 * hours, a verified listing, the deadline). A ranking aid with its arithmetic shown — never a hiring prediction, and
 * separate from eligibility, which is shown on its own.
 */
export function CampusFitPanel({ fit, physical, flags }: { fit: CampusFit; physical: PhysicalLevel; flags: PhysicalFlag[] }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Label>Campus fit</Label>
          <p className="text-[22px] leading-tight tracking-[-0.02em]">{fit.score >= 75 ? "Strong fit for what you asked for" : fit.score >= 55 ? "Reasonable fit" : "Weak fit for your preferences"}</p>
          <p className="max-w-[60ch] text-[12.5px] leading-snug text-dim">An estimate built from your campus preferences and what the listing states. It is not a prediction that you will be hired.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cx("num font-mono text-[40px] font-light leading-none", fit.score >= 75 ? "text-moss" : "text-text")}>{fit.score}</span>
          <span className="label">of 100</span>
        </div>
      </div>
      {(fit.reasons.length > 0 || fit.cautions.length > 0) && (
        <div className="grid gap-6 sm:grid-cols-2">
          <ul className="flex flex-col gap-2">
            {fit.reasons.map((r) => <li key={r} className="flex items-start gap-2.5 text-[13.5px]"><Check size={14} strokeWidth={2.4} className="mt-[3px] shrink-0 text-moss" />{r}</li>)}
          </ul>
          <ul className="flex flex-col gap-2">
            {fit.cautions.map((c) => <li key={c} className="flex items-start gap-2.5 text-[13.5px]"><AlertTriangle size={14} strokeWidth={2} className="mt-[3px] shrink-0 text-amber" />{c}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Label>Physical demand</Label>
        <Chip tone={physical === "low" ? "moss" : physical === "unknown" ? "neutral" : "amber"}>{LEVEL_LABEL[physical]}</Chip>
        {flags.map((f) => <span key={f.kind} className="text-muted">{BURDEN_LABEL[f.kind]}: “{f.text}”</span>)}
      </div>
      <ScoreBreakdown parts={fit.parts} score={fit.score} title="How the fit adds up" />
    </div>
  );
}
