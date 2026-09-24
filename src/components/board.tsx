"use client";

import { ArrowUpRight, CalendarPlus, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ago, dateTime, shortDate, STATUS_LABEL, STATUS_ORDER, type AppStatus } from "@/lib/format";
import { api } from "./actions";
import { Button, Card, CompanyMark, Field, Input, Label, Select, Textarea, cx } from "./ui";

export type App = {
  id: string; job_id: string | null; company_name: string; job_title: string; location: string | null; source: string | null;
  original_url: string | null; application_url: string | null; status: AppStatus; position: number; discovered_at: string | null;
  applied_at: string | null; cover_letter: string | null; contact_name: string | null; contact_email: string | null;
  interview_at: string | null; follow_up_at: string | null; notes: string | null; updated_at: string; resume_version_id: string | null;
  follow_ups: { id: string; due_at: string; done_at: string | null; note: string | null }[];
  interviews: { id: string; scheduled_at: string; kind: string }[];
};

const ACTIVE: AppStatus[] = ["saved", "preparing", "ready", "applied", "assessment", "interview", "offer"];
const CLOSED: AppStatus[] = ["rejected", "withdrawn"];

export function Board({ initial, versions }: { initial: App[]; versions: { id: string; label: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [apps, setApps] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<AppStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(sp.get("open"));
  const [mobileCol, setMobileCol] = useState<AppStatus>("preparing");
  const [adding, setAdding] = useState(false);

  const by = useMemo(() => {
    const m = Object.fromEntries(STATUS_ORDER.map((s) => [s, [] as App[]])) as Record<AppStatus, App[]>;
    for (const a of apps) m[a.status]?.push(a);
    return m;
  }, [apps]);

  const move = async (id: string, status: AppStatus) => {
    const prev = apps;
    setApps(apps.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      await api(`/api/applications/${id}`, { method: "PATCH", json: { status } });
      router.refresh();
    } catch {
      setApps(prev);
    }
  };

  const open = apps.find((a) => a.id === openId) ?? null;

  const column = (s: AppStatus) => (
    <div
      key={s}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(s);
      }}
      onDragLeave={() => setOver((o) => (o === s ? null : o))}
      onDrop={() => {
        if (dragging) move(dragging, s);
        setDragging(null);
        setOver(null);
      }}
      className={cx("flex w-[272px] shrink-0 flex-col gap-2 rounded-2xl p-2 transition-colors", over === s ? "bg-accent-soft" : "bg-[rgb(var(--ink)/.025)]")}
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <Label className={cx(s === "offer" && "!text-moss", CLOSED.includes(s) && "!text-dim")}>{STATUS_LABEL[s]}</Label>
        <span className="num font-mono text-[11px] text-dim">{by[s].length}</span>
      </div>
      {by[s].map((a) => (
        <AppCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} onDrag={() => setDragging(a.id)} />
      ))}
      {!by[s].length && <div className="rounded-xl px-3 py-6 text-center text-[12px] text-dim [box-shadow:inset_0_0_0_0.5px_var(--hairline)]">Drop here</div>}
    </div>
  );

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:hidden">
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => setMobileCol(s)} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px]", mobileCol === s ? "bg-text text-bg" : "text-muted hairline")}>
              {STATUS_LABEL[s]} <span className="num font-mono opacity-60">{by[s].length}</span>
            </button>
          ))}
        </div>
        <Button onClick={() => setAdding(true)} className="ml-auto shrink-0"><Plus size={15} /> Add manually</Button>
      </div>

      {/* Desktop: horizontal board */}
      <div className="-mx-4 hidden overflow-x-auto px-4 pb-4 md:-mx-10 md:block md:px-10 lg:-mx-14 lg:px-14">
        <div className="flex gap-2">
          {ACTIVE.map(column)}
          <div className="w-px shrink-0 bg-hairline" />
          {CLOSED.map(column)}
        </div>
      </div>

      {/* Mobile: one column at a time, status changes via drawer */}
      <div className="flex flex-col gap-2 md:hidden">
        {by[mobileCol].map((a) => (
          <AppCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} />
        ))}
        {!by[mobileCol].length && <p className="py-10 text-center text-[13px] text-dim">Nothing in {STATUS_LABEL[mobileCol]}.</p>}
      </div>

      {open && <Drawer key={open.id} a={open} versions={versions} onClose={() => setOpenId(null)} onChange={(p) => setApps(apps.map((x) => (x.id === open.id ? { ...x, ...p } : x)))} onDeleted={() => { setApps(apps.filter((x) => x.id !== open.id)); setOpenId(null); }} />}
      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={(a) => { setApps([a, ...apps]); setAdding(false); setOpenId(a.id); }} />}
    </>
  );
}

