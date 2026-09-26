"use client";

import { Copy, GitCompare, History, Loader2, RotateCcw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ago } from "@/lib/format";
import { diffDocs, numbered, type Revision, type RevisionSource } from "@/lib/resume/history";
import type { ResumeDoc } from "@/lib/resume/types";
import type { Issue } from "@/lib/resume/validate";
import { api } from "../actions";
import { Button, Card, Chip, Label, Notice, cx } from "../ui";

const SOURCE: Record<RevisionSource, { label: string; tone: "neutral" | "moss" | "accent" | "amber" }> = {
  original: { label: "Original", tone: "moss" },
  ai: { label: "AI edit", tone: "accent" },
  user: { label: "Your edit", tone: "neutral" },
  restore: { label: "Restore", tone: "amber" },
  checkpoint: { label: "Checkpoint", tone: "neutral" },
};

type Verification = { ok: boolean; issues: Issue[] } | null;

/**
 * Every state worth returning to. History is append-only: restoring writes the old content back as a
 * new entry (and saves the current state first), so nothing is ever overwritten or lost.
 */
export function HistoryPanel({ versionId, doc, tick, readOnly, onRestored }: { versionId: string; doc: ResumeDoc; tick: number; readOnly?: boolean; onRestored: (content: ResumeDoc, verification: Verification, updatedAt?: string) => void }) {
  const router = useRouter();
  const [revs, setRevs] = useState<Revision[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const load = useCallback(async () => setReload((n) => n + 1), []);

  // Fetch on mount, whenever the editor records a revision (`tick`), and after our own actions (`reload`).
  useEffect(() => {
    let alive = true;
    api<{ revisions: Revision[] }>(`/api/resumes/versions/${versionId}/revisions`)
      .then((r) => { if (alive) { setRevs(r.revisions); setErr(null); } })
      .catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [versionId, tick, reload]);

  const list = useMemo(() => (revs ? numbered(revs) : []), [revs]);
  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = (r: Revision) => act(`restore:${r.id}`, async () => {
    if (!confirm(`Restore “${r.label}”? Your current version is saved to history first.`)) return;
    const res = await api<{ content: ResumeDoc; verification: Verification; updatedAt?: string }>(`/api/resumes/versions/${versionId}/revisions`, { method: "POST", json: { action: "restore", revisionId: r.id } });
    onRestored(res.content, res.verification, res.updatedAt);
    await load();
  });

  const duplicate = (r: Revision) => act(`dup:${r.id}`, async () => {
    const res = await api<{ version: { id: string } }>(`/api/resumes/versions/${versionId}/revisions`, { method: "POST", json: { action: "duplicate", revisionId: r.id } });
    router.push(`/resume/${res.version.id}`);
  });

  const checkpoint = () => act("checkpoint", async () => {
    await api(`/api/resumes/versions/${versionId}/revisions`, { method: "POST", json: { label: "Checkpoint", source: "checkpoint", content: doc } });
    await load();
  });

  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  const diff = useMemo(() => {
    if (!picked.length) return null;
    const a = byId.get(picked[0]);
    const b = picked[1] ? byId.get(picked[1]) : null;
    if (!a) return null;
    // Two picked → older vs newer; one picked → that revision vs the current document.
    const [from, to, fromLabel, toLabel] = b
      ? (a.created_at <= b.created_at ? [a.content, b.content, `Version ${a.number}`, `Version ${b.number}`] : [b.content, a.content, `Version ${b.number}`, `Version ${a.number}`])
      : [a.content, doc, `Version ${a.number}`, "Current"];
    return { lines: diffDocs(from as ResumeDoc, to as ResumeDoc), fromLabel, toLabel };
  }, [picked, byId, doc]);

  if (err && !revs) {
    return (
      <Notice tone="amber" title="Version history isn't available yet">
        {/resume_revisions|schema cache|relation/i.test(err) ? <>Apply the database migration <code className="font-mono text-[12px]">0006_resume_ai_editor.sql</code> to turn it on. Editing, AI suggestions and export work in the meantime.</> : err}
      </Notice>
    );
  }
  if (!revs) return <p className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Loading history…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] leading-snug text-muted">Every accepted AI change is recorded. Restoring never overwrites — the current state is kept too.</p>
        <Button size="sm" variant="secondary" disabled={readOnly || busy === "checkpoint"} onClick={checkpoint}><Save size={13} /> Checkpoint</Button>
      </div>
      {err && <p className="text-[12.5px] text-accent">{err}</p>}

      <Card className="flex flex-col divide-y-[0.5px] divide-hairline-strong">
        {list.map((r) => {
          const src = SOURCE[r.source];
          const isOpen = open === r.id;
          return (
            <div key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" aria-label={`Select ${r.label} to compare`} checked={picked.includes(r.id)} onChange={() => pick(r.id)} className="mt-1.5 accent-[var(--accent)]" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2"><span className="num font-mono text-[12px] text-dim">v{r.number}</span><Chip tone={src.tone}>{src.label}</Chip><span className="text-[12px] text-dim">{ago(r.created_at)}</span></span>
                  <span className="text-[13.5px] leading-snug">{r.label}</span>
                  {r.trace && <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="w-fit text-[12px] text-dim underline-offset-2 hover:text-text hover:underline">{isOpen ? "Hide details" : "What changed"}</button>}
                </div>
                <div className={cx("flex shrink-0 items-center gap-0.5", busy?.endsWith(r.id) && "pointer-events-none opacity-50")}>
                  <IconBtn label="Restore this version" disabled={readOnly} onClick={() => restore(r)}><RotateCcw size={13} /></IconBtn>
                  <IconBtn label="Duplicate as a new resume" onClick={() => duplicate(r)}><Copy size={13} /></IconBtn>
                </div>
              </div>
              {isOpen && r.trace && (
                <div className="ml-7 flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-[12.5px] leading-relaxed">
                  <span className="label">{r.trace.where}{r.trace.via ? ` · ${r.trace.via === "ai" ? "AI" : "built-in"}` : ""}</span>
                  {r.trace.before && <p className="text-dim line-through decoration-[1px] whitespace-pre-wrap">{r.trace.before}</p>}
                  {r.trace.after && <p className="whitespace-pre-wrap">{r.trace.after}</p>}
                  {r.trace.reason && <p className="text-dim">{r.trace.reason}</p>}
                  {r.trace.attested?.length ? <p className="text-amber">You confirmed as true: {r.trace.attested.join(", ")}</p> : null}
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <div className="flex items-center gap-2 text-[12px] text-dim">
        <GitCompare size={13} /> {picked.length === 2 ? "Comparing the two selected versions." : picked.length === 1 ? "Comparing the selected version with your current resume." : "Tick one version to compare with now, or two to compare with each other."}
      </div>
      {diff && (
        <Card className="flex flex-col gap-2 p-4">
          <Label>{diff.fromLabel} → {diff.toLabel}</Label>
          <div className="flex max-h-[360px] flex-col overflow-y-auto rounded-xl bg-surface-2 py-2 font-mono text-[12px] leading-relaxed">
            {diff.lines.filter((l) => l.text.trim()).map((l, i) => (
              <span key={i} className={cx("whitespace-pre-wrap px-3", l.kind === "added" && "bg-moss-soft text-text", l.kind === "removed" && "bg-accent-soft text-muted line-through decoration-[1px]", l.kind === "same" && "text-dim")}>
                <span aria-hidden className="mr-2 inline-block w-3 text-dim">{l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "}</span>{l.text}
              </span>
            ))}
            {diff.lines.every((l) => l.kind === "same") && <span className="px-3 text-dim">No differences.</span>}
          </div>
        </Card>
      )}
      {!list.length && <p className="flex items-center gap-2 text-[13px] text-muted"><History size={14} /> No history yet.</p>}
    </div>
  );
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-8 place-items-center rounded-full text-dim transition-colors hover:bg-surface-3 hover:text-text disabled:pointer-events-none disabled:opacity-30">{children}</button>;
}
