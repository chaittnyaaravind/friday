"use client";

import { Check, CircleHelp, Link2, Loader2, Sparkles } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { JobMatchResult, SemanticMatch } from "@/lib/ai/resume";
import type { LineRef } from "@/lib/resume/edits";
import { matchJob, type MatchStatus, type SkillMatch } from "@/lib/resume/jobmatch";
import type { ResumeDoc } from "@/lib/resume/types";
import { api } from "../actions";
import { Button, Card, Chip, Label, Textarea, cx } from "../ui";

type Tone = "moss" | "amber" | "neutral" | "accent";

// The four groups, in this order. "Relevant but unclear" holds skills used in a bullet but not listed, AND wording that is
// merely related by meaning — related is never treated as proof of a technology.
const GROUPS: { id: string; status: MatchStatus; title: string; blurb: string; tone: Tone }[] = [
  { id: "matched", status: "matched", title: "Matched", blurb: "Listed in Skills and shown in your work.", tone: "moss" },
  { id: "weak", status: "weak", title: "Weak evidence", blurb: "On your resume, but nothing shows you using it.", tone: "amber" },
  { id: "unclear", status: "unclear", title: "Relevant but unclear", blurb: "Used in a bullet but not listed — or similar wording that doesn't prove it.", tone: "neutral" },
  { id: "missing", status: "missing", title: "Missing", blurb: "Not on your resume. Only add what you genuinely have.", tone: "accent" },
];

