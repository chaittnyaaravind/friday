"use client";

import { Redo2, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { findLine, type LineRef } from "@/lib/resume/edits";
import { hasChanged, userEditLabel } from "@/lib/resume/history";
import type { TemplateId } from "@/lib/resume/templates";
import type { ResumeDoc } from "@/lib/resume/types";
import type { Issue } from "@/lib/resume/validate";
import { api } from "../actions";
import { Card, Input, cx } from "../ui";
import { AiPanel } from "./ai-panel";
import { AtsPanel } from "./ats-panel";
import { EditForm } from "./edit-form";
import { ExportPanel } from "./export-panel";
import { HistoryPanel } from "./history-panel";
import { InlineActions } from "./inline-actions";
import { JobMatchPanel } from "./job-match";
import { ResumePreview } from "./preview";
import { useResumeAi, type RevisionInput } from "./use-resume-ai";

type Verification = { ok: boolean; issues: Issue[] } | null;
type Tab = "resume" | "ai" | "match" | "ats" | "versions" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "resume", label: "Resume" },
  { id: "ai", label: "AI Editor" },
  { id: "match", label: "Job Match" },
  { id: "ats", label: "ATS" },
  { id: "versions", label: "Versions" },
  { id: "export", label: "Export" },
];

type Props = {
  id: string;
  label: string;
  initial: ResumeDoc;
  verification: Verification;
  readOnly?: boolean;
  template?: TemplateId;
  aiConfigured?: boolean;
  providers?: string[];
  /** The version row's updated_at when the page loaded — the base every save is checked against. */
  updatedAt?: string;
};

/**
 * The resume workspace: the document on the left (click a bullet for AI actions), and on the right
 * the editing form, AI editor, job match, ATS check, version history and export. Every change is
 * undoable, autosaved and re-verified by the server; accepted AI edits are recorded in history.
 */
