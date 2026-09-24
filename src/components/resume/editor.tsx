"use client";

import { ArrowDown, ArrowUp, Copy, Download, Plus, Redo2, ShieldCheck, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { randomId } from "@/lib/resume/ids";
import type { DocEntry, DocLine, DocSection, ResumeDoc } from "@/lib/resume/types";
import type { Issue } from "@/lib/resume/validate";
import { api } from "../actions";
import { Button, Card, Input, Label, Textarea, cx } from "../ui";
import { ResumePreview } from "./preview";

type Verification = { ok: boolean; issues: Issue[] } | null;

const swap = <T,>(list: T[], i: number, j: number) => {
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const LINE_KINDS = new Set(["skills", "coursework", "summary", "certifications", "awards"]);

/**
 * Split-screen resume editor. Every edit is undoable, autosaved, and re-verified by the
 * server — anything you type is marked as yours (origin "user"); export stays blocked while
 * any profile-sourced line makes a claim your confirmed facts don't support.
 */
export function ResumeEditor({ id, label: initialLabel, initial, verification: initialVerification, readOnly }: { id: string; label: string; initial: ResumeDoc; verification: Verification; readOnly?: boolean }) {
  const [doc, setDoc] = useState(initial);
  const [past, setPast] = useState<ResumeDoc[]>([]);
  const [future, setFuture] = useState<ResumeDoc[]>([]);
  const [label, setLabel] = useState(initialLabel);
  const [savedLabel, setSavedLabel] = useState(initialLabel);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [verification, setVerification] = useState<Verification>(initialVerification);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const dirty = useRef(false);

  const update = useCallback((fn: (d: ResumeDoc) => ResumeDoc | void) => {
    dirty.current = true;
    setPast((p) => [...p.slice(-80), doc]);
    setFuture([]);
    const next = structuredClone(doc);
    setDoc((fn(next) as ResumeDoc | undefined) ?? next);
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
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, readOnly]);

  // Debounced autosave; the server re-verifies every save.
  useEffect(() => {
    if (readOnly || !dirty.current) return;
    setStatus("saving");
    const t = setTimeout(async () => {
      try {
        const r = await api<{ verification: Verification }>(`/api/resumes/versions/${id}`, { method: "PATCH", json: { content: doc } });
        setVerification(r.verification);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, id, readOnly]);

  const rename = async () => {
    const next = label.trim();
    if (!next || next === savedLabel) return setLabel(savedLabel);
    await api(`/api/resumes/versions/${id}`, { method: "PATCH", json: { label: next } }).then(() => setSavedLabel(next)).catch(() => setLabel(savedLabel));
  };

  const sec = (sid: string, fn: (s: DocSection) => void) => update((d) => { const s = d.sections.find((x) => x.id === sid); if (s) fn(s); });
  const ent = (sid: string, eid: string, fn: (e: DocEntry) => void) => sec(sid, (s) => { const e = s.entries.find((x) => x.id === eid); if (e) fn(e); });

  const blocked = readOnly || (verification ? !verification.ok : false) || status !== "saved";
  const exportHref = (f: "pdf" | "docx") => `/api/resumes/versions/${id}/export?format=${f}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} disabled={readOnly} aria-label="Version name" className="h-10 min-w-[200px] flex-1 font-medium md:max-w-[340px]" />
        <Button size="sm" variant="ghost" onClick={undo} disabled={!past.length || readOnly} aria-label="Undo" title="Undo (⌘Z)"><Undo2 size={15} /></Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={!future.length || readOnly} aria-label="Redo" title="Redo (⌘⇧Z)"><Redo2 size={15} /></Button>
        <span className="text-[12px] text-dim" aria-live="polite">{readOnly ? "Read-only" : status === "saving" ? "Saving…" : status === "error" ? "Couldn't save — will retry on your next edit" : "All changes saved"}</span>
        <div className="ml-auto flex gap-2">
          <ExportLink href={exportHref("pdf")} disabled={blocked} primary>PDF</ExportLink>
          <ExportLink href={exportHref("docx")} disabled={blocked}>DOCX</ExportLink>
        </div>
      </div>

      {verification && (verification.ok ? (
        <p className="flex items-center gap-2 text-[13px] text-moss"><ShieldCheck size={15} /> Verified information only — every line comes from your confirmed profile or was written by you.</p>
      ) : (
        <Card className="flex flex-col gap-2 p-4 [box-shadow:inset_0_0_0_0.5px_var(--amber)]">
          <p className="flex items-center gap-2 text-[14px] text-amber"><TriangleAlert size={15} /> Export is paused until these are fixed:</p>
          <ul className="flex flex-col gap-1 text-[12.5px] text-muted">
            {verification.issues.slice(0, 8).map((i, k) => <li key={k}><span className="text-text">{i.where}:</span> “{i.claim}” — {i.reason}</li>)}
          </ul>
        </Card>
      ))}

      <div className="flex gap-1 md:hidden" role="tablist">
        {(["edit", "preview"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("h-9 flex-1 rounded-full text-[13px]", tab === t ? "bg-text text-bg" : "text-muted hairline")}>{t === "edit" ? "Editor" : "Preview"}</button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cx("flex flex-col gap-4", tab === "preview" && "max-md:hidden")}>
          <Card className="flex flex-col gap-3 p-4">
            <Label>Header</Label>
            <Input value={doc.header.name} disabled={readOnly} onChange={(e) => update((d) => { d.header.name = e.target.value; d.header.origin = "user"; })} aria-label="Name" />
            <Textarea value={doc.header.contact.join("\n")} disabled={readOnly} rows={Math.max(2, doc.header.contact.length)} onChange={(e) => update((d) => { d.header.contact = e.target.value.split("\n"); d.header.origin = "user"; })} aria-label="Contact lines, one per line" />
          </Card>

          {doc.sections.map((s, si) => (
            <Card key={s.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-center gap-1">
                <Input value={s.title} disabled={readOnly} onChange={(e) => sec(s.id, (x) => { x.title = e.target.value; })} className="h-9 flex-1 font-medium" aria-label="Section title" />
                <IconBtn label="Move section up" disabled={readOnly || si === 0} onClick={() => update((d) => { d.sections = swap(d.sections, si, si - 1); })}><ArrowUp size={14} /></IconBtn>
                <IconBtn label="Move section down" disabled={readOnly || si === doc.sections.length - 1} onClick={() => update((d) => { d.sections = swap(d.sections, si, si + 1); })}><ArrowDown size={14} /></IconBtn>
                <IconBtn label="Remove section" disabled={readOnly} onClick={() => update((d) => { d.sections = d.sections.filter((x) => x.id !== s.id); })}><Trash2 size={14} /></IconBtn>
              </div>

              {s.entries.map((e, ei) => (
                <div key={e.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
                    <Input value={e.heading} disabled={readOnly} onChange={(ev) => ent(s.id, e.id, (x) => { x.heading = ev.target.value; x.origin = "user"; })} aria-label="Heading" className="font-medium" />
                    <Input value={e.meta} disabled={readOnly} onChange={(ev) => ent(s.id, e.id, (x) => { x.meta = ev.target.value; x.origin = "user"; })} aria-label="Dates" placeholder="Dates" />
                  </div>
                  <Input value={e.subheading} disabled={readOnly} onChange={(ev) => ent(s.id, e.id, (x) => { x.subheading = ev.target.value; x.origin = "user"; })} aria-label="Subheading" placeholder="Organization, degree or technologies" />
                  {e.bullets.map((b, bi) => (
                    <LineRow key={b.id} line={b} readOnly={readOnly}
                      onText={(t) => ent(s.id, e.id, (x) => { x.bullets[bi] = { ...x.bullets[bi], text: t, origin: "user" }; })}
                      onUp={bi > 0 ? () => ent(s.id, e.id, (x) => { x.bullets = swap(x.bullets, bi, bi - 1); }) : undefined}
                      onDown={bi < e.bullets.length - 1 ? () => ent(s.id, e.id, (x) => { x.bullets = swap(x.bullets, bi, bi + 1); }) : undefined}
                      onDelete={() => ent(s.id, e.id, (x) => { x.bullets.splice(bi, 1); })} />
                  ))}
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => ent(s.id, e.id, (x) => { x.bullets.push({ id: randomId(), text: "", origin: "user", sourceItemId: null }); })}><Plus size={13} /> Bullet</Button>
                    <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => sec(s.id, (x) => { x.entries.splice(ei + 1, 0, { ...structuredClone(e), id: randomId(), bullets: e.bullets.map((b) => ({ ...b, id: randomId() })) }); })}><Copy size={13} /> Duplicate</Button>
                    <span className="flex-1" />
                    <IconBtn label="Move entry up" disabled={readOnly || ei === 0} onClick={() => sec(s.id, (x) => { x.entries = swap(x.entries, ei, ei - 1); })}><ArrowUp size={13} /></IconBtn>
                    <IconBtn label="Move entry down" disabled={readOnly || ei === s.entries.length - 1} onClick={() => sec(s.id, (x) => { x.entries = swap(x.entries, ei, ei + 1); })}><ArrowDown size={13} /></IconBtn>
                    <IconBtn label="Delete entry" disabled={readOnly} onClick={() => sec(s.id, (x) => { x.entries = x.entries.filter((y) => y.id !== e.id); })}><Trash2 size={13} /></IconBtn>
                  </div>
                </div>
              ))}

              {s.lines.map((l, li) => (
                <LineRow key={l.id} line={l} readOnly={readOnly}
                  onText={(t) => sec(s.id, (x) => { x.lines[li] = { ...x.lines[li], text: t, origin: "user" }; })}
                  onUp={li > 0 ? () => sec(s.id, (x) => { x.lines = swap(x.lines, li, li - 1); }) : undefined}
                  onDown={li < s.lines.length - 1 ? () => sec(s.id, (x) => { x.lines = swap(x.lines, li, li + 1); }) : undefined}
                  onDelete={() => sec(s.id, (x) => { x.lines.splice(li, 1); })} />
              ))}

              <div>
                {LINE_KINDS.has(s.kind) ? (
                  <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => sec(s.id, (x) => { x.lines.push({ id: randomId(), text: "", origin: "user", sourceItemId: null }); })}><Plus size={13} /> Line</Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => sec(s.id, (x) => { x.entries.push({ id: randomId(), sourceItemId: null, heading: "", subheading: "", meta: "", origin: "user", bullets: [] }); })}><Plus size={13} /> Entry</Button>
                )}
              </div>
            </Card>
          ))}
          <p className="text-[12px] leading-relaxed text-dim">Anything you type here is treated as information you supplied. To add a skill, job or project to your profile (so it counts for matching and future resumes), add it on the Review page.</p>
        </div>

        <div className={cx("md:sticky md:top-8 md:self-start", tab === "edit" && "max-md:hidden")}>
          <ResumePreview doc={{ ...doc, header: { ...doc.header, contact: doc.header.contact.filter((c) => c.trim()) } }} />
        </div>
      </div>
    </div>
  );
}

function ExportLink({ href, disabled, primary, children }: { href: string; disabled: boolean; primary?: boolean; children: ReactNode }) {
  const base = "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors";
  if (disabled) return <span aria-disabled className={cx(base, "cursor-not-allowed text-dim hairline")}><Download size={14} /> {children}</span>;
  return <a href={href} className={cx(base, primary ? "bg-accent text-accent-ink hover:bg-accent-hover" : "text-text hairline hover:bg-surface-2")}><Download size={14} /> {children}</a>;
}

function LineRow({ line, readOnly, onText, onUp, onDown, onDelete }: { line: DocLine; readOnly?: boolean; onText: (t: string) => void; onUp?: () => void; onDown?: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-1">
      <Textarea value={line.text} disabled={readOnly} onChange={(e) => onText(e.target.value)} rows={Math.max(1, Math.ceil(line.text.length / 64))} className="min-h-10 flex-1 py-2 text-[13.5px]" aria-label="Line text" />
      <IconBtn label="Move up" disabled={readOnly || !onUp} onClick={onUp}><ArrowUp size={12} /></IconBtn>
      <IconBtn label="Move down" disabled={readOnly || !onDown} onClick={onDown}><ArrowDown size={12} /></IconBtn>
      <IconBtn label="Delete line" disabled={readOnly} onClick={onDelete}><Trash2 size={13} /></IconBtn>
    </div>
  );
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-8 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
}
