import { AlertTriangle, Check } from "lucide-react";
import Link from "next/link";
import type { JobListItem } from "@/lib/data/jobs";
import { CAMPUS_EMPLOYER_LABEL, CAMPUS_ROLE_LABEL, isCampusEmployer, isCampusRole } from "@/lib/domain/campus";
import { freshnessOf } from "@/lib/domain/freshness";
import { ago, deadlineLabel, miles, place, TYPE_LABEL } from "@/lib/format";
import { SaveButton } from "./actions";
import { Stagger } from "./motion";
import { Card, Chip, CompanyMark, EmptyState, MatchBadge, cx } from "./ui";

export function JobCard({ job }: { job: JobListItem }) {
  const dl = deadlineLabel(job.deadline);
  // The feed only lists active jobs, so this reflects how recently a source confirmed it.
  const fresh = freshnessOf({ status: "active", discovered_at: job.discovered_at, last_verified_at: job.last_verified_at, deadline: job.deadline, is_baseline: job.is_baseline });
  // Where a listing came from, stated plainly: the student's own import, or an aggregator with no employer feed behind it.
  const imported = job.sources.some((s) => /_import$/.test(s.source) || s.source === "manual");
  const viaAdzuna = !imported && !job.sources.some((s) => s.official) && job.sources.some((s) => s.source === "adzuna");
  const strongSkills = (job.strong ?? []).filter((r) => r.kind === "skill").slice(0, 3);
  const missing = (job.missing ?? []).filter((m) => m.kind === "required").slice(0, 2);
  const official = job.sources.find((s) => s.official) ?? job.sources[0];
  const alsoOn = job.sources.filter((s) => s !== official).map((s) => s.name.replace(/\s*\(.*\)$/, ""));
  // SJSU jobs: the campus role the title names and the campus employer — only when known, never guessed.
  const campusRole = job.is_on_campus ? (job.campus_roles ?? []).find(isCampusRole) : undefined;
  const campusEmployer = job.is_on_campus && isCampusEmployer(job.campus_employer) && job.campus_employer !== "other" ? job.campus_employer : null;

  return (
    <Link href={`/jobs/${job.id}`} className="block h-full">
      <Card interactive className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <CompanyMark name={job.company_name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-muted">{job.company_name}</p>
            <h3 className="mt-0.5 line-clamp-2 text-[16px] font-[480] leading-snug tracking-[-0.012em]">{job.title}</h3>
          </div>
          <SaveButton jobId={job.id} saved={job.saved} compact />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          <span>{place(job)}</span>
          {job.distance_miles != null && !job.is_on_campus && <span className="num font-mono text-[11.5px] text-dim">{miles(job.distance_miles)}</span>}
          {job.is_hybrid && <span>Hybrid</span>}
          {job.is_remote && job.city && <span>Remote OK</span>}
          {job.pay_text && <span className="num">{job.pay_text}</span>}
          {job.hours_text && <span>{job.hours_text}</span>}
        </div>

        {(strongSkills.length > 0 || missing.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {strongSkills.map((s) => (
              <Chip key={s.label} tone="moss" icon={<Check size={11} strokeWidth={2.4} />}>{s.label}</Chip>
            ))}
            {missing.map((m) => (
              <Chip key={m.label} icon={<AlertTriangle size={11} strokeWidth={2} className="text-amber" />}>{m.label}</Chip>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-1">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {fresh.state !== "active" && <Chip tone={fresh.state === "new" || fresh.state === "recent" ? "moss" : "amber"}>{fresh.label}</Chip>}
              {/* Eligibility is separate from the score: a strong match can still need a check, or be likely blocked. Nothing is shown for "clear". */}
              {job.eligibility === "verify" && <Chip tone="amber" icon={<AlertTriangle size={11} strokeWidth={2} />}>Verify eligibility</Chip>}
              {job.eligibility === "blocked" && <Chip tone="accent" icon={<AlertTriangle size={11} strokeWidth={2} />}>Likely blocked</Chip>}
              {imported && <Chip tone="accent">Imported by you</Chip>}
              {viaAdzuna && <Chip>via Adzuna</Chip>}
              <span className="label">{TYPE_LABEL[job.employment_type]}</span>
              {job.category && job.category !== "Campus" && <span className="label">· {job.category}</span>}
              {campusRole && campusRole !== "other" && <span className="label">· {CAMPUS_ROLE_LABEL[campusRole]}</span>}
              {campusEmployer && <span className="label">· {CAMPUS_EMPLOYER_LABEL[campusEmployer]}</span>}
              {job.work_study !== "unknown" && job.work_study !== "not_required" && <span className="label !text-amber">· Work-study {job.work_study}</span>}
            </div>
            <span className="truncate text-[11.5px] text-dim">
              {dl ? <span className={cx(dl.urgent && "text-accent")}>{dl.text} · </span> : null}
              {official?.official ? "Official" : "Source"}: {official?.name.replace(/\s*\(.*\)$/, "") ?? "—"}
              {alsoOn.length ? ` · also on ${alsoOn.join(", ")}` : ""}
              {/* First seen by FRIDAY — not when the employer posted it — and only when it is not a baseline find. */}
              {job.is_baseline ? "" : ` · first seen ${ago(job.discovered_at)}`} · verified {ago(job.last_verified_at)}
            </span>
          </div>
          <MatchBadge score={job.score} />
        </div>
      </Card>
    </Link>
  );
}

export function JobGrid({ jobs, empty }: { jobs: JobListItem[]; empty?: { title: string; body?: React.ReactNode; action?: React.ReactNode } }) {
  if (!jobs.length) return <EmptyState title={empty?.title ?? "Nothing here yet"} body={empty?.body} action={empty?.action} />;
  return (
    <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </Stagger>
  );
}
