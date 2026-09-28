"use client";

import { Check, Circle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { TailorProposal } from "@/lib/resume/tailor";
import type { TermChangeRecord } from "@/lib/resume/terminology";
import { api } from "../actions";
import { Button, Card, Chip, Label, Notice, cx } from "../ui";

type Ranked = TailorProposal["relevant"]["experience"];

/**
 * The transparent "FRIDAY wants to make these changes" screen. Nothing is created until
 * you accept; missing requirements are shown to you but never written onto the resume.
 */
export function TailorReview({ proposal: p, terminology = [] }: { proposal: TailorProposal; terminology?: TermChangeRecord[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [exclude, setExclude] = useState<Set<string>>(new Set(p.options.exclude));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const matched = p.skills.filter((s) => s.status === "confirmed");
  const missing = p.skills.filter((s) => s.status === "not_in_profile");
  const relevant: [string, Ranked][] = [["Experience", p.relevant.experience], ["Projects", p.relevant.projects]];

  const toggle = (id: string) => setExclude((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { version } = await api<{ version: { id: string } }>("/api/resumes/tailor", { method: "POST", json: { jobId: p.job.id, accept: true, exclude: [...exclude] } });
      router.push(`/resume/${version.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-28">
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <Label>Job skills you have</Label>
          {matched.length ? (
            <ul className="flex flex-col gap-1.5 text-[14px]">
              {matched.map((s) => <li key={s.name} className="flex items-center gap-2"><Check size={14} className="text-moss" /> {s.name}{s.yours && s.yours !== s.name && <span className="text-dim">— as “{s.yours}”</span>}</li>)}
            </ul>
          ) : <p className="text-[13.5px] text-muted">None of the detected requirements match your confirmed skills yet.</p>}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <Label>Not found in your profile</Label>
          {missing.length ? (
            <ul className="flex flex-col gap-1.5 text-[14px] text-muted">
              {missing.map((s) => <li key={s.name} className="flex items-center gap-2"><Circle size={12} className="text-dim" /> {s.name}{s.mentionedIn && <span className="text-[12px] text-dim">— named in your {s.mentionedIn.toLowerCase()}</span>}</li>)}
            </ul>
          ) : <p className="text-[13.5px] text-muted">Nothing missing — you cover every skill FRIDAY detected.</p>}
          {!!missing.length && <p className="text-[12px] leading-relaxed text-dim">These will not be added. If you genuinely have one, add it on the <Link href="/resume/review" className="text-accent hover:underline">Review page</Link> first.</p>}
        </Card>
      </div>

      {(!!p.relevant.experience.length || !!p.relevant.projects.length || !!p.relevant.coursework.length) && (
        <Card className="flex flex-col gap-4 p-5">
          <Label>Most relevant to this role</Label>
          {relevant.map(([title, list]) => list.length ? (
            <div key={title} className="flex flex-col gap-1.5">
              <span className="text-[12px] text-dim">{title}</span>
              {list.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-[14px]">{r.label}{r.matches.map((m) => <Chip key={m} tone="moss">{m}</Chip>)}</div>
              ))}
            </div>
          ) : null)}
          {!!p.relevant.coursework.length && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-dim">Coursework</span>
              <p className="text-[14px]">{p.relevant.coursework.join(", ")}</p>
            </div>
          )}
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-[24px]">FRIDAY wants to make these <span className="serif-em">changes</span></h2>
        <Group tag="Keep" tone="moss">
          {p.changes.keep.map((k) => (
            <Row key={k.id} checked={!exclude.has(k.id)} editing={editing} onToggle={() => toggle(k.id)}>{k.label}</Row>
          ))}
          {!p.changes.keep.length && <p className="text-[13.5px] text-muted">No experience or projects in your profile yet.</p>}
        </Group>
        {!!p.changes.reorder.length && (
          <Group tag="Reorder" tone="neutral">{p.changes.reorder.map((r) => <p key={r} className="text-[14px]">{r}</p>)}</Group>
        )}
        {!!p.changes.wording.length && (
          <Group tag="Edit wording" tone="neutral">
            {p.changes.wording.map((w, i) => (
              <div key={i} className="flex flex-col gap-0.5 text-[13.5px]">
                <span className="text-dim line-through decoration-[0.5px]">{w.before}</span>
                <span>{w.after}</span>
              </div>
            ))}
            <p className="text-[12px] text-dim">Capitalization and punctuation only — no words added.</p>
          </Group>
        )}
        {!!terminology.length && (
          <Group tag="ATS spelling" tone="neutral">
            {terminology.map((t, i) => (
              <div key={i} className="flex flex-col gap-0.5 text-[13.5px]">
                <span><span className="text-dim line-through decoration-[0.5px]">{t.from}</span> → {t.to} <span className="text-[12px] text-dim">{t.where}</span></span>
                <span className="text-[12.5px] text-muted">{t.after}</span>
              </div>
            ))}
            <p className="text-[12px] text-dim">Same skill, spelled the way the posting spells it. None adds a skill you didn&rsquo;t already list.</p>
          </Group>
        )}
        {!!p.changes.notIncluded.length && (
          <Group tag="Not included" tone="amber">
            {p.changes.notIncluded.map((n) => (
              <Row key={n.id} checked={!exclude.has(n.id)} editing={editing} onToggle={() => toggle(n.id)}>{n.label} <span className="text-dim">— {n.reason}</span></Row>
            ))}
          </Group>
        )}
        {!!p.changes.needsConfirmation.length && (
          <Group tag="Needs confirmation" tone="amber">
            {p.changes.needsConfirmation.map((n) => <p key={n} className="text-[13.5px] text-muted">{n}</p>)}
          </Group>
        )}
      </section>

      {err && <Notice tone="accent" title="Couldn't create the tailored resume">{err}</Notice>}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-hairline-strong bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-end gap-2 px-4 py-3 md:px-10">
          <span className="mr-auto hidden text-[12.5px] text-dim sm:inline">Nothing is created or sent until you accept.</span>
          <Button variant="ghost" onClick={() => router.back()} disabled={busy}>Cancel</Button>
          <Button onClick={() => setEditing((e) => !e)} disabled={busy}>{editing ? "Done editing" : "Edit changes"}</Button>
          <Button variant="primary" onClick={accept} disabled={busy}>{busy && <Loader2 size={14} className="animate-spin" />} Accept changes</Button>
        </div>
      </div>
    </div>
  );
}

function Group({ tag, tone, children }: { tag: string; tone: "moss" | "neutral" | "amber"; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2.5 p-5">
      <Chip tone={tone} className="self-start uppercase tracking-[0.06em]">{tag}</Chip>
      {children}
    </Card>
  );
}

function Row({ checked, editing, onToggle, children }: { checked: boolean; editing: boolean; onToggle: () => void; children: ReactNode }) {
  if (!editing) return <p className={cx("text-[14px]", !checked && "text-dim line-through decoration-[0.5px]")}>{children}</p>;
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 accent-[var(--accent)]" />
      <span className={cx(!checked && "text-dim")}>{children}</span>
    </label>
  );
}
