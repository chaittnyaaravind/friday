import { AlertTriangle, ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyzeJobButton } from "@/components/actions";
import { ApplyPanel } from "@/components/apply-panel";
import { Reveal, Stagger } from "@/components/motion";
import { Card, Chip, CompanyMark, Label, Notice, cx } from "@/components/ui";
import { getJob } from "@/lib/data/jobs";
import { freshnessOf } from "@/lib/domain/freshness";
import { matchConcerns, relevantEvidence } from "@/lib/domain/insights";
import { authGuidance, learnSuggestion, type Gap, type Reason } from "@/lib/domain/match";
import { loadProfileItems } from "@/lib/resume/profile";
import { ago, deadlineLabel, longDate, miles, place, SOURCE_LABEL, TYPE_LABEL } from "@/lib/format";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">) {
  const db = await createSupabaseServer();
  const { data } = await db.from("jobs").select("title, companies(name)").eq("id", (await params).id).maybeSingle();
  return { title: data ? `${data.title} — ${(data.companies as unknown as { name: string } | null)?.name ?? ""}` : "Opportunity" };
}

type Req = { label: string; kind: "required" | "preferred"; skills: { slug: string; name: string } | null };
type Src = { source: string; source_name: string; url: string; is_official: boolean; first_seen_at: string; last_seen_at: string };

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const detail = await getJob(db, id, user.id).catch(() => null);
  if (!detail) notFound();
  const { job, match, saved, application } = detail;
  const [{ data: profile }, { count: resumes }, { data: latestResume }, profileItems] = await Promise.all([
    db.from("profiles").select("work_authorization, graduation_year, radius_miles").eq("id", user.id).single(),
    db.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db.from("resume_versions").select("id").eq("user_id", user.id).neq("kind", "legacy").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    loadProfileItems(db, user.id),
  ]);

  const company = job.companies as { slug: string; name: string; careers_url: string | null; industry: string | null; is_sjsu: boolean };
  const reqs = (job.job_requirements as Req[]) ?? [];
  const sources = ((job.job_sources as Src[]) ?? []).sort((a, b) => Number(b.is_official) - Number(a.is_official));
  const strong = (match?.strong as Reason[] | undefined) ?? [];
  const missing = (match?.missing as Gap[] | undefined) ?? [];
  const have = new Set(strong.filter((s) => s.kind === "skill").map((s) => s.label));
  const auth = authGuidance(profile?.work_authorization ?? null, { employmentType: job.employment_type, isOnCampus: job.is_on_campus, description: job.description });
  const dl = deadlineLabel(job.deadline);
  const primary = sources[0];
  const closed = job.status !== "active";
  const fresh = freshnessOf({ status: job.status, discovered_at: job.discovered_at, last_verified_at: job.last_verified_at, deadline: job.deadline });
  const concerns = matchConcerns({
    job: { title: job.title, description: job.description, isOnCampus: job.is_on_campus, isRemote: job.is_remote, status: job.status, discoveredAt: job.discovered_at, lastVerifiedAt: job.last_verified_at, deadline: job.deadline },
    profile: { graduationYear: profile?.graduation_year ?? null, workAuthorization: profile?.work_authorization ?? null, radiusMiles: profile?.radius_miles ?? 30 },
    distanceMiles: match?.distance_miles != null ? Number(match.distance_miles) : null,
    missingRequired: missing.filter((m) => m.kind === "required").map((m) => m.label),
  }).filter((c) => !(closed && /^(Closed|Expired)/.test(c.text))); // the closed notice already says this
  const evidence = relevantEvidence(profileItems, strong.filter((s) => s.kind === "skill").map((s) => s.label));
  const difficulty = match?.difficulty as "low" | "medium" | "high" | undefined;

  const facts: [string, React.ReactNode][] = [
    ["Company", <Link key="c" href={`/companies/${company.slug}`} className="hover:underline">{company.name}</Link>],
    ["Location", <>{place(job)}{match?.distance_miles != null && !job.is_on_campus ? <span className="num ml-2 font-mono text-[12px] text-dim">{miles(match.distance_miles)}</span> : null}{job.is_hybrid ? " · Hybrid" : ""}{job.is_remote ? " · Remote OK" : ""}</>],
    ["Type", `${TYPE_LABEL[job.employment_type]}${job.category && job.category !== "Campus" ? ` · ${job.category}` : ""}`],
    ...(job.department ? [["Department", job.department] as [string, React.ReactNode]] : []),
    ...(job.pay_text ? [["Pay", <span key="p" className="num">{job.pay_text}</span>] as [string, React.ReactNode]] : []),
    ...(job.hours_text ? [["Hours", job.hours_text] as [string, React.ReactNode]] : []),
    ...(job.is_on_campus ? [["Work-study", job.work_study === "unknown" ? "Not stated — check the posting" : job.work_study === "required" ? "Required" : job.work_study === "eligible" ? "Work-study eligible" : "Not required"] as [string, React.ReactNode]] : []),
    ["Deadline", dl ? <span key="d" className={cx(dl.urgent && "text-accent")}>{longDate(job.deadline)} · {dl.text}</span> : "Not stated"],
    ["Source", primary ? `${primary.is_official ? "Official — " : ""}${primary.source_name}` : "—"],
    ["Last verified", <span key="v" className="num">{longDate(job.last_verified_at)} <span className="text-dim">({ago(job.last_verified_at)})</span></span>],
  ];

  return (
    <div className="flex flex-col gap-10">
      <Link href="/discover" className="reveal inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft size={14} /> Discover
      </Link>

      <header className="reveal flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <CompanyMark name={company.name} size={44} />
          <div className="flex flex-col gap-1">
            <Link href={`/companies/${company.slug}`} className="text-[14px] text-muted hover:text-text">{company.name}</Link>
            <Label>{TYPE_LABEL[job.employment_type]} · {place(job)}</Label>
          </div>
        </div>
        <h1 className="max-w-[22ch] text-[34px] leading-[1.02] md:text-[52px]">{job.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={fresh.state === "new" || fresh.state === "recent" ? "moss" : fresh.state === "active" ? "neutral" : "amber"}>{fresh.label}</Chip>
          <span className="text-[12.5px] text-dim">{fresh.detail}</span>
        </div>
        {closed && <Notice tone="amber" title={fresh.state === "expired" ? "This listing has expired" : "This listing is no longer on the employer's site"}>FRIDAY last saw it {ago(job.last_verified_at)}. It may have closed — check the official page before applying.</Notice>}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-8">
          {/* Why this matches */}
          <Card className="reveal reveal-1 flex flex-col gap-6 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <Label>Why this matches</Label>
                <p className="text-[22px] leading-tight tracking-[-0.02em]">
                  {match ? (match.score >= 75 ? "Strong match" : match.score >= 55 ? "Good match" : "Stretch role") : "Not scored yet"}
                </p>
              </div>
              {match && (
                <div className="flex flex-col items-end gap-1">
                  <span className={cx("num font-mono text-[40px] font-light leading-none", match.score >= 75 ? "text-moss" : "text-text")}>{match.score}</span>
                  <span className="label">of 100</span>
                </div>
              )}
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Label className="!text-moss">Strong matches</Label>
                <ul className="flex flex-col gap-2">
                  {strong.length ? strong.map((s) => (
                    <li key={s.label} className="flex items-center gap-2.5 text-[14px]"><Check size={14} strokeWidth={2.4} className="text-moss" />{s.label}</li>
                  )) : <li className="text-[13px] text-muted">Add skills or a resume to see what lines up.</li>}
                </ul>
              </div>
              <div className="flex flex-col gap-3">
                <Label className="!text-amber">Missing requirements</Label>
                <ul className="flex flex-col gap-2">
                  {missing.length ? missing.map((m) => (
                    <li key={m.label} className="flex items-center gap-2.5 text-[14px]"><AlertTriangle size={14} strokeWidth={2} className="text-amber" />{m.label}{m.kind === "preferred" && <span className="label">preferred</span>}</li>
                  )) : <li className="text-[13px] text-muted">Nothing listed that you&apos;re missing.</li>}
                </ul>
              </div>
            </div>
            {(evidence.experience.length > 0 || evidence.projects.length > 0) && (
              <div className="flex flex-col gap-3 border-t-[0.5px] border-hairline-strong pt-5">
                <Label>Your relevant experience</Label>
                <ul className="flex flex-col gap-2 text-[14px]">
                  {evidence.experience.map((e) => (
                    <li key={`${e.title}-${e.organization}`}><span className="font-medium">{e.title}</span> · {e.organization} <span className="text-dim">— {e.skills.join(", ")}</span></li>
                  ))}
                  {evidence.projects.map((p) => (
                    <li key={p.name}><span className="font-medium">{p.name}</span> <span className="text-dim">(project) — {p.skills.join(", ")}</span></li>
                  ))}
                </ul>
                <p className="text-[12px] text-dim">Only items you confirmed on your profile, matched by the words already in them.</p>
              </div>
            )}
            {concerns.length > 0 && (
              <div className="flex flex-col gap-3 border-t-[0.5px] border-hairline-strong pt-5">
                <Label className="!text-amber">Things to check</Label>
                <ul className="flex flex-col gap-2">
                  {concerns.map((c) => (
                    <li key={c.text} className="flex items-start gap-2.5 text-[14px]"><AlertTriangle size={14} strokeWidth={2} className={cx("mt-1 shrink-0", c.severity === "warn" ? "text-amber" : "text-dim")} />{c.text}</li>
                  ))}
                </ul>
              </div>
            )}
            {difficulty && (
              <div className="flex flex-wrap items-center gap-3 border-t-[0.5px] border-hairline-strong pt-5">
                <Label>Application difficulty</Label>
                <div className="flex gap-1">
                  {(["low", "medium", "high"] as const).map((d) => (
                    <span key={d} className={cx("h-7 rounded-full px-3 text-[12.5px] leading-7 capitalize", d === difficulty ? "bg-text text-bg" : "text-dim hairline")}>{d}</span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Requirements vs profile */}
          <Reveal as="section" className="flex flex-col gap-4">
            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Label>Requirements · your profile</Label>
                <h2 className="text-[24px]">What they ask for</h2>
              </div>
              <AnalyzeJobButton jobId={job.id} />
            </div>
            {reqs.length ? (
              <Card className="divide-y-[0.5px] divide-hairline-strong">
                {[...reqs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "required" ? -1 : 1)).map((r) => {
                  const name = r.skills?.name ?? r.label;
                  const ok = have.has(name);
                  return (
                    <div key={r.label} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="flex items-center gap-2.5 text-[14px]">
                        {name}
                        {r.kind === "preferred" && <span className="label">preferred</span>}
                      </span>
                      {ok ? <Chip tone="moss" icon={<Check size={11} strokeWidth={2.4} />}>You have it</Chip> : <Chip icon={<AlertTriangle size={11} className="text-amber" />}>Missing</Chip>}
                    </div>
                  );
                })}
              </Card>
            ) : (
              <Card className="p-5 text-[14px] text-muted">
                {job.is_on_campus ? "On-campus postings rarely list technical requirements — open the application for eligibility and hours." : "FRIDAY couldn't find specific skill requirements in this posting. Use “Refine with FRIDAY” to read it in full."}
              </Card>
            )}
          </Reveal>

          {/* Learn */}
          {missing.length > 0 && (
            <Reveal as="section" className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Close the gap</Label>
                <h2 className="text-[24px]">What to learn next</h2>
              </div>
              <Stagger className="grid gap-2 sm:grid-cols-2">
                {missing.slice(0, 6).map((m) => (
                  <Card key={m.label} className="flex flex-col gap-2 p-4">
                    <span className="flex items-center gap-2 text-[14px]"><AlertTriangle size={13} className="text-amber" />{m.label}</span>
                    <p className="text-[13px] leading-relaxed text-muted">{learnSuggestion(m.label)}</p>
                  </Card>
                ))}
              </Stagger>
            </Reveal>
          )}

          {/* Description */}
          {job.description && (
            <Reveal as="section" className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>From the posting</Label>
                <h2 className="text-[24px]">Description</h2>
              </div>
              <Card className="p-6">
                <details className="group">
                  <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-text">
                    <span className="group-open:hidden">Show full description ↓</span>
                    <span className="hidden group-open:inline">Hide ↑</span>
                  </summary>
                  <div className="mt-4 whitespace-pre-line text-[14px] leading-[1.7] text-muted">{job.description}</div>
                </details>
              </Card>
            </Reveal>
          )}

          {/* Sources */}
          <Reveal as="section" className="flex flex-col gap-4">
            <Label>Where FRIDAY found this</Label>
            <Card className="divide-y-[0.5px] divide-hairline-strong">
              {sources.map((s, i) => (
                <a key={s.url + s.source} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-[rgb(var(--ink)/.03)]">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14px]">{i === 0 ? (s.is_official ? "Original source: " : "Source: ") : "Also found on "}{s.source_name}</span>
                    <span className="text-[12px] text-dim">{SOURCE_LABEL[s.source] ?? s.source} · first seen {ago(s.first_seen_at)} · last seen {ago(s.last_seen_at)}</span>
                  </span>
                  <ArrowUpRight size={15} className="shrink-0 text-dim" />
                </a>
              ))}
            </Card>
          </Reveal>
        </div>

        {/* Sticky apply rail */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
          <ApplyPanel jobId={job.id} applyUrl={job.apply_url} official={job.apply_url_is_official} saved={saved} applicationId={application?.id ?? null} hasResume={(resumes ?? 0) > 0} latestVersionId={latestResume?.id ?? null} />
          {auth.status !== "not_applicable" && (
            <Notice tone={auth.status === "posting_restricts" ? "accent" : auth.status === "potentially_relevant" ? "moss" : "amber"} title={auth.headline}>
              {auth.detail}{" "}
              {auth.link && <a href={auth.link} target="_blank" rel="noopener noreferrer" className="underline decoration-hairline-strong underline-offset-4 hover:text-text">SJSU ISSS →</a>}
            </Notice>
          )}
          <Card className="divide-y-[0.5px] divide-hairline-strong">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-3">
                <span className="label shrink-0">{k}</span>
                <span className="text-right text-[13.5px]">{v}</span>
              </div>
            ))}
          </Card>
        </aside>
      </div>
    </div>
  );
}
