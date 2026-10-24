import { Check, Circle, CircleHelp } from "lucide-react";
import type { MatchStatus } from "@/lib/resume/jobmatch";
import { reportSummary, type TailoringReport } from "@/lib/resume/report";
import type { TermChangeRecord } from "@/lib/resume/terminology";
import type { Issue } from "@/lib/resume/validate";
import { Card, Chip, Label, Notice } from "../ui";

const STATUS: Record<MatchStatus, { word: string; tone: "moss" | "amber" | "neutral"; icon: typeof Check }> = {
  matched: { word: "On your resume", tone: "moss", icon: Check },
  weak: { word: "Only lightly shown", tone: "amber", icon: CircleHelp },
  unclear: { word: "Unclear", tone: "amber", icon: CircleHelp },
  missing: { word: "Not on your resume", tone: "neutral", icon: Circle },
};
const ORDER: MatchStatus[] = ["matched", "weak", "unclear", "missing"];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });

/**
 * The permanent record of one tailoring run: what the job asked for and where your resume shows it, what was NOT added,
 * what changed against the baseline, every ATS spelling change, and a fresh check of the resume as it is now.
 */
export function TailoringReportPanel({ report, createdAt, verifiedNow }: {
  report: TailoringReport;
  createdAt: string;
  verifiedNow: { ok: boolean; issues: Issue[] };
}) {
  const requirements = [...report.requirements].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <section className="flex flex-col gap-6" aria-label="Tailoring report">
      <div className="flex flex-col gap-1">
        <Label>Tailoring report</Label>
        <p className="text-[15px]">{reportSummary(report)}</p>
        <p className="text-[12.5px] text-dim">
          For {report.job.title}{report.job.company ? ` at ${report.job.company}` : ""} · made {day(createdAt)} · compared with {report.baseline.source === "master" ? "your master resume" : "a resume built from your whole profile"}
        </p>
      </div>

      {verifiedNow.ok ? (
        <Notice tone="moss" title="Every line on this resume is supported by your profile.">Checked just now against what you&rsquo;ve confirmed — including any edits you&rsquo;ve made since.</Notice>
      ) : (
        <Notice tone="accent" title={`${verifiedNow.issues.length} claim${verifiedNow.issues.length === 1 ? "" : "s"} without supporting evidence`}>
          <ul className="mt-1 flex flex-col gap-1">
            {verifiedNow.issues.map((i, n) => <li key={n}>“{i.claim}” in {i.where} — {i.reason}</li>)}
          </ul>
        </Notice>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <Label>What the job asks for</Label>
        <ul className="flex flex-col gap-3">
          {requirements.map((r) => {
            const s = STATUS[r.status];
            const Icon = s.icon;
            return (
              <li key={`${r.kind}-${r.name}`} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-[14px]">
                  <Icon size={14} className={r.status === "matched" ? "text-moss" : "text-dim"} aria-hidden />
                  <span>{r.name}</span>
                  <Chip tone={s.tone}>{s.word}</Chip>
                  {r.kind !== "required" && <span className="text-[12px] text-dim">{r.kind === "preferred" ? "preferred" : "named in the posting"}</span>}
                </div>
                <p className="pl-[22px] text-[12.5px] leading-snug text-muted">{r.message}</p>
                {r.evidence.map((e, i) => <p key={i} className="pl-[22px] text-[12.5px] text-dim">“{e.text}” — {e.where}</p>)}
              </li>
            );
          })}
          {!requirements.length && <p className="text-[13.5px] text-muted">FRIDAY didn&rsquo;t detect specific requirements in this posting.</p>}
        </ul>
        {!!report.missing.length && (
          <p className="border-t-[0.5px] border-hairline-strong pt-3 text-[12.5px] leading-relaxed text-muted">
            Not added to your resume: {report.missing.join(", ")}. If you genuinely have one, add it to your profile first — FRIDAY won&rsquo;t write a skill you haven&rsquo;t confirmed.
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <Label>What changed</Label>
        {report.changedSections.length ? (
          <ul className="flex flex-col gap-2.5">
            {report.changedSections.map((c) => (
              <li key={c.title} className="flex flex-col gap-0.5 text-[13.5px]">
                <span className="flex flex-wrap items-center gap-2">{c.title}{c.changes.map((k) => <Chip key={k}>{k}</Chip>)}</span>
                <span className="text-[12.5px] text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13.5px] text-muted">Nothing differs from the baseline.</p>}
        {!!report.excluded.length && (
          <div className="flex flex-col gap-1 border-t-[0.5px] border-hairline-strong pt-3">
            <span className="text-[12px] text-dim">Left out</span>
            {report.excluded.map((e) => <p key={e.label} className="text-[13px] text-muted">{e.label} <span className="text-dim">— {e.reason}</span></p>)}
          </div>
        )}
      </Card>

      <TerminologyChanges changes={report.terminology} />

      {!!report.notes.length && (
        <ul className="flex flex-col gap-1 text-[12.5px] leading-relaxed text-dim">
          {report.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

/** ATS spelling changes: the same skill written the way the posting writes it. Shown before and after so none is hidden. */
export function TerminologyChanges({ changes }: { changes: TermChangeRecord[] }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <Label>ATS spelling changes</Label>
        <span className="num font-mono text-[12px] text-dim">{changes.length}</span>
      </div>
      {changes.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {changes.map((c, i) => (
              <li key={i} className="flex flex-col gap-1 text-[13.5px]">
                <span className="flex flex-wrap items-center gap-2"><span className="text-dim line-through decoration-[0.5px]">{c.from}</span> → <span>{c.to}</span><span className="text-[12px] text-dim">{c.where}</span></span>
                <span className="text-[12.5px] text-dim line-through decoration-[0.5px]">{c.before}</span>
                <span className="text-[12.5px] text-muted">{c.after}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] leading-relaxed text-dim">Same skill, spelled the way the posting spells it, so applicant-tracking software matches it. None of these adds a skill you didn&rsquo;t already list.</p>
        </>
      ) : <p className="text-[13.5px] text-muted">No spelling changes — the posting and your resume already use the same names.</p>}
    </Card>
  );
}
