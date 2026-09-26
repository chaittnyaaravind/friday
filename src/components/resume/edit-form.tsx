"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { type ReactNode } from "react";
import type { LineRef } from "@/lib/resume/edits";
import { randomId } from "@/lib/resume/ids";
import type { DocEntry, DocLine, DocSection, ResumeDoc } from "@/lib/resume/types";
import { Button, Card, Input, Label, Textarea, cx } from "../ui";

export type Update = (fn: (d: ResumeDoc) => ResumeDoc | void) => void;

const swap = <T,>(list: T[], i: number, j: number) => {
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const LINE_KINDS = new Set(["skills", "coursework", "summary", "certifications", "awards"]);

/**
 * Field-level editing of every section. Anything typed here is marked as the user's own
 * (origin "user"). Focusing a line selects it in the preview, so both stay in step.
 */
export function EditForm({ doc, readOnly, update, selected, onSelect }: { doc: ResumeDoc; readOnly?: boolean; update: Update; selected: string | null; onSelect: (ref: LineRef) => void }) {
  const sec = (sid: string, fn: (s: DocSection) => void) => update((d) => { const s = d.sections.find((x) => x.id === sid); if (s) fn(s); });
  const ent = (sid: string, eid: string, fn: (e: DocEntry) => void) => sec(sid, (s) => { const e = s.entries.find((x) => x.id === eid); if (e) fn(e); });

  return (
    <div className="flex flex-col gap-4">
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
                <LineRow key={b.id} line={b} readOnly={readOnly} selected={selected === b.id} onFocus={() => onSelect({ sectionId: s.id, entryId: e.id, lineId: b.id })}
                  onText={(t) => ent(s.id, e.id, (x) => { x.bullets[bi] = { ...x.bullets[bi], text: t, origin: "user", ai: undefined }; })}
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
            <LineRow key={l.id} line={l} readOnly={readOnly} selected={selected === l.id} onFocus={() => onSelect({ sectionId: s.id, entryId: null, lineId: l.id })}
              onText={(t) => sec(s.id, (x) => { x.lines[li] = { ...x.lines[li], text: t, origin: "user", ai: undefined }; })}
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
  );
}

function LineRow({ line, readOnly, selected, onFocus, onText, onUp, onDown, onDelete }: { line: DocLine; readOnly?: boolean; selected: boolean; onFocus: () => void; onText: (t: string) => void; onUp?: () => void; onDown?: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-1">
      <Textarea value={line.text} disabled={readOnly} onFocus={onFocus} onChange={(e) => onText(e.target.value)} rows={Math.max(1, Math.ceil(line.text.length / 52))} className={cx("min-h-10 flex-1 py-2 text-[13.5px]", selected && "shadow-[inset_0_0_0_1px_var(--accent)]")} aria-label="Line text" />
      <IconBtn label="Move up" disabled={readOnly || !onUp} onClick={onUp}><ArrowUp size={12} /></IconBtn>
      <IconBtn label="Move down" disabled={readOnly || !onDown} onClick={onDown}><ArrowDown size={12} /></IconBtn>
      <IconBtn label="Delete line" disabled={readOnly} onClick={onDelete}><Trash2 size={13} /></IconBtn>
    </div>
  );
}

export function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-8 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30">
      {children}
    </button>
  );
}
