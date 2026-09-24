"use client";

import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SECTION_LABEL, type CandidateItem, type Section } from "@/lib/resume/types";
import { api } from "../actions";
import { Button, Card, Chip, Input, Label, Notice, Textarea, cx } from "../ui";

const REVIEW_ORDER: Section[] = ["personal", "summary", "education", "coursework", "experience", "project", "skill", "certification", "award", "activity", "link", "other"];

const TEMPLATE: Record<Section, Record<string, unknown>> = {
  personal: { field: "location", value: "" },
  link: { label: "Portfolio", url: "" },
  summary: { text: "" },
  education: { school: "", degree: "", start: "", end: "", gpa: "", details: [] },
  experience: { title: "", organization: "", location: "", start: "", end: "", bullets: [] },
  activity: { title: "", organization: "", location: "", start: "", end: "", bullets: [] },
  project: { name: "", technologies: [], date: "", link: "", bullets: [] },
  skill: { name: "", group: "" },
  certification: { text: "" },
  award: { text: "" },
  coursework: { text: "" },
  other: { text: "" },
};

const FIELD_LABEL: Record<string, string> = {
  field: "Field", value: "Value", label: "Label", url: "URL", text: "Text", school: "School", degree: "Degree", start: "Start", end: "End",
  gpa: "GPA", details: "Details (one per line)", title: "Title", organization: "Organization", location: "Location", bullets: "Bullets (one per line)",
  name: "Name", technologies: "Technologies (comma-separated)", date: "Date", link: "Link", group: "Group",
};

function summarize(i: CandidateItem): { title: string; sub?: string; lines?: string[] } {
  const d = i.data as Record<string, unknown>;
  switch (i.section) {
    case "personal": return { title: String(d.value), sub: String(d.field) };
    case "link": return { title: String(d.url), sub: String(d.label) };
    case "education": return { title: String(d.school || "School not identified"), sub: [d.degree, d.gpa ? `GPA ${d.gpa}` : "", [d.start, d.end].filter(Boolean).join(" – ")].filter(Boolean).join(" · "), lines: d.details as string[] };
    case "experience": case "activity": return { title: [d.title, d.organization].filter(Boolean).join(" · ") || "Untitled", sub: [d.location, [d.start, d.end].filter(Boolean).join(" – ")].filter(Boolean).join(" · "), lines: d.bullets as string[] };
    case "project": return { title: String(d.name), sub: [(d.technologies as string[]).join(", "), d.date].filter(Boolean).join(" · "), lines: d.bullets as string[] };
    case "skill": return { title: String(d.name), sub: d.group ? String(d.group) : undefined };
    default: return { title: String(d.text), sub: d.group ? String(d.group) : undefined };
  }
}

