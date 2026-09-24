"use client";

import { ArrowUpRight, Check, Wand2 } from "lucide-react";
import Link from "next/link";
import { SaveButton, TrackButton } from "./actions";
import { Card, Label, LinkButton, cx } from "./ui";

/**
 * "Apply with FRIDAY": FRIDAY prepares; you submit. It opens the official application,
 * lets you pick an existing resume or review a tailored one, and tracks the application.
 * It never submits anything or claims a submission happened.
 */
export function ApplyPanel({ jobId, applyUrl, official, saved, applicationId, hasResume, latestVersionId }: { jobId: string; applyUrl: string; official: boolean; saved: boolean; applicationId: string | null; hasResume: boolean; latestVersionId: string | null }) {
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
          <Step n={2} done={false}>
            {hasResume ? (
              <>
                Choose the resume you&apos;ll send — you review it before anything is used.
                <span className="mt-2 flex flex-wrap gap-2">
                  <LinkButton size="sm" href={latestVersionId ? `/resume/${latestVersionId}` : "/resume"}>Use existing resume</LinkButton>
                  <LinkButton size="sm" href={`/resume/tailor/${jobId}`}><Wand2 size={14} /> Create tailored resume</LinkButton>
                </span>
              </>
            ) : (
              <>
                <Link href="/resume" className="underline decoration-hairline-strong underline-offset-4">Upload your resume</Link> so FRIDAY can prepare it.
              </>
            )}
          </Step>
          <Step n={3} done={Boolean(applicationId)}>Track it — FRIDAY drafts a cover letter and reminds you to follow up.</Step>
          <Step n={4} done={false}>Submit on the employer&apos;s site yourself, then mark it <span className="text-text">Applied</span> in your tracker.</Step>
        </ol>
        <p className="text-[11.5px] leading-snug text-dim">FRIDAY never submits applications, solves CAPTCHAs, or signs in on your behalf.</p>
      </div>
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
