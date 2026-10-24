"use client";

import { Check, Copy, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "./actions";
import { Button, Card, Label } from "./ui";

type Status = {
  configured: { telegram: boolean; bot: string | null };
  enabled: boolean;
  telegram: { linked: boolean; linkedAt: string | null };
  bridge: { connected: boolean; createdAt: string | null; seenAt: string | null };
  recent: { id: string; state: string; error: string | null; created_at: string; jobs: { title: string; companies: { name: string } | null } | null }[];
};

const STATE_LABEL: Record<string, string> = {
  queued: "Preparing", notified: "Waiting for your approval", approved: "Approving", sending: "Sending from your Gmail", sent: "Sent", handed_off: "Approved — submit on the official page",
  applied: "Applied", skipped: "Skipped", failed: "Failed", stale: "Closed before it was ready",
};

const ago = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never");

/**
 * Auto Hunter: new SJSU desk jobs arrive in Telegram ready to approve, and approved email applications go out from the
 * student's own Gmail through the bridge script. Nothing is sent that the student did not approve.
 */
export function AutoHunter() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; link: string | null } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => api<Status>("/api/hunter").then(setS).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <Card className="p-6 md:p-8"><Label>Auto Hunter</Label><p className="mt-2 text-[13px] text-muted">{err ?? "Loading…"}</p></Card>;

  return (
    <Card className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-1.5">
        <Label>Auto Hunter</Label>
        <p className="max-w-[64ch] text-[13px] leading-snug text-muted">
          FRIDAY checks the official SJSU hiring pages every 5 minutes. For each new desk job it tailors your resume, prepares the application and sends it to Telegram. One tap approves it. Email applications then go out from your own Gmail; everything else comes back to you with the resume PDF and the official link. Nothing is ever sent without your approval.
        </p>
      </div>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-[14px] font-medium">1 · Telegram</h3>
        {!s.configured.telegram ? (
          <p className="text-[13px] text-amber">Telegram isn’t set up on this server yet (TELEGRAM_BOT_TOKEN).</p>
        ) : s.telegram.linked ? (
          <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
            <span className="inline-flex items-center gap-1.5 text-moss"><Check size={14} /> Linked {ago(s.telegram.linkedAt)}</span>
            <Button size="sm" onClick={() => run("unlink", () => api("/api/hunter/telegram", { method: "DELETE" }))} disabled={busy === "unlink"}>Unlink</Button>
            <Button size="sm" onClick={() => run("pause", () => api("/api/hunter", { method: "PATCH", json: { enabled: !s.enabled } }))} disabled={busy === "pause"}>{s.enabled ? "Pause" : "Resume"} hunting</Button>
          </div>
        ) : code ? (
          <div className="flex flex-col gap-2 text-[13.5px]">
            {code.link ? (
              <a href={code.link} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-2 rounded-full bg-text px-4 py-2 text-bg"><Send size={14} /> Open the FRIDAY bot and tap Start</a>
            ) : null}
            <span className="text-muted">Or send this code to the bot: <span className="num font-mono text-text">{code.code}</span> (valid 15 minutes)</span>
            <Button size="sm" className="w-fit" onClick={() => void load()}>I’ve sent it — check</Button>
          </div>
        ) : (
          <Button size="sm" variant="primary" className="w-fit" onClick={() => run("link", async () => setCode(await api("/api/hunter/telegram", { method: "POST" })))} disabled={busy === "link"}>
            {busy === "link" ? <Loader2 size={14} className="animate-spin" /> : null} Connect Telegram
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="text-[14px] font-medium">2 · Gmail bridge (Handshake alerts + sending)</h3>
        <p className="max-w-[64ch] text-[12.5px] leading-snug text-muted">
          A small Google Apps Script in your own Gmail. Every 5 minutes it passes your Handshake job-alert emails to FRIDAY and sends the email applications you approved. FRIDAY never logs in to Handshake. Turn on Handshake’s job alerts (Handshake → Saved searches → email) so new postings reach your inbox.
        </p>
        {token ? (
          <div className="flex flex-col gap-2 text-[13px]">
            <span className="text-amber">Copy this token now. It is shown only once.</span>
            <div className="flex items-center gap-2">
              <code className="num max-w-full overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-[12px] hairline">{token}</code>
              <Button size="sm" onClick={() => { void navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</Button>
            </div>
            <ol className="ml-4 list-decimal text-muted">
              <li>Open script.google.com → New project, and paste <span className="font-mono">scripts/gmail-bridge.gs</span> from the FRIDAY repo.</li>
              <li>Project Settings → Script properties: <span className="font-mono">FRIDAY_URL</span> = {typeof window === "undefined" ? "" : window.location.origin}, <span className="font-mono">FRIDAY_TOKEN</span> = the token above.</li>
              <li>Run <span className="font-mono">setup</span> once and allow access.</li>
            </ol>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
          {s.bridge.connected ? <span className={s.bridge.seenAt ? "text-moss" : "text-amber"}>{s.bridge.seenAt ? `Bridge last checked in ${ago(s.bridge.seenAt)}` : "Token created — waiting for the script’s first run"}</span> : null}
          <Button size="sm" variant={s.bridge.connected ? "secondary" : "primary"} onClick={() => run("token", async () => setToken((await api<{ token: string }>("/api/hunter/bridge", { method: "POST" })).token))} disabled={busy === "token"}>
            {s.bridge.connected ? "New token" : "Connect Gmail"}
          </Button>
          {s.bridge.connected ? <Button size="sm" onClick={() => run("unbridge", () => api("/api/hunter/bridge", { method: "DELETE" }))}>Disconnect</Button> : null}
        </div>
      </section>

      {s.recent.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[14px] font-medium">Recent</h3>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {s.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-4">
                <span>{r.jobs?.title ?? "Job"} <span className="text-muted">· {r.jobs?.companies?.name ?? ""}</span></span>
                <span className={r.state === "failed" ? "text-accent" : "text-muted"} title={r.error ?? undefined}>{STATE_LABEL[r.state] ?? r.state}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {err ? <p className="text-[13px] text-accent">{err}</p> : null}
    </Card>
  );
}
