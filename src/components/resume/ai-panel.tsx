"use client";

import { Briefcase, Loader2, ScanSearch, Send, Sparkles, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { analyzeDocument, CATEGORY_LABEL, type AnalysisCategory } from "@/lib/resume/analysis";
import { findLine, type LineRef } from "@/lib/resume/edits";
import type { ResumeDoc } from "@/lib/resume/types";
import { Button, Card, Chip, Label, Notice, Textarea, cx } from "../ui";
import { OpButtons } from "./inline-actions";
import { ProposalCard } from "./suggestion-card";
import type { ResumeAi } from "./use-resume-ai";

const EXAMPLES = [
  "Make my experience section stronger.",
  "Find weak bullets.",
  "Find repeated words.",
  "Shorten this bullet.",
  "Make this suitable for a software engineering internship.",
  "Find missing technologies.",
  "Compare this resume against the job description.",
];

const TONE: Record<AnalysisCategory, "amber" | "neutral" | "accent"> = {
  weak: "amber", repetitive: "neutral", vague: "amber", missing_context: "neutral", formatting: "neutral",
  too_long: "neutral", too_short: "neutral", unclear_technical: "amber", missing_evidence: "accent",
};

export function AiPanel({ doc, ai, providers, selected, onSelect, onOpenMatch }: { doc: ResumeDoc; ai: ResumeAi; providers: string[]; selected: LineRef | null; onSelect: (ref: LineRef) => void; onOpenMatch: () => void }) {
  const [draft, setDraft] = useState("");
  const [analyzed, setAnalyzed] = useState(false);
  const [open, setOpen] = useState<AnalysisCategory | null>(null);
  // Recommendations are deterministic and instant; they update live as the document changes. Nothing is rewritten.
  const local = useMemo(() => (analyzed ? analyzeDocument(doc) : null), [analyzed, doc]);
  const at = selected ? findLine(doc, selected) : null;
  const skillsSection = doc.sections.find((s) => s.kind === "skills");

  const send = (text: string) => {
    const t = text.trim();
    if (!t || ai.busy) return;
    setDraft("");
    ai.ask(t, selected);
  };
  const analyze = () => {
    setAnalyzed(true);
    void ai.analyze(); // adds Nemotron's narrative overview when AI is configured; the findings below don't depend on it
  };

  return (
    <div className="flex flex-col gap-5">
      {ai.configured ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted"><span className="size-1.5 rounded-full bg-moss" /> AI is on{providers.length ? <> via {providers.join(" → ")}</> : null}. It can reword — never add a fact.</p>
      ) : (
        <Notice tone="amber" title="AI rewriting isn't configured">
          Add <code className="font-mono text-[12px]">NVIDIA_API_KEY</code>, <code className="font-mono text-[12px]">GROQ_API_KEY</code> or <code className="font-mono text-[12px]">GEMINI_API_KEY</code> on the server to enable rewrites, summaries and the assistant. Grammar cleanup, Quantify&rsquo;s questions, the resume analysis, ATS scoring and job matching work without it.
        </Notice>
      )}

      {ai.error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-amber-soft p-3 text-[13px] leading-snug text-amber">
          <TriangleAlert size={15} className="mt-px shrink-0" />
          <span className="flex-1">{ai.error.message}</span>
          <button type="button" onClick={ai.clearError} className="text-[12px] underline-offset-2 hover:underline">Dismiss</button>
        </div>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <Label>Selected line</Label>
        {at ? (
          <>
            <p className="rounded-xl bg-surface-2 p-3 text-[13px] leading-relaxed text-muted">{at.line.text || <em>Empty line</em>}</p>
            <div className="flex flex-wrap gap-1.5"><OpButtons ai={ai} target={selected!} kind={at.section.kind} size="md" /></div>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">Click any bullet in the preview to improve, shorten, clarify, quantify or reword it.</p>
        )}
        <div className="flex flex-wrap gap-1.5 border-t-[0.5px] border-hairline-strong pt-3">
          <Button size="sm" variant="secondary" onClick={analyze}>{ai.busy === "analyze" ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />} Analyze resume</Button>
          <Button size="sm" variant="secondary" onClick={onOpenMatch}><Briefcase size={13} /> Match to job</Button>
          <Button size="sm" variant="secondary" disabled={!!ai.busy} onClick={() => ai.summary()}><Sparkles size={13} /> {ai.busy === "summary" ? "Writing…" : "Professional summary"}</Button>
          {skillsSection && <Button size="sm" variant="secondary" disabled={!!ai.busy} onClick={() => ai.skills(skillsSection.id)}>{ai.busy === "skills" ? "Working…" : "Optimize skills"}</Button>}
        </div>
      </Card>

      {local && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <Label>Resume analysis · {local.items.length} recommendation{local.items.length === 1 ? "" : "s"}</Label>
            <button type="button" onClick={() => setAnalyzed(false)} className="text-[12px] text-dim hover:text-text">Hide</button>
          </div>
          <p className="text-[12.5px] leading-snug text-muted">Recommendations only — nothing is changed until you choose a bullet and accept a suggestion.</p>
          {!local.items.length && <p className="text-[13px] text-muted">Nothing to flag — no weak, vague or inconsistent spots found.</p>}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABEL) as AnalysisCategory[]).filter((c) => local.counts[c] > 0).map((c) => (
              <button key={c} type="button" onClick={() => setOpen(open === c ? null : c)} aria-pressed={open === c}>
                <Chip tone={open === c ? "accent" : TONE[c]}>{CATEGORY_LABEL[c]} <span className="num font-mono">{local.counts[c]}</span></Chip>
              </button>
            ))}
          </div>
          {(open ? local.items.filter((i) => i.category === open) : local.items).slice(0, open ? 30 : 8).map((i, k) => (
            <div key={k} className="flex flex-col gap-1.5 rounded-xl p-3 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
              <span className="flex items-center gap-2"><Chip tone={TONE[i.category]}>{CATEGORY_LABEL[i.category]}</Chip>{i.where && <span className="label truncate">{i.where}</span>}</span>
              <span className="text-[13px] font-medium leading-snug">{i.title}</span>
              {i.detail && i.detail !== i.title && <span className="text-[12.5px] leading-snug text-muted">{i.detail}</span>}
              <span className="text-[12px] leading-snug text-dim">{i.suggestion}</span>
              {i.ref && findLine(doc, i.ref) && <button type="button" onClick={() => onSelect(i.ref!)} className="w-fit text-[12px] text-accent underline-offset-2 hover:underline">Select this line</button>}
            </div>
          ))}
          {!open && local.items.length > 8 && <p className="text-[12px] text-dim">Showing 8 of {local.items.length} — tap a category above to see them all.</p>}
          {ai.analysis?.overview && ai.analysis.overview.length > 0 && (
            <div className="flex flex-col gap-2 border-t-[0.5px] border-hairline-strong pt-3">
              <Label>AI overview</Label>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-snug text-muted">{ai.analysis.overview.map((p, k) => <li key={k}>{p.text}{p.where ? <span className="text-dim"> — {p.where}</span> : null}</li>)}</ul>
              <p className="text-[11.5px] text-dim">Written by Nemotron from your resume only; it can&rsquo;t change your resume.</p>
            </div>
          )}
        </Card>
      )}

      <AnimatePresence initial={false}>
        {ai.pending.map((p) => (
          <motion.div key={p.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}>
            <ProposalCard
              proposal={p}
              busy={!!ai.busy}
              onAccept={(text, how, s) => ai.accept(p.id, text, how, s)}
              onDismiss={() => ai.dismiss(p.id)}
              onQuantify={p.target.kind === "line" ? (fact) => ai.edit("quantify", { sectionId: p.target.kind === "line" ? p.target.sectionId : "", entryId: p.target.kind === "line" ? p.target.entryId : null, lineId: p.target.kind === "line" ? p.target.lineId : "" }, fact) : undefined}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      <Card className="flex flex-col gap-3 p-4">
        <Label>Resume assistant</Label>
        {ai.messages.length === 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => <button key={e} type="button" disabled={!!ai.busy} onClick={() => send(e)} className="rounded-full px-3 py-1.5 text-left text-[12.5px] text-muted transition-colors hover:bg-surface-2 hover:text-text [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">{e}</button>)}
          </div>
        ) : (
          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
            {ai.messages.map((m) => (
              <div key={m.id} className={cx("flex flex-col gap-2", m.role === "user" && "items-end")}>
                <p className={cx("max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed", m.role === "user" ? "bg-accent text-accent-ink" : "bg-surface-2")}>{m.text}</p>
                {m.proposalIds && m.proposalIds.length > 0 && <p className="label">{m.proposalIds.length} suggestion{m.proposalIds.length === 1 ? "" : "s"} above — accept, edit or reject each</p>}
                {m.findings && m.findings.length > 0 && (
                  <div className="flex w-full flex-col gap-1.5">
                    {m.findings.slice(0, 6).map((f) => (
                      <button key={f.ref.lineId} type="button" onClick={() => onSelect(f.ref)} className="rounded-xl p-2.5 text-left text-[12.5px] leading-snug transition-colors hover:bg-surface-2 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
                        <span className="text-text">{f.text}</span><br /><span className="text-dim">{f.issues[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
                {m.repeats && m.repeats.length > 0 && <div className="flex flex-wrap gap-1.5">{m.repeats.map((r) => <Chip key={r.word + r.kind}>{r.word} ×{r.count}</Chip>)}</div>}
              </div>
            ))}
            {ai.busy === "chat" && <p className="label">Working…</p>}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="flex items-end gap-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} rows={2} maxLength={500} placeholder={selected ? "Ask about the selected bullet, or the whole resume…" : "Ask about your resume…"} className="min-h-12 flex-1 text-[13.5px]" aria-label="Message the resume assistant" />
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim() || !!ai.busy} aria-label="Send"><Send size={14} /></Button>
        </form>
        {ai.messages.length > 0 && <p className="text-[11.5px] leading-snug text-dim">Edits come back as suggestions you accept or reject. The assistant never adds numbers, tools or claims your resume doesn&rsquo;t already state.</p>}
      </Card>
    </div>
  );
}
