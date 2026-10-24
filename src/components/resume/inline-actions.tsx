"use client";

import { Loader2, X } from "lucide-react";
import type { LineRef } from "@/lib/resume/edits";
import type { DocSection } from "@/lib/resume/types";
import { cx } from "../ui";
import type { EditKind, ResumeAi } from "./use-resume-ai";

export const BULLET_OPS: { kind: EditKind; label: string; /** works without an AI key */ local?: boolean }[] = [
  { kind: "improve", label: "Improve" },
  { kind: "shorten", label: "Shorten", local: true },
  { kind: "clearer", label: "Make clearer" },
  { kind: "technical", label: "Make technical" },
  { kind: "ats", label: "ATS optimize" },
  { kind: "humanize", label: "Sound human" },
  { kind: "grammar", label: "Fix grammar", local: true },
  { kind: "alternatives", label: "Generate alternatives" },
  { kind: "quantify", label: "Quantify", local: true },
];

/** Pill buttons that run one AI (or built-in) operation on the selected line. */
export function OpButtons({ ai, target, kind, size = "sm" }: { ai: ResumeAi; target: LineRef; kind: DocSection["kind"]; size?: "sm" | "md" }) {
  const skills = kind === "skills";
  const pill = cx("inline-flex items-center gap-1.5 rounded-full font-medium transition-[background-color,color,transform] duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-45", size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]");
  const tone = "bg-[rgb(var(--ink)/.08)] text-text hover:bg-[rgb(var(--ink)/.14)]";
  const local = !ai.configured;
  if (skills) {
    return (
      <button type="button" disabled={!!ai.busy} onClick={() => ai.skills(target.sectionId)} className={cx(pill, "bg-accent text-accent-ink hover:bg-accent-hover")}>
        {ai.busy === "skills" && <Loader2 size={12} className="animate-spin" />} Optimize skills
      </button>
    );
  }
  return (
    <>
      {BULLET_OPS.map((op) => {
        const needsAi = !op.local;
        return (
          <button key={op.kind} type="button" disabled={!!ai.busy} title={local && needsAi ? "Needs an AI key (NVIDIA_API_KEY, GROQ_API_KEY or GEMINI_API_KEY)" : undefined} onClick={() => ai.edit(op.kind, target)} className={cx(pill, tone, local && needsAi && "opacity-60")}>
            {ai.busy === `edit:${op.kind}` && <Loader2 size={12} className="animate-spin" />} {op.label}
          </button>
        );
      })}
    </>
  );
}

/** The floating bar under a clicked bullet in the preview (Liquid Glass). */
export function InlineActions({ ai, target, kind, onClose }: { ai: ResumeAi; target: LineRef; kind: DocSection["kind"]; onClose: () => void }) {
  return (
    <div role="toolbar" aria-label="AI actions for this line" className="flex max-w-[min(100%,34rem)] flex-wrap items-center gap-1 rounded-2xl bg-glass p-1.5 text-text backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),0_18px_40px_-16px_rgb(0_0_0/.55)]">
      <OpButtons ai={ai} target={target} kind={kind} />
      <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid size-7 place-items-center rounded-full text-dim hover:bg-[rgb(var(--ink)/.1)] hover:text-text"><X size={13} /></button>
    </div>
  );
}