export function ResumeReview({ initial }: { initial: CandidateItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = items.filter((i) => i.status === "requires_confirmation").length;
  const grouped = useMemo(() => REVIEW_ORDER.map((s) => [s, items.filter((i) => i.section === s).sort((a, b) => a.position - b.position)] as const), [items]);

  const replace = (it: CandidateItem) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));

  const move = async (it: CandidateItem, dir: "up" | "down") => {
    const list = items.filter((i) => i.section === it.section).sort((a, b) => a.position - b.position);
    const i = list.findIndex((x) => x.id === it.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const pos = new Map(list.map((x, k) => [x.id, k]));
    setItems((xs) => xs.map((x) => (pos.has(x.id) ? { ...x, position: pos.get(x.id)! } : x)));
    await api(`/api/candidate/${it.id}`, { method: "PATCH", json: { move: dir } }).catch(() => {});
  };

  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/candidate/review", { method: "POST" });
      const { version } = await api<{ version: { id: string } }>("/api/resumes/versions", { method: "POST", json: {} });
      router.push(`/resume/${version.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Notice tone={pending ? "amber" : "moss"} title={pending ? `${pending} item${pending === 1 ? "" : "s"} need${pending === 1 ? "s" : ""} your confirmation` : "Everything here is confirmed or taken directly from your resume"}>
        Everything below was extracted from your uploaded resume. FRIDAY will not add unverified information — items marked “Needs confirmation” stay out of your resume until you confirm them.
      </Notice>

      {grouped.map(([section, list]) => (
        <SectionBlock key={section} section={section} list={list} onReplace={replace} onRemove={remove} onMove={move} onAdd={(it) => setItems((xs) => [...xs, it])} />
      ))}

      <div className="sticky bottom-24 z-20 flex flex-col items-start justify-between gap-3 rounded-2xl bg-glass p-3 pl-5 backdrop-blur-xl [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] sm:flex-row sm:items-center md:bottom-6">
        <span className={cx("text-[13px]", err ? "text-accent" : "text-muted")}>{err ?? (pending ? `${pending} unconfirmed item${pending === 1 ? "" : "s"} will be left out.` : "Only confirmed information will be used.")}</span>
        <Button variant="primary" onClick={build} disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />} Looks right — build my resume
        </Button>
      </div>
    </div>
  );
}

function SectionBlock({ section, list, onReplace, onRemove, onMove, onAdd }: { section: Section; list: CandidateItem[]; onReplace: (i: CandidateItem) => void; onRemove: (id: string) => void; onMove: (i: CandidateItem, d: "up" | "down") => void; onAdd: (i: CandidateItem) => void }) {
  const [adding, setAdding] = useState(false);
  if (!list.length && section === "other") return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[20px]">{SECTION_LABEL[section]}</h2>
          <span className="num font-mono text-[12px] text-dim">{list.length}</span>
        </div>
        {section !== "other" && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus size={14} /> Add</Button>}
      </div>
      {!list.length && !adding && <p className="text-[13px] text-dim">Nothing found in your resume.</p>}
      <div className="flex flex-col gap-2">
        {list.map((it, k) => (
          <ItemCard key={it.id} item={it} first={k === 0} last={k === list.length - 1} onReplace={onReplace} onRemove={onRemove} onMove={onMove} />
        ))}
        {adding && (
          <Card className="p-4">
            <ItemForm
              section={section}
              data={TEMPLATE[section]}
              onCancel={() => setAdding(false)}
              onSave={async (data) => {
                const { item } = await api<{ item: CandidateItem }>("/api/candidate", { method: "POST", json: { section, data } });
                onAdd(item);
                setAdding(false);
              }}
            />
          </Card>
        )}
      </div>
    </section>
  );
}

function ItemCard({ item, first, last, onReplace, onRemove, onMove }: { item: CandidateItem; first: boolean; last: boolean; onReplace: (i: CandidateItem) => void; onRemove: (id: string) => void; onMove: (i: CandidateItem, d: "up" | "down") => void }) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = summarize(item);
  const needs = item.status === "requires_confirmation";
  const statusChip = needs ? <Chip tone="amber">Needs confirmation</Chip> : item.status === "user_added" ? <Chip>Added by you</Chip> : item.status === "user_confirmed" ? <Chip tone="moss">Confirmed</Chip> : <Chip tone="moss">From your resume</Chip>;

  if (editing) {
    return (
      <Card className="p-4">
        <ItemForm
          section={item.section}
          data={item.data as Record<string, unknown>}
          onCancel={() => setEditing(false)}
          onSave={async (data) => {
            const { item: saved } = await api<{ item: CandidateItem }>(`/api/candidate/${item.id}`, { method: "PATCH", json: { data } });
            onReplace(saved);
            setEditing(false);
          }}
        />
      </Card>
    );
  }
  return (
    <Card className={cx("flex flex-col gap-2 p-4", needs && "[box-shadow:inset_0_0_0_1px_var(--amber-soft),inset_0_0_0_0.5px_var(--amber)]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug">{s.title}</p>
          {s.sub && <p className="text-[12.5px] text-muted">{s.sub}</p>}
          {!!s.lines?.length && (
            <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-muted">
              {s.lines.map((l, i) => <li key={i} className="relative pl-3.5 before:absolute before:left-0 before:top-[0.6em] before:size-1 before:rounded-full before:bg-dim">{l}</li>)}
            </ul>
          )}
        </div>
        {statusChip}
      </div>
      {item.note && <p className="text-[12.5px] text-amber">{item.note}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {needs && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={async () => { setBusy(true); const { item: saved } = await api<{ item: CandidateItem }>(`/api/candidate/${item.id}`, { method: "PATCH", json: { confirm: true } }); onReplace(saved); setBusy(false); }}>
            <Check size={14} /> Confirm
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); await api(`/api/candidate/${item.id}`, { method: "DELETE" }); onRemove(item.id); }}><Trash2 size={13} /> Delete</Button>
        <span className="mx-1 h-4 w-px bg-hairline-strong" />
        <button aria-label="Move up" disabled={first} onClick={() => onMove(item, "up")} className="grid size-8 place-items-center rounded-full text-dim hover:text-text disabled:opacity-30"><ArrowUp size={14} /></button>
        <button aria-label="Move down" disabled={last} onClick={() => onMove(item, "down")} className="grid size-8 place-items-center rounded-full text-dim hover:text-text disabled:opacity-30"><ArrowDown size={14} /></button>
        {item.source_text && (
          <button onClick={() => setShowSource((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-dim hover:text-text">
            Source <ChevronDown size={12} className={cx("transition-transform", showSource && "rotate-180")} />
          </button>
        )}
      </div>
      {showSource && item.source_text && <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-muted">{item.source_text}</pre>}
    </Card>
  );
}

function ItemForm({ section, data, onSave, onCancel }: { section: Section; data: Record<string, unknown>; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(data).map(([k, val]) => [k, Array.isArray(val) ? (k === "technologies" ? val.join(", ") : val.join("\n")) : val == null ? "" : String(val)])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const arrays = new Set(Object.entries(data).filter(([, val]) => Array.isArray(val)).map(([k]) => k));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (arrays.has(k)) out[k] = (k === "technologies" ? val.split(",") : val.split("\n")).map((x) => x.trim()).filter(Boolean);
      else out[k] = val.trim() === "" && !["text", "name", "value", "url", "label", "title", "organization", "school", "field"].includes(k) ? null : val.trim();
    }
    try {
      await onSave(out);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(v).map((k) => (
          <label key={k} className={cx("flex flex-col gap-1.5", (arrays.has(k) && k !== "technologies") || k === "text" ? "sm:col-span-2" : "")}>
            <Label>{FIELD_LABEL[k] ?? k}</Label>
            {k === "field" && section === "personal" ? (
              <select value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="h-10 rounded-[10px] bg-surface-2 px-3 text-[14px] hairline">
                {["name", "email", "phone", "location"].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : (arrays.has(k) && k !== "technologies") || k === "text" ? (
              <Textarea value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} rows={Math.max(3, v[k].split("\n").length + 1)} />
            ) : (
              <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      {err && <p className="text-[12.5px] text-accent">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}><X size={14} /> Cancel</Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Save</Button>
      </div>
    </form>
  );
}