function AppCard({ a, onOpen, onDrag }: { a: App; onOpen: () => void; onDrag?: () => void }) {
  const next = a.follow_ups.filter((f) => !f.done_at).sort((x, y) => x.due_at.localeCompare(y.due_at))[0];
  const iv = a.interviews.filter((i) => i.scheduled_at > new Date().toISOString()).sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
  return (
    <button draggable={Boolean(onDrag)} onDragStart={onDrag} onClick={onOpen} className="card card-hover flex w-full cursor-grab flex-col gap-2.5 p-3.5 text-left active:cursor-grabbing">
      <div className="flex items-center gap-2.5">
        <CompanyMark name={a.company_name} size={26} />
        <span className="truncate text-[12.5px] text-muted">{a.company_name}</span>
      </div>
      <span className="line-clamp-2 text-[14px] leading-snug">{a.job_title}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-dim">
        {a.applied_at && <span>Applied {shortDate(a.applied_at)}</span>}
        {iv && <span className="text-moss">Interview {shortDate(iv.scheduled_at)}</span>}
        {next && <span className={cx(next.due_at < new Date().toISOString() && "text-accent")}>Follow up {shortDate(next.due_at)}</span>}
        {!a.applied_at && !iv && !next && <span>Updated {ago(a.updated_at)}</span>}
      </div>
    </button>
  );
}