export function JobMatchPanel({ doc, jd, setJd, configured, onSelect, onOptimizeSkills }: { doc: ResumeDoc; jd: string; setJd: (v: string) => void; configured: boolean; onSelect: (ref: LineRef) => void; onOptimizeSkills: () => void }) {
  const deferred = useDeferredValue(jd);
  const match = useMemo(() => (deferred.trim().length >= 20 ? matchJob(doc, deferred) : null), [doc, deferred]);
  const [ai, setAi] = useState<JobMatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const hasSkills = doc.sections.some((s) => s.kind === "skills");
  const semantic: SemanticMatch[] = ai?.semantic ?? [];

  const matchWithAi = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ match: JobMatchResult }>("/api/resumes/ai", { method: "POST", json: { op: "match", doc, jd, explain: true } });
      setAi(r.match);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4">
        <Label>Job description</Label>
        <Textarea value={jd} onChange={(e) => { setJd(e.target.value); setAi(null); }} rows={7} maxLength={20000} placeholder="Paste the job posting here — requirements, responsibilities, qualifications…" className="text-[13.5px]" aria-label="Job description" />
        <p className="text-[12px] leading-snug text-dim">The keyword match below runs in your browser as you type. Nothing leaves this device until you press “Match with AI”.</p>
      </Card>

      {!match ? (
        <p className="text-[13.5px] leading-relaxed text-muted">Paste a job description (at least a few lines) to see which of its requirements your resume already covers.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Skills present" value={match.coverage.present === null ? "—" : `${match.coverage.present}%`} />
            <Stat label="Shown in work" value={match.coverage.demonstrated === null ? "—" : `${match.coverage.demonstrated}%`} />
            <Stat label="Relevance" value={match.relevance.label} sub={match.relevance.pct === null ? undefined : `${match.relevance.bulletsWithMatch}/${match.relevance.bullets} bullets`} />
          </div>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={!configured || busy} onClick={matchWithAi}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Match with AI</Button>
              {hasSkills && <Button size="sm" variant="secondary" onClick={onOptimizeSkills}>Order my skills for this job</Button>}
            </div>
            <p className="text-[12px] leading-snug text-dim">Adds meaning-based matching (NVIDIA embeddings) on top of the keyword match, and a plain-language explanation (Nemotron). A skill you don&rsquo;t list is never treated as yours because the wording is similar.</p>
            {!configured && <p className="text-[12px] text-dim">Needs a free API key on the server (NVIDIA_API_KEY recommended). The keyword match works without it.</p>}
            {err && <p className="text-[12.5px] text-accent">{err}</p>}
            {ai?.explanation && (
              <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
                <Label>Explanation</Label>
                {ai.explanation.summary && <p className="text-[13.5px] leading-relaxed">{ai.explanation.summary}</p>}
                {ai.explanation.nextSteps.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {ai.explanation.nextSteps.map((s) => <li key={s.requirement} className="text-[12.5px] leading-snug text-muted"><span className="font-medium text-text">{s.requirement}</span> — {s.advice}</li>)}
                  </ul>
                )}
              </div>
            )}
            {ai && !ai.explanation && ai.via === "ai" && <p className="text-[12px] text-dim">No explanation was produced. The results below are still complete.</p>}
          </Card>

          {!match.skills.length && <p className="text-[13.5px] text-muted">No specific skills recognized in that text. Include the requirements section for a full comparison.</p>}

          {GROUPS.map((g) => {
            const items = match.skills.filter((s) => s.status === g.status);
            const related = g.id === "unclear" ? semantic : [];
            if (!items.length && !related.length) return null;
            return (
              <section key={g.id} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2"><Chip tone={g.tone}>{g.title}</Chip><span className="num font-mono text-[12px] text-dim">{items.length + related.length}</span></span>
                  <span className="text-right text-[12px] text-dim">{g.blurb}</span>
                </div>
                {items.map((s) => <SkillRow key={s.slug} s={s} onSelect={onSelect} />)}
                {related.map((s, i) => (
                  <div key={`${s.requirement}-${i}`} className="flex flex-col gap-1.5 rounded-xl p-3 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
                    <div className="flex items-center gap-2"><Link2 size={13} className="text-dim" /><span className="text-[13.5px] font-medium leading-snug">{s.requirement}</span>{s.score !== undefined && <span className="num ml-auto font-mono text-[11.5px] text-dim">{s.score.toFixed(2)} similar</span>}</div>
                    <p className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12.5px] leading-snug text-muted">“{s.quote}”</p>
                    <p className="text-[12px] leading-snug text-dim">{s.note}</p>
                  </div>
                ))}
              </section>
            );
          })}

          {match.keywords.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <Label>Domain keywords</Label>
              <div className="flex flex-wrap gap-1.5">
                {match.keywords.map((k) => <Chip key={k.term} tone={k.present ? "moss" : "neutral"} icon={k.present ? <Check size={11} /> : undefined}>{k.term}</Chip>)}
              </div>
              {match.keywords.some((k) => !k.present) && <p className="text-[12px] leading-snug text-dim">Grey keywords aren&rsquo;t on your resume. Use one only if it truthfully describes your work.</p>}
            </Card>
          )}

          {(match.education.length > 0 || match.jd.experience.length > 0 || match.jd.responsibilities.length > 0) && (
            <Card className="flex flex-col gap-3 p-4">
              {match.education.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>Education</Label>
                  {match.education.map((e) => (
                    <p key={e.requirement} className="flex items-start gap-2 text-[13px] leading-snug"><span className={cx("mt-0.5", e.found ? "text-moss" : "text-dim")}>{e.found ? <Check size={13} /> : <CircleHelp size={13} />}</span><span><span className="text-muted">{e.requirement}</span><br /><span className="text-[12px] text-dim">{e.found ? "Your education section shows this." : "Couldn't confirm from your education section."}</span></span></p>
                  ))}
                </div>
              )}
              {match.jd.experience.length > 0 && (
                <div className="flex flex-col gap-1"><Label>Experience asked for</Label>{match.jd.experience.map((x) => <p key={x} className="text-[13px] leading-snug text-muted">{x}</p>)}</div>
              )}
              {match.jd.responsibilities.length > 0 && (
                <details className="text-[13px]"><summary className="label cursor-pointer select-none">Responsibilities ({match.jd.responsibilities.length})</summary><ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-muted">{match.jd.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul></details>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <span className="label">{label}</span>
      <span className="num text-[20px] leading-none">{value}</span>
      {sub && <span className="text-[11.5px] text-dim">{sub}</span>}
    </div>
  );
}

function SkillRow({ s, onSelect }: { s: SkillMatch; onSelect: (ref: LineRef) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl p-3 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
      <div className="flex items-center gap-2"><span className="text-[14px] font-medium">{s.name}</span><span className="label">{s.kind}</span></div>
      <p className="text-[12.5px] leading-snug text-muted">{s.message}</p>
      {s.evidence.filter((e) => e.ref).slice(0, 2).map((e) => (
        <button key={e.ref!.lineId} type="button" onClick={() => onSelect(e.ref!)} className="truncate rounded-lg bg-surface-2 px-2.5 py-1.5 text-left text-[12px] text-dim transition-colors hover:text-text" title={e.where}>{e.text}</button>
      ))}
    </div>
  );
}
