"use client";

import { ArrowUpRight, Check, Loader2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { skillBySlug } from "@/lib/domain/skills";
import { api, SaveButton, TrackButton } from "./actions";
import { Button, Card, Chip, Label, cx } from "./ui";

type Tailored = {
  version: { id: string; label: string };
  tailored: { changes: { what: string; why: string }[]; suggestions: string[] };
  keywords: { covered: string[]; missing: string[] };
};

/**
 * "Apply with FRIDAY": FRIDAY prepares; you submit. It opens the official application,
 * drafts a tailored resume from your real experience, and tracks the application.
 * It never submits anything or claims a submission happened.
 */
export function ApplyPanel({ jobId, applyUrl, official, saved, applicationId, hasResume }: { jobId: string; applyUrl: string; official: boolean; saved: boolean; applicationId: string | null; hasResume: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Tailored | null>(null);

  const tailor = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api<Tailored>("/api/resumes/tailor", { method: "POST", json: { jobId } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-3">
        <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 text-[15px] font-medium text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/.18)] transition-[background-color,transform] duration-150 hover:bg-accent-hover active:scale-[.97]">
          Apply on {official ? "official site" : "source site"} <ArrowUpRight size={16} />
        </a>
        <div className="grid grid-cols-2 gap-2">
          <SaveButton jobId={jobId} saved={saved} />
          <TrackButton jobId={jobId} applicationId={applicationId} />
        </div>
      </div>

      <div className="rule-dashed" />

      <div className="flex flex-col gap-3">
        <Label>Apply with FRIDAY</Label>
        <ol className="flex flex-col gap-2.5 text-[13.5px]">
          <Step n={1} done={false}>Open the original application above and read what it asks for.</Step>
          <Step n={2} done={Boolean(result)}>
            {hasResume ? (
              <>
                Draft a tailored resume from your real experience.{" "}
                {!result && (
                  <Button size="sm" variant="secondary" onClick={tailor} disabled={busy} className="mt-2">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {busy ? "Tailoring…" : "Tailor my resume"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Link href="/resume" className="underline decoration-hairline-strong underline-offset-4">Upload your resume</Link> so FRIDAY can tailor it.
              </>
            )}
          </Step>
          <Step n={3} done={Boolean(applicationId)}>Track it — FRIDAY drafts a cover letter and reminds you to follow up.</Step>
          <Step n={4} done={false}>Submit on the employer&apos;s site yourself, then mark it <span className="text-text">Applied</span> in your tracker.</Step>
        </ol>
        <p className="text-[11.5px] leading-snug text-dim">FRIDAY never submits applications, solves CAPTCHAs, or signs in on your behalf.</p>
        {err && <p className="text-[12.5px] text-accent">{err}</p>}
      </div>

      {result && (
        <div className="reveal flex flex-col gap-3">
          <div className="rule-dashed" />
          <Label>Tailored draft saved</Label>
          <div className="flex flex-wrap gap-1.5">
            {result.keywords.covered.slice(0, 8).map((s) => (
              <Chip key={s} tone="moss" icon={<Check size={11} strokeWidth={2.4} />}>{skillBySlug(s)?.name ?? s}</Chip>
            ))}
            {result.keywords.missing.slice(0, 6).map((s) => (
              <Chip key={s}>{skillBySlug(s)?.name ?? s} — not on resume</Chip>
            ))}
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px] text-muted">
            {result.tailored.changes.slice(0, 4).map((c, i) => (
              <li key={i}>
                <span className="text-text">{c.what}</span> — {c.why}
              </li>
            ))}
          </ul>
          <Link href={`/resume?version=${result.version.id}`} className="text-[13px] text-text underline decoration-hairline-strong underline-offset-4">
            Review, edit & download →
          </Link>
        </div>
      )}
    </Card>
  );
}

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10.5px]", done ? "bg-moss-soft text-moss" : "text-dim hairline")}>{done ? <Check size={11} strokeWidth={2.6} /> : n}</span>
      <span className="leading-snug text-muted">{children}</span>
    </li>
  );
}