function Drawer({ a, versions, onClose, onChange, onDeleted }: { a: App; versions: { id: string; label: string }[]; onClose: () => void; onChange: (p: Partial<App>) => void; onDeleted: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(a);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [iv, setIv] = useState({ at: "", kind: "interview" });
  const [fu, setFu] = useState("");

  const patch = async (p: Partial<App>) => {
    setSaving(true);
    setMsg(null);
    try {
      const { application } = await api<{ application: App }>(`/api/applications/${a.id}`, { method: "PATCH", json: p });
      onChange(application);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const txt = (k: keyof App) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const blur = (k: keyof App) => () => (f[k] ?? "") !== (a[k] ?? "") && patch({ [k]: (f[k] as string) || null } as Partial<App>);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="reveal flex h-full w-full max-w-[520px] flex-col gap-6 overflow-y-auto bg-surface-1 p-6 [box-shadow:inset_0.5px_0_0_var(--hairline-strong)] md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Label>{a.company_name}</Label>
            <h2 className="text-[26px] leading-tight">{a.job_title}</h2>
            <span className="text-[12.5px] text-muted">{[a.location, a.source].filter(Boolean).join(" · ")}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-[rgb(var(--ink)/.06)] hover:text-text"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-2">
          {a.application_url && (
            <a href={a.application_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-[18px] text-[14px] font-medium text-accent-ink hover:bg-accent-hover">
              Open application <ArrowUpRight size={15} />
            </a>
          )}
          {a.job_id && <Link href={`/jobs/${a.job_id}`} className="inline-flex h-10 items-center rounded-full px-[18px] text-[14px] text-muted hairline hover:text-text">View opportunity</Link>}
        </div>

        <Field label="Status">
          <Select value={f.status} onChange={(e) => { const s = e.target.value as AppStatus; setF({ ...f, status: s }); patch({ status: s }); }}>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        </Field>
        {f.status === "ready" && <p className="-mt-3 text-[12.5px] text-muted">When you&apos;ve submitted it on the employer&apos;s site, set the status to <span className="text-text">Applied</span>. FRIDAY never marks it for you.</p>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact"><Input value={f.contact_name ?? ""} onChange={txt("contact_name")} onBlur={blur("contact_name")} placeholder="Recruiter name" /></Field>
          <Field label="Contact email"><Input type="email" value={f.contact_email ?? ""} onChange={txt("contact_email")} onBlur={blur("contact_email")} /></Field>
        </div>
        <Field label="Resume version">
          <Select value={f.resume_version_id ?? ""} onChange={(e) => { setF({ ...f, resume_version_id: e.target.value || null }); patch({ resume_version_id: e.target.value || null }); }}>
            <option value="">Primary resume</option>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Textarea value={f.notes ?? ""} onChange={txt("notes")} onBlur={blur("notes")} rows={4} /></Field>

        {/* Follow-ups & interviews */}
        <div className="flex flex-col gap-3">
          <Label>Follow-ups</Label>
          {a.follow_ups.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-3 text-[13.5px]">
              <span className={cx(x.done_at && "text-dim line-through")}>{shortDate(x.due_at)} — {x.note ?? "Follow up"}</span>
              {!x.done_at && (
                <Button size="sm" variant="ghost" onClick={async () => { await api("/api/follow-ups", { method: "PATCH", json: { id: x.id, done: true } }); onChange({ follow_ups: a.follow_ups.map((y) => (y.id === x.id ? { ...y, done_at: new Date().toISOString() } : y)) }); }}>
                  <Check size={14} /> Done
                </Button>
              )}
            </div>
          ))}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!fu) return; const { followUp } = await api<{ followUp: App["follow_ups"][number] }>("/api/follow-ups", { method: "POST", json: { applicationId: a.id, dueAt: new Date(fu).toISOString(), note: "Follow up" } }); onChange({ follow_ups: [...a.follow_ups, followUp] }); setFu(""); }}>
            <Input type="date" value={fu} onChange={(e) => setFu(e.target.value)} />
            <Button type="submit" disabled={!fu}>Add</Button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <Label>Interviews</Label>
          {a.interviews.map((x) => <p key={x.id} className="text-[13.5px]">{dateTime(x.scheduled_at)} · <span className="capitalize">{x.kind}</span></p>)}
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (!iv.at) return; const { interview } = await api<{ interview: App["interviews"][number] }>("/api/interviews", { method: "POST", json: { applicationId: a.id, scheduledAt: new Date(iv.at).toISOString(), kind: iv.kind } }); onChange({ interviews: [...a.interviews, interview] }); setIv({ at: "", kind: "interview" }); router.refresh(); }}>
            <Input type="datetime-local" value={iv.at} onChange={(e) => setIv({ ...iv, at: e.target.value })} className="flex-1" />
            <Select value={iv.kind} onChange={(e) => setIv({ ...iv, kind: e.target.value })} className="w-auto">
              {["interview", "phone screen", "technical", "onsite", "assessment", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
            <Button type="submit" disabled={!iv.at}><CalendarPlus size={15} /> Add</Button>
          </form>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label>Cover letter</Label>
            {a.job_id && (
              <Button size="sm" variant="ghost" disabled={letterBusy} onClick={async () => { setLetterBusy(true); setMsg(null); try { const { letter } = await api<{ letter: string }>(`/api/applications/${a.id}/cover-letter`, { method: "POST", json: {} }); setF({ ...f, cover_letter: letter }); onChange({ cover_letter: letter }); } catch (e) { setMsg((e as Error).message); } finally { setLetterBusy(false); } }}>
                {letterBusy ? <Loader2 size={14} className="animate-spin" /> : null} {f.cover_letter ? "Redraft" : "Draft with FRIDAY"}
              </Button>
            )}
          </div>
          <Textarea value={f.cover_letter ?? ""} onChange={txt("cover_letter")} onBlur={blur("cover_letter")} rows={f.cover_letter ? 10 : 3} placeholder="Drafted only from your resume — edit before you use it." />
        </div>

        {msg && <p className="text-[13px] text-accent">{msg}</p>}
        <div className="mt-auto flex items-center justify-between border-t-[0.5px] border-hairline-strong pt-4 text-[12px] text-dim">
          <span>{saving ? "Saving…" : `Updated ${ago(a.updated_at)}`}{a.discovered_at ? ` · found ${shortDate(a.discovered_at)}` : ""}</span>
          <button onClick={async () => { if (!confirm("Stop tracking this application?")) return; await api(`/api/applications/${a.id}`, { method: "DELETE" }); onDeleted(); router.refresh(); }} className="inline-flex items-center gap-1.5 hover:text-accent"><Trash2 size={13} /> Remove</button>
        </div>
      </aside>
    </div>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (a: App) => void }) {
  const [f, setF] = useState({ company_name: "", job_title: "", location: "", application_url: "", status: "saved" as AppStatus });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 backdrop-blur-sm md:place-items-center" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { application } = await api<{ application: App }>("/api/applications", { method: "POST", json: { ...f, location: f.location || null, application_url: f.application_url || null, source: "Added by you" } });
            onAdded({ ...application, follow_ups: [], interviews: [] });
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
        className="reveal card flex w-full max-w-[480px] flex-col gap-4 rounded-b-none p-6 md:rounded-b-[16px]"
      >
        <h3 className="text-[22px]">Track an application</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company"><Input required value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></Field>
          <Field label="Role"><Input required value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} /></Field>
          <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as AppStatus })}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Application link"><Input type="url" value={f.application_url} onChange={(e) => setF({ ...f, application_url: e.target.value })} placeholder="https://…" /></Field>
        {err && <p className="text-[13px] text-accent">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Add</Button>
        </div>
      </form>
    </div>
  );
}

export function BoardSummary({ apps }: { apps: App[] }) {
  const applied = apps.filter((a) => a.applied_at).length;
  const interviews = apps.filter((a) => ["interview", "offer"].includes(a.status)).length;
  const rate = applied ? Math.round((interviews / applied) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Tracked", apps.length],
        ["Applied", applied],
        ["Interviews", interviews],
        ["Response rate", rate == null ? "—" : `${rate}%`],
      ].map(([l, v]) => (
        <Card key={l} className="flex flex-col gap-2 p-4">
          <Label>{l}</Label>
          <span className="num text-[28px] font-light leading-none tracking-[-0.03em]">{v}</span>
        </Card>
      ))}
    </div>
  );
}
