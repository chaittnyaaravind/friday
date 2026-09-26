"use client";

import { Bookmark, BookmarkCheck, Check, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Input, Select, Textarea, cx } from "./ui";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

export function SaveButton({ jobId, saved: initial, compact }: { jobId: string; saved: boolean; compact?: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setSaved(!saved);
    try {
      await api(`/api/jobs/${jobId}/save`, { method: saved ? "DELETE" : "POST" });
    } catch {
      setSaved(saved);
    } finally {
      setBusy(false);
    }
  };
  const Icon = saved ? BookmarkCheck : Bookmark;
  if (compact) {
    return (
      <button onClick={toggle} disabled={busy} aria-pressed={saved} aria-label={saved ? "Unsave" : "Save"} className={cx("grid size-8 place-items-center rounded-full transition-colors", saved ? "text-accent" : "text-dim hover:bg-[rgb(var(--ink)/.06)] hover:text-text")}>
        <Icon size={16} strokeWidth={1.7} />
      </button>
    );
  }
  return (
    <Button onClick={toggle} disabled={busy} aria-pressed={saved}>
      <Icon size={15} strokeWidth={1.7} className={saved ? "text-accent" : undefined} />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}

export function TrackButton({ jobId, applicationId }: { jobId: string; applicationId?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (applicationId) {
    return (
      <Button onClick={() => router.push(`/applications?open=${applicationId}`)}>
        <Check size={15} /> In tracker
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const { application } = await api<{ application: { id: string } }>("/api/applications", { method: "POST", json: { jobId, status: "preparing" } });
            router.push(`/applications?open=${application.id}`);
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Track application
      </Button>
      {err && <span className="text-[12px] text-accent">{err}</span>}
    </div>
  );
}

export function FollowButton({ companyId, following: initial }: { companyId: string; following: boolean }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={following ? "secondary" : "ghost"}
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFollowing(!following);
        try {
          await api(`/api/companies/${companyId}/watch`, { method: following ? "DELETE" : "POST" });
        } catch {
          setFollowing(following);
        } finally {
          setBusy(false);
        }
      }}
    >
      {following ? <Check size={14} /> : <Plus size={14} />} {following ? "Following" : "Follow"}
    </Button>
  );
}

/** "Run FRIDAY now" — triggers discovery and reports honestly (including throttling / missing keys). */
export function RunAgentButton({ scope = "all", label = "Run FRIDAY now" }: { scope?: "all" | "sjsu" | "watchlist"; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <Button
        variant="secondary"
        disabled={busy || pending}
        onClick={async () => {
          setBusy(true);
          setMsg("Searching official sources… this takes about a minute.");
          try {
            const r = await api<{ companies: number; kept: number; newJobs: number; closed: number; failures: unknown[] }>("/api/agent/search", { method: "POST", json: { scope } });
            setMsg(`Checked ${r.companies} sources · ${r.newJobs} new · ${r.closed} closed${r.failures.length ? ` · ${r.failures.length} unavailable` : ""}`);
            startTransition(() => router.refresh());
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={15} className={cx(busy && "animate-spin")} /> {label}
      </Button>
      {msg && <span className="max-w-[320px] text-[12px] leading-snug text-muted md:text-right">{msg}</span>}
    </div>
  );
}

export function AnalyzeJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/agent/analyze-job", { method: "POST", json: { jobId } });
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Refine with FRIDAY
      </Button>
      {msg && <span className="text-[12px] text-muted">{msg}</span>}
    </div>
  );
}

/** Paste a listing from Handshake / LinkedIn / Indeed. FRIDAY never logs into those sites. */
export function ImportDialog({ defaultSource = "handshake", onCampus = false, trigger = "Import a listing", initial, defaultOpen = false }: { defaultSource?: "handshake" | "linkedin" | "indeed" | "other"; onCampus?: boolean; trigger?: string; initial?: Partial<{ url: string; title: string; company: string; location: string; description: string; source: "handshake" | "linkedin" | "indeed" | "other" }>; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ url: "", title: "", company: onCampus ? "SJSU" : "", location: onCampus ? "San Jose, CA" : "", description: "", pay: "", deadline: "", source: defaultSource, ...initial });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} /> {trigger}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 backdrop-blur-sm md:place-items-center" onClick={() => setOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                const { jobId } = await api<{ jobId: string }>("/api/jobs/import", {
                  method: "POST",
                  json: { ...f, pay: f.pay || null, deadline: f.deadline || null, location: f.location || null, description: f.description || null, onCampus },
                });
                setOpen(false);
                router.push(`/jobs/${jobId}`);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="reveal card flex max-h-[92dvh] w-full max-w-[560px] flex-col gap-4 overflow-auto rounded-b-none p-6 md:rounded-b-[16px]"
          >
            <div className="flex flex-col gap-1.5">
              <span className="label">Import</span>
              <h3 className="text-[22px]">Bring in a listing</h3>
              <p className="text-[13px] leading-relaxed text-muted">
                Paste a posting from Handshake, LinkedIn, Indeed, or anywhere. FRIDAY deduplicates it against everything it already found and keeps the official apply link when one exists. FRIDAY never signs in to those sites for you. <Link href="/import" className="text-accent underline-offset-2 hover:underline">Install the one-click bookmarklet</Link> to skip the copying.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source">
                <Select value={f.source} onChange={set("source")}>
                  <option value="handshake">SJSU Handshake</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="indeed">Indeed</option>
                  <option value="other">Company site / other</option>
                </Select>
              </Field>
              <Field label="Link to the posting">
                <Input required type="url" placeholder="https://…" value={f.url} onChange={set("url")} />
              </Field>
              <Field label="Job title">
                <Input required value={f.title} onChange={set("title")} placeholder="Software Engineering Intern" />
              </Field>
              <Field label={onCampus ? "Department" : "Company"}>
                <Input required value={f.company} onChange={set("company")} />
              </Field>
              <Field label="Location">
                <Input value={f.location} onChange={set("location")} placeholder="San Jose, CA" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pay">
                  <Input value={f.pay} onChange={set("pay")} placeholder="$22/hr" />
                </Field>
                <Field label="Deadline">
                  <Input type="date" value={f.deadline} onChange={set("deadline")} />
                </Field>
              </div>
            </div>
            <Field label="Description" hint="Paste the full text — FRIDAY uses it to find requirements and explain your match.">
              <Textarea value={f.description} onChange={set("description")} rows={6} />
            </Field>
            {err && <p className="text-[13px] text-accent">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy && <Loader2 size={15} className="animate-spin" />} Import
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
