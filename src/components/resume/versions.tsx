"use client";

import { Copy, GitCompare, History, Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "../actions";
import { Button, Card, Chip, Input, cx } from "../ui";

export type VersionRow = { id: string; label: string; kind: "base" | "tailored" | "copy" | "legacy"; when: string; job: string | null; copied: boolean; master: boolean };

const KIND: Record<VersionRow["kind"], string> = { base: "From profile", tailored: "Tailored", copy: "Copy", legacy: "Legacy · read-only" };

export function BuildResumeButton({ label = "Build resume from profile", disabled }: { label?: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="primary" disabled={busy || disabled} onClick={async () => {
        setBusy(true);
        setErr(null);
        try {
          const { version } = await api<{ version: { id: string } }>("/api/resumes/versions", { method: "POST", json: {} });
          router.push(`/resume/${version.id}`);
        } catch (e) {
          setErr((e as Error).message);
          setBusy(false);
        }
      }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {label}</Button>
      {err && <p className="text-[12.5px] text-accent">{err}</p>}
    </div>
  );
}

/** Version history: open, rename, duplicate, restore (as a new copy), delete, compare. */
export function VersionList({ versions }: { versions: VersionRow[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const pick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const rename = (v: VersionRow) => {
    setRenaming(null);
    if (name.trim() && name.trim() !== v.label) act(v.id, () => api(`/api/resumes/versions/${v.id}`, { method: "PATCH", json: { label: name.trim() } }));
  };

  if (!versions.length) return <p className="text-[13.5px] text-muted">No resumes yet. Review your profile, then build one.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {picked.length === 2 ? (
          <Link href={`/resume/compare?a=${picked[0]}&b=${picked[1]}`} className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline"><GitCompare size={14} /> Compare selected</Link>
        ) : <span className="text-[12px] text-dim">Tick two to compare</span>}
      </div>
      <Card className="flex flex-col divide-y-[0.5px] divide-hairline-strong">
        {versions.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            {v.kind !== "legacy" && (
              <input type="checkbox" aria-label={`Select ${v.label} to compare`} checked={picked.includes(v.id)} onChange={() => pick(v.id)} className="accent-[var(--accent)]" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {renaming === v.id ? (
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => rename(v)} onKeyDown={(e) => { if (e.key === "Enter") rename(v); if (e.key === "Escape") setRenaming(null); }} className="h-8 text-[14px]" aria-label="New name" />
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <Link href={`/resume/${v.id}`} className="truncate text-[14.5px] hover:text-accent">{v.label}</Link>
                  {v.master && <Chip tone="accent">Master</Chip>}
                </span>
              )}
              <span className="text-[12px] text-dim">{KIND[v.kind]}{v.job ? ` · ${v.job}` : ""}{v.copied ? " · copied from an earlier version" : ""} · {v.when}</span>
            </div>
            {v.kind === "legacy" ? <Chip tone="amber">legacy</Chip> : (
              <div className={cx("flex items-center gap-0.5", busy === v.id && "pointer-events-none opacity-50")}>
                {v.kind === "base" && (
                  <Icon label={v.master ? "Stop using as my master resume" : "Make this my master resume"} onClick={() => act(v.id, () => api(`/api/resumes/versions/${v.id}/master`, { method: v.master ? "DELETE" : "POST" }))}>
                    <Star size={13} className={v.master ? "fill-current text-accent" : ""} />
                  </Icon>
                )}
                <Icon label="Rename" onClick={() => { setRenaming(v.id); setName(v.label); }}><Pencil size={13} /></Icon>
                <Icon label="Duplicate" onClick={() => act(v.id, () => api(`/api/resumes/versions/${v.id}`, { method: "POST", json: { action: "duplicate" } }))}><Copy size={13} /></Icon>
                <Icon label="Restore as a new version" onClick={() => act(v.id, () => api(`/api/resumes/versions/${v.id}`, { method: "POST", json: { action: "restore" } }))}><History size={13} /></Icon>
                <Icon label="Delete" onClick={() => { if (confirm(`Delete “${v.label}”? Your original upload and profile are not affected.`)) act(v.id, () => api(`/api/resumes/versions/${v.id}`, { method: "DELETE" })); }}><Trash2 size={13} /></Icon>
              </div>
            )}
          </div>
        ))}
      </Card>
      {err && <p className="text-[12.5px] text-accent">{err}</p>}
    </div>
  );
}

function Icon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-8 place-items-center rounded-full text-dim transition-colors hover:bg-surface-2 hover:text-text">
      {children}
    </button>
  );
}