export function ResumeEditor({ id, label: initialLabel, initial, verification: initialVerification, readOnly, template: initialTemplate = "classic", aiConfigured = false, providers = [], updatedAt }: Props) {
  const [doc, setDoc] = useState(initial);
  const [past, setPast] = useState<ResumeDoc[]>([]);
  const [future, setFuture] = useState<ResumeDoc[]>([]);
  const [label, setLabel] = useState(initialLabel);
  const [savedLabel, setSavedLabel] = useState(initialLabel);
  const [status, setStatus] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [verification, setVerification] = useState<Verification>(initialVerification);
  const [tab, setTab] = useState<Tab>("resume");
  const [view, setView] = useState<"preview" | "panel">("preview");
  const [selected, setSelected] = useState<LineRef | null>(null);
  const [template, setTemplateState] = useState<TemplateId>(initialTemplate);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [revTick, setRevTick] = useState(0);
  const [jd, setJd] = useState(() => {
    try { return typeof window === "undefined" ? "" : localStorage.getItem(`friday:jd:${id}`) ?? ""; } catch { return ""; }
  });
  const dirty = useRef(false);
  const lastRev = useRef<ResumeDoc | null>(initial);
  // Saving: one request in flight at a time, always the newest state, checked against the row version we last saw.
  const baseRef = useRef<string | null>(updatedAt ?? null);
  const savedDoc = useRef<ResumeDoc>(initial);
  const latestDoc = useRef<ResumeDoc>(initial);
  const inFlight = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(`friday:jd:${id}`, jd); } catch { /* private mode: the JD just isn't remembered */ }
  }, [id, jd]);

  const update = useCallback((fn: (d: ResumeDoc) => ResumeDoc | void) => {
    dirty.current = true;
    setPast((p) => [...p.slice(-80), doc]);
    setFuture([]);
    const next = structuredClone(doc);
    setDoc((fn(next) as ResumeDoc | undefined) ?? next);
  }, [doc]);

  /** Replace the whole document (AI accept, restore) — still one undo step. */
  const replaceDoc = useCallback((next: ResumeDoc) => {
    dirty.current = true;
    setPast((p) => [...p.slice(-80), doc]);
    setFuture([]);
    setDoc(next);
  }, [doc]);

  const undo = useCallback(() => {
    if (!past.length) return;
    dirty.current = true;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, doc]);

  const redo = useCallback(() => {
    if (!future.length) return;
    dirty.current = true;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, doc]);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; // let text fields undo their own typing
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, readOnly]);

  useEffect(() => { latestDoc.current = doc; }, [doc]);

  /**
   * Persist the newest state. Only one PATCH is ever in flight: if more edits arrive while it is, the loop sends the
   * newest afterwards — so an older save can never land after (and overwrite) a newer one. The server also rejects a save
   * whose base version is stale (409), which covers a second tab. We only say "saved" when the server confirmed the newest state.
   */
  const flush = useCallback(async () => {
    if (inFlight.current || readOnly) return;
    inFlight.current = true;
    try {
      for (;;) {
        const sending = latestDoc.current;
        if (sending === savedDoc.current) break;
        const r = await api<{ version: { updated_at: string }; verification: Verification }>(`/api/resumes/versions/${id}`, { method: "PATCH", json: { content: sending, baseUpdatedAt: baseRef.current ?? undefined } });
        baseRef.current = r.version.updated_at;
        savedDoc.current = sending;
        setVerification(r.verification);
      }
      setStatus("saved");
      setSaveError(null);
    } catch (e) {
      const err = e as Error & { status?: number };
      setSaveError(err.message);
      if (err.status === 409 && /changed somewhere else/i.test(err.message)) {
        setConflict(true);
        setStatus("conflict");
      } else {
        setStatus("error");
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => void flush(), 6000); // network/server hiccup: try again, and keep saying so
      }
    } finally {
      inFlight.current = false;
    }
  }, [id, readOnly]);

  // Debounced autosave trigger.
  useEffect(() => {
    if (readOnly || conflict || !dirty.current || doc === savedDoc.current) return;
    setStatus("saving");
    const t = setTimeout(() => void flush(), 700);
    return () => clearTimeout(t);
  }, [doc, readOnly, conflict, flush]);
  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  /** Someone (another tab) saved a newer version. Either take theirs, or deliberately overwrite with ours. */
  const resolveConflict = async (mode: "load" | "keep") => {
    try {
      const r = await api<{ version: { content: ResumeDoc; updated_at: string }; verification: Verification }>(`/api/resumes/versions/${id}`);
      baseRef.current = r.version.updated_at;
      if (mode === "load") {
        savedDoc.current = r.version.content;
        lastRev.current = r.version.content;
        dirty.current = false;
        setPast([]);
        setFuture([]);
        setDoc(r.version.content);
        setVerification(r.verification);
      }
      setConflict(false);
      setSaveError(null);
      setStatus(mode === "load" ? "saved" : "saving");
      if (mode === "keep") void flush();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };

  /** Append a history entry. Failure never blocks editing — history is a safety net, not a gate. */
  const recordRevision = useCallback(async (content: ResumeDoc, rev: RevisionInput) => {
    try {
      await api(`/api/resumes/versions/${id}/revisions`, { method: "POST", json: { label: rev.label, source: rev.source, content, trace: rev.trace } });
      lastRev.current = content;
      setRevTick((t) => t + 1);
      setHistoryNote(null);
    } catch {
      setHistoryNote("That change was applied, but history couldn't record it (has migration 0006 been applied?).");
    }
  }, [id]);

  // A settled run of the user's own edits becomes one history entry ("Edited Projects").
  useEffect(() => {
    if (readOnly || status !== "saved" || !dirty.current || !hasChanged(lastRev.current, doc)) return;
    const t = setTimeout(() => {
      const prev = lastRev.current;
      void recordRevision(doc, { label: prev ? userEditLabel(prev, doc) : "Edited resume", source: "user" });
    }, 8000);
    return () => clearTimeout(t);
  }, [doc, status, readOnly, recordRevision]);

  const commit = useCallback((next: ResumeDoc, rev: RevisionInput) => {
    replaceDoc(next);
    lastRev.current = next; // the AI revision below is the record of this state; don't also log it as a user edit
    void recordRevision(next, rev);
  }, [replaceDoc, recordRevision]);

  const openAi = useCallback(() => { setTab("ai"); setView("panel"); }, []);
  const ai = useResumeAi({ doc, jd, configured: aiConfigured, commit, onProposal: openAi });

  const select = useCallback((ref: LineRef | null) => setSelected(ref), []);
  const selectFromPanel = useCallback((ref: LineRef) => {
    setSelected(ref);
    setView("preview");
    requestAnimationFrame(() => document.querySelector('[aria-label="Resume preview"] [aria-pressed="true"]')?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, []);
  const selectedRef = selected && findLine(doc, selected) ? selected : null;

  const rename = async () => {
    const next = label.trim();
    if (!next || next === savedLabel) return setLabel(savedLabel);
    await api<{ version: { updated_at: string } }>(`/api/resumes/versions/${id}`, { method: "PATCH", json: { label: next } })
      .then((r) => { baseRef.current = r.version.updated_at; setSavedLabel(next); })
      .catch(() => setLabel(savedLabel));
  };

  const setTemplate = async (t: TemplateId) => {
    const prev = template;
    setTemplateState(t);
    setTemplateError(null);
    try {
      const r = await api<{ version: { updated_at: string } }>(`/api/resumes/versions/${id}`, { method: "PATCH", json: { template: t } });
      baseRef.current = r.version.updated_at;
    } catch {
      setTemplateState(prev);
      setTemplateError("Couldn't save the template choice (has migration 0006 been applied?). Exports can still use any template.");
    }
  };

  const onRestored = useCallback((content: ResumeDoc, v: Verification, restoredAt?: string) => {
    if (restoredAt) baseRef.current = restoredAt;
    savedDoc.current = content; // the server already holds exactly this state
    replaceDoc(content);
    lastRev.current = content;
    setVerification(v);
    setSelected(null);
  }, [replaceDoc]);

  const optimizeSkills = () => {
    const s = doc.sections.find((k) => k.kind === "skills");
    if (s) { void ai.skills(s.id); openAi(); }
  };

  const previewDoc = { ...doc, header: { ...doc.header, contact: doc.header.contact.filter((c) => c.trim()) } };

  return (
    <div className="flex flex-col gap-5">
      {/* Glass navigation */}
      <div className="sticky top-[4.25rem] z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[22px] bg-glass p-2 pl-3 backdrop-blur-xl backdrop-saturate-150 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] md:top-3">
        <div className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none sm:shrink-0">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} disabled={readOnly} aria-label="Version name" className="h-9 !bg-transparent px-2 text-[14px] font-medium !shadow-none" />
        </div>
        <nav role="tablist" aria-label="Editor sections" className="order-last flex min-w-0 basis-full items-center gap-0.5 overflow-x-auto sm:order-none sm:flex-1 sm:basis-0">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => { setTab(t.id); setView("panel"); }} className={cx("relative h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150", on ? "text-bg" : "text-muted hover:text-text")}>
                {on && <motion.span layoutId="editor-tab" className="absolute inset-0 rounded-full bg-text" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <span className="relative">{t.label}</span>
                {t.id === "ai" && ai.pending.length > 0 && <span className="relative ml-1.5 inline-grid min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] text-accent-ink">{ai.pending.length}</span>}
              </button>
            );
          })}
        </nav>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!past.length || readOnly} aria-label="Undo" title="Undo (⌘Z)" className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-[rgb(var(--ink)/.08)] hover:text-text disabled:opacity-30"><Undo2 size={15} /></button>
          <button type="button" onClick={redo} disabled={!future.length || readOnly} aria-label="Redo" title="Redo (⌘⇧Z)" className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-[rgb(var(--ink)/.08)] hover:text-text disabled:opacity-30"><Redo2 size={15} /></button>
          <span role="status" className={cx("w-[7.5rem] pr-2 text-right text-[12px]", status === "saved" || readOnly ? "hidden text-dim xl:block" : "block", status === "error" || status === "conflict" ? "font-medium text-accent" : "text-dim")} aria-live="polite">{readOnly ? "Read-only" : status === "saving" ? "Saving…" : status === "error" ? "Not saved — retrying" : status === "conflict" ? "Not saved" : "All changes saved"}</span>
        </div>
      </div>

      {status === "error" && (
        <Card role="alert" className="flex flex-col gap-1 p-4 [box-shadow:inset_0_0_0_0.5px_var(--accent)]">
          <p className="flex items-center gap-2 text-[14px] text-accent"><TriangleAlert size={15} /> Your latest changes are NOT saved yet.</p>
          <p className="text-[12.5px] text-muted">{saveError ?? "The save failed."} FRIDAY will keep retrying while this page is open; don&rsquo;t close it, and export stays off until it&rsquo;s saved.</p>
        </Card>
      )}
      {status === "conflict" && (
        <Card role="alert" className="flex flex-col gap-3 p-4 [box-shadow:inset_0_0_0_0.5px_var(--accent)]">
          <p className="flex items-center gap-2 text-[14px] text-accent"><TriangleAlert size={15} /> This resume changed in another tab or window.</p>
          <p className="text-[12.5px] text-muted">To avoid overwriting newer edits, saving is paused. Your edits in this tab are not saved.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void resolveConflict("load")} className="h-9 rounded-full bg-text px-4 text-[13px] font-medium text-bg">Load the latest version (discard my edits here)</button>
            <button type="button" onClick={() => void resolveConflict("keep")} className="h-9 rounded-full px-4 text-[13px] hairline hover:bg-surface-2">Keep my version (overwrite the other)</button>
          </div>
        </Card>
      )}
      {historyNote && <p className="text-[12.5px] text-amber">{historyNote}</p>}
      {verification && (verification.ok ? (
        <p className="flex items-center gap-2 text-[13px] text-moss"><ShieldCheck size={15} /> Verified — every line comes from your confirmed profile or was written or confirmed by you.</p>
      ) : (
        <Card className="flex flex-col gap-2 p-4 [box-shadow:inset_0_0_0_0.5px_var(--amber)]">
          <p className="flex items-center gap-2 text-[14px] text-amber"><TriangleAlert size={15} /> Export is paused until these are fixed:</p>
          <ul className="flex flex-col gap-1 text-[12.5px] text-muted">
            {verification.issues.slice(0, 8).map((i, k) => <li key={k}><span className="text-text">{i.where}:</span> “{i.claim}” — {i.reason}</li>)}
          </ul>
        </Card>
      ))}

      <div className="flex gap-1 lg:hidden" role="tablist" aria-label="Preview or panel">
        {(["preview", "panel"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("h-9 flex-1 rounded-full text-[13px]", view === v ? "bg-text text-bg" : "text-muted hairline")}>{v === "preview" ? "Document" : TABS.find((t) => t.id === tab)!.label}</button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        <div className={cx("lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7.5rem)] lg:self-start lg:overflow-y-auto lg:overflow-x-visible lg:pb-10 lg:pr-1", view === "panel" && "max-lg:hidden")}>
          <ResumePreview
            doc={previewDoc}
            template={template}
            selected={selectedRef?.lineId ?? null}
            onSelect={readOnly ? undefined : select}
            renderActions={(ref, kind) => <InlineActions ai={ai} target={ref} kind={kind} onClose={() => setSelected(null)} />}
          />
          {!readOnly && <p className="mt-3 text-center text-[12px] text-dim">Click any bullet to improve it. A dot marks lines rewritten with AI.</p>}
        </div>

        <div className={cx("min-w-0", view === "preview" && "max-lg:hidden")} role="tabpanel">
          {tab === "resume" && <EditForm doc={doc} readOnly={readOnly} update={update} selected={selectedRef?.lineId ?? null} onSelect={select} />}
          {tab === "ai" && <AiPanel doc={doc} ai={ai} providers={providers} selected={selectedRef} onSelect={selectFromPanel} onOpenMatch={() => { setTab("match"); setView("panel"); }} />}
          {tab === "match" && <JobMatchPanel doc={doc} jd={jd} setJd={setJd} configured={aiConfigured} onSelect={selectFromPanel} onOptimizeSkills={optimizeSkills} />}
          {tab === "ats" && <AtsPanel doc={doc} jd={jd} configured={aiConfigured} onSelect={selectFromPanel} />}
          {tab === "versions" && <HistoryPanel versionId={id} doc={doc} tick={revTick} readOnly={readOnly} onRestored={onRestored} />}
          {tab === "export" && <ExportPanel id={id} doc={doc} template={template} setTemplate={setTemplate} verification={verification} saved={status === "saved"} readOnly={readOnly} templateError={templateError} />}
        </div>
      </div>
    </div>
  );
}
