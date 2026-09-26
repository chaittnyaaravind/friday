"use client";

import { Check, Download, ShieldAlert } from "lucide-react";
import { useDeferredValue, useMemo, type ReactNode } from "react";
import { analyzeAts } from "@/lib/resume/ats";
import { TEMPLATES, type TemplateId } from "@/lib/resume/templates";
import type { ResumeDoc } from "@/lib/resume/types";
import type { Issue } from "@/lib/resume/validate";
import { Card, Label, cx } from "../ui";
import { ResumePreview } from "./preview";

type Verification = { ok: boolean; issues: Issue[] } | null;

/**
 * Template choice (presentation only — the words never change) and PDF/DOCX export. Export stays
 * off until the document is saved and every non-user line is backed by the confirmed profile.
 */
export function ExportPanel({ id, doc, template, setTemplate, verification, saved, readOnly, templateError }: { id: string; doc: ResumeDoc; template: TemplateId; setTemplate: (t: TemplateId) => void; verification: Verification; saved: boolean; readOnly?: boolean; templateError?: string | null }) {
  const deferred = useDeferredValue(doc);
  const ats = useMemo(() => analyzeAts(deferred), [deferred]);
  const verified = verification ? verification.ok : true;
  const blocked = readOnly || !verified || !saved;
  const href = (f: "pdf" | "docx") => `/api/resumes/versions/${id}/export?format=${f}&template=${template}`;
  const current = TEMPLATES.find((t) => t.id === template)!;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <Label>Template</Label>
        <div role="radiogroup" aria-label="Resume template" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t) => {
            const on = t.id === template;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={on} disabled={readOnly} onClick={() => setTemplate(t.id)} className={cx("group flex flex-col gap-2 rounded-2xl p-2 text-left transition-[box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-0.5 disabled:pointer-events-none", on ? "bg-accent-soft [box-shadow:inset_0_0_0_1px_var(--accent)]" : "[box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)] hover:bg-surface-2")}>
                <span className="pointer-events-none block aspect-[8.5/11] overflow-hidden rounded-[4px]" aria-hidden>
                  <ResumePreview doc={deferred} template={t.id} />
                </span>
                <span className="flex items-center gap-1.5 px-1 text-[12.5px] font-medium">{on && <Check size={12} className="text-accent" />}{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[12.5px] leading-snug text-muted"><span className="text-text">{current.label}.</span> {current.blurb} Switching template never changes your words — only the look.</p>
        {templateError && <p className="text-[12.5px] text-accent">{templateError}</p>}
      </section>

      <Card className="flex flex-col gap-4 p-5">
        <Label>Export</Label>
        <ul className="flex flex-col gap-2 text-[13px]">
          <Check_ ok={saved} label={saved ? "All changes saved" : "Saving…"} />
          <Check_ ok={verified} label={verified ? "Every line is verified — from your confirmed profile or written by you" : `${verification?.issues.length} line${verification?.issues.length === 1 ? "" : "s"} need attention before export`} />
          <Check_ ok={ats.score >= 60} neutral label={`ATS check: ${ats.score}/100 · ${ats.rating}`} />
        </ul>
        {!verified && verification && (
          <ul className="flex flex-col gap-1 rounded-xl bg-amber-soft p-3 text-[12.5px] leading-snug text-amber">
            {verification.issues.slice(0, 6).map((i, k) => <li key={k}><span className="text-text">{i.where}:</span> “{i.claim}” — {i.reason}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <ExportLink href={href("pdf")} disabled={blocked} primary>PDF</ExportLink>
          <ExportLink href={href("docx")} disabled={blocked}>DOCX</ExportLink>
        </div>
        <p className="text-[12px] leading-snug text-dim">Single-column, real text, standard fonts — no images, tables or text boxes. PDF headings are not letter-spaced so parsers read them as words.</p>
      </Card>
    </div>
  );
}

function Check_({ ok, neutral, label }: { ok: boolean; neutral?: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2.5 leading-snug">
      <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full", ok ? "bg-moss-soft text-moss" : neutral ? "bg-amber-soft text-amber" : "bg-amber-soft text-amber")}>{ok ? <Check size={10} /> : <ShieldAlert size={10} />}</span>
      <span className="text-muted">{label}</span>
    </li>
  );
}

function ExportLink({ href, disabled, primary, children }: { href: string; disabled: boolean; primary?: boolean; children: ReactNode }) {
  const base = "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors";
  if (disabled) return <span aria-disabled className={cx(base, "cursor-not-allowed text-dim hairline")}><Download size={14} /> {children}</span>;
  return <a href={href} className={cx(base, primary ? "bg-accent text-accent-ink hover:bg-accent-hover" : "text-text hairline hover:bg-surface-2")}><Download size={14} /> {children}</a>;
}
