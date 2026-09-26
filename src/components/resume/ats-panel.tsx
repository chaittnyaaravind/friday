"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { AtsAnalysis } from "@/lib/ai/resume";
import { analyzeAts, type AtsComponent, type Rating } from "@/lib/resume/ats";
import type { LineRef } from "@/lib/resume/edits";
import { matchJob } from "@/lib/resume/jobmatch";
import type { ResumeDoc } from "@/lib/resume/types";
import { api } from "../actions";
import { Button, Card, Chip, Label, cx } from "../ui";

const TONE: Record<Rating, { text: string; bar: string; chip: "moss" | "amber" | "accent" }> = {
  Good: { text: "text-moss", bar: "bg-moss", chip: "moss" },
  Fair: { text: "text-amber", bar: "bg-amber", chip: "amber" },
  "Needs work": { text: "text-accent", bar: "bg-accent", chip: "accent" },
};

export function AtsPanel({ doc, jd, configured, onSelect }: { doc: ResumeDoc; jd: string; configured: boolean; onSelect: (ref: LineRef) => void }) {
  const deferred = useDeferredValue(doc);
  const deferredJd = useDeferredValue(jd);
  const report = useMemo(() => analyzeAts(deferred, { match: deferredJd.trim().length >= 20 ? matchJob(deferred, deferredJd) : null }), [deferred, deferredJd]);
  const [plan, setPlan] = useState<AtsAnalysis["plan"]>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ ats: AtsAnalysis }>("/api/resumes/ai", { method: "POST", json: { op: "ats", doc, jd: jd.trim() || undefined, explain: true } });
      setPlan(r.ats.plan ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tone = TONE[report.rating];
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex items-center gap-5 p-5">
        <div className="relative size-[88px] shrink-0" role="img" aria-label={`ATS score ${report.score} out of 100, ${report.rating}`}>
          <svg viewBox="0 0 80 80" className="size-full -rotate-90">
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="5" className="stroke-[rgb(var(--ink)/.1)]" />
            <circle cx="40" cy="40" r={R} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - report.score / 100)} className={cx("transition-[stroke-dashoffset] duration-700 ease-[var(--ease-out)]", tone.text, "stroke-current")} />
          </svg>
          <span className="num absolute inset-0 grid place-items-center text-[26px] leading-none">{report.score}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2"><Label>ATS score</Label><Chip tone={tone.chip}>{report.rating}</Chip></span>
          <p className="text-[12.5px] leading-snug text-muted">{report.basis}</p>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        {report.summary.map((s) => (
          <div key={s.label} className="card flex flex-col gap-1 p-3">
            <span className="label">{s.label}</span>
            <span className="text-[14px] leading-snug">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {report.components.map((c) => <Component key={c.id} c={c} onSelect={onSelect} />)}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <Label>Fix order</Label>
        <p className="text-[12.5px] leading-snug text-muted">Every fix above comes from the checks. AI can only rank them — it can&rsquo;t add new advice.</p>
        <div><Button size="sm" variant="secondary" disabled={!configured || busy} onClick={explain}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Prioritize with AI</Button></div>
        {!configured && <p className="text-[12px] text-dim">Needs a free API key on the server (GROQ_API_KEY or GEMINI_API_KEY).</p>}
        {err && <p className="text-[12.5px] text-accent">{err}</p>}
        {plan && (plan.length ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-snug">
            {plan.map((p, i) => <li key={i}><span className="text-text">{p.fix.message}</span><br /><span className="text-[12px] text-dim">{p.why}</span></li>)}
          </ol>
        ) : <p className="text-[13px] text-muted">Nothing to prioritize — no fixes were found.</p>)}
      </Card>
    </div>
  );
}

function Component({ c, onSelect }: { c: AtsComponent; onSelect: (ref: LineRef) => void }) {
  const tone = TONE[c.rating];
  return (
    <details className="card group p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none flex-col gap-2">
        <span className="flex items-center gap-3">
          <span className="text-[14px] font-medium">{c.label}</span>
          <span className="label">weight {c.weight}</span>
          <span className={cx("num ml-auto font-mono text-[14px]", tone.text)}>{c.score}</span>
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-[rgb(var(--ink)/.08)]"><span className={cx("block h-full rounded-full", tone.bar)} style={{ width: `${c.score}%` }} /></span>
        <span className="text-[12.5px] leading-snug text-muted">{c.reason}</span>
      </summary>
      {(c.details.length > 0 || c.fixes.length > 0) && (
        <div className="mt-3 flex flex-col gap-3 border-t-[0.5px] border-hairline-strong pt-3">
          {c.details.length > 0 && <ul className="flex flex-col gap-0.5 text-[12px] leading-snug text-dim">{c.details.map((d) => <li key={d}>{d}</li>)}</ul>}
          {c.fixes.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {c.fixes.map((f, i) => (
                <li key={i}>
                  {f.ref ? <button type="button" onClick={() => onSelect(f.ref!)} className="text-left text-[12.5px] leading-snug text-text underline decoration-hairline-strong underline-offset-2 hover:decoration-accent">{f.message}</button> : <span className="text-[12.5px] leading-snug text-text">{f.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
