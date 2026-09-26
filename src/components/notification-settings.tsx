"use client";

import { Check, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import type { NotificationPrefs } from "@/lib/domain/notify-prefs";
import { api } from "./actions";
import { Card, Label, Select } from "./ui";

type Row<G extends "email" | "in_app"> = { group: G; key: keyof NotificationPrefs[G] & string; label: string; hint: string };
const EMAIL_ROWS: Row<"email">[] = [
  { group: "email", key: "new_matches", label: "New matching opportunities", hint: "A short daily email, only when something new clears your match threshold." },
  { group: "email", key: "follow_ups", label: "Follow-up reminders", hint: "When a follow-up is due." },
  { group: "email", key: "interviews", label: "Interview reminders", hint: "The day before a scheduled interview." },
  { group: "email", key: "status_changes", label: "Saved jobs that close", hint: "When a job you saved is no longer open." },
];
const APP_ROWS: Row<"in_app">[] = [
  { group: "in_app", key: "new_matches", label: "New matching opportunities", hint: "Including new SJSU on-campus jobs." },
  { group: "in_app", key: "follow_ups", label: "Follow-ups due", hint: "" },
  { group: "in_app", key: "interviews", label: "Interviews approaching", hint: "" },
  { group: "in_app", key: "closing_soon", label: "Saved jobs closing soon", hint: "Deadlines within three days." },
  { group: "in_app", key: "resume", label: "Resume tailoring finished", hint: "" },
  { group: "in_app", key: "source_updates", label: "New opportunity sources", hint: "When FRIDAY starts checking more employers. Off by default." },
];

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-3 py-2.5">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
      <span className="flex flex-col">
        <span className="text-[14px]">{label}</span>
        {hint && <span className="text-[12.5px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Notification preferences. Every change saves immediately; nothing here is sent anywhere until you enable it. */
export function NotificationSettings({ initial, emailOn, emailConfigured }: { initial: NotificationPrefs; emailOn: boolean; emailConfigured: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [email, setEmail] = useState(emailOn);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = async (body: { notification_prefs?: NotificationPrefs; email_alerts?: boolean }) => {
    setState("saving");
    setErr(null);
    try {
      await api("/api/profile", { method: "PATCH", json: body });
      setState("saved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 2200);
    } catch (e) {
      setState("error");
      setErr((e as Error).message);
    }
  };
  const update = (next: NotificationPrefs) => {
    setPrefs(next);
    void save({ notification_prefs: next });
  };

  return (
    <Card className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Notifications</Label>
          <p className="max-w-[56ch] text-[13.5px] leading-relaxed text-muted">Choose what FRIDAY tells you about. It stays quiet by default: a few useful messages, never a stream.</p>
        </div>
        <span role="status" className="flex h-6 shrink-0 items-center gap-1.5 text-[12px] text-dim">
          {state === "saving" && <><Loader2 size={12} className="animate-spin" /> Saving…</>}
          {state === "saved" && <><Check size={12} /> Saved</>}
          {state === "error" && <span className="text-accent">Not saved</span>}
        </span>
      </div>
      {err && <p className="text-[13px] text-accent">{err}</p>}

      <div className="grid gap-8 md:grid-cols-2">
        <section className="flex flex-col gap-1" aria-label="Email">
          <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-hairline-strong pb-2">
            <span className="label">Email</span>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={email} onChange={(e) => { setEmail(e.target.checked); void save({ email_alerts: e.target.checked }); }} className="size-4 accent-[var(--accent)]" />
              Email me
            </label>
          </div>
          {!emailConfigured && (
            <p className="rounded-xl bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">Email delivery isn&apos;t set up on this server yet. Your choices are saved and will apply as soon as it is — nothing is being sent now.</p>
          )}
          {EMAIL_ROWS.map((r) => (
            <Toggle key={r.key} label={r.label} hint={r.hint} disabled={!email} checked={prefs.email[r.key]} onChange={(v) => update({ ...prefs, email: { ...prefs.email, [r.key]: v } })} />
          ))}
        </section>

        <section className="flex flex-col gap-1" aria-label="In the app">
          <div className="border-b-[0.5px] border-hairline-strong pb-2"><span className="label">In FRIDAY</span></div>
          {APP_ROWS.map((r) => (
            <Toggle key={r.key} label={r.label} hint={r.hint} checked={prefs.in_app[r.key]} onChange={(v) => update({ ...prefs, in_app: { ...prefs.in_app, [r.key]: v } })} />
          ))}
        </section>
      </div>

      <label className="flex flex-col gap-2 border-t-[0.5px] border-hairline-strong pt-5 sm:max-w-[340px]">
        <span className="text-[14px]">Only alert me about matches of at least</span>
        <Select value={String(prefs.min_match_score)} onChange={(e) => update({ ...prefs, min_match_score: Number(e.target.value) })} aria-label="Minimum match score">
          {[55, 60, 65, 70, 75, 80, 85, 90].map((n) => <option key={n} value={n}>{n}% match{n === 70 ? " (default)" : ""}</option>)}
        </Select>
        <span className="text-[12.5px] text-muted">On-campus SJSU jobs and companies you follow always notify you.</span>
      </label>
    </Card>
  );
}
