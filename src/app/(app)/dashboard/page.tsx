import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { RunAgentButton } from "@/components/actions";
import { JobGrid } from "@/components/job-card";
import { ResumeSteps } from "@/components/resume/status";
import { CountUp, Reveal, Stagger } from "@/components/motion";
import { Card, CompanyMark, Label, LinkButton, MatchBadge, Notice, SectionHeader, cx } from "@/components/ui";
import { AnalyticsPanel, TodayPanel, type TodayItem } from "@/components/dashboard-panels";
import { searchJobs } from "@/lib/data/jobs";
import { normalizeCampusPrefs } from "@/lib/domain/campus-fit";
import { SJSU_ONLY } from "@/lib/scope";
import { analyze } from "@/lib/domain/analytics";
import { resumeStatus } from "@/lib/resume/profile";
import { ago, greeting, miles, place, TYPE_LABEL } from "@/lib/format";
import { createSupabaseServer, isAdminConfigured, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const { data: profile } = await db.from("profiles").select("full_name, radius_miles, origin_label, work_authorization, campus_prefs").eq("id", user.id).single();
  const radius = profile?.radius_miles ?? 25;

  const [best, fresh, campus, interns, nearby, apps, interviews, follows, deadlines, lastRun, digest, resume, dueFollows, soonInterviews, allApps] = await Promise.all([
    // SJSU mode ranks exactly like /sjsu: campus fit, the student's desk-only preference, every open job (not only new ones).
    SJSU_ONLY ? searchJobs(db, { onCampus: true, deskOnly: normalizeCampusPrefs(profile?.campus_prefs).deskOnly, sort: "fit", limit: 6 }) : searchJobs(db, { postedWithinDays: 14, sort: "match", limit: 6 }),
    searchJobs(db, { postedWithinDays: 1, sort: "match", limit: 100 }),
    searchJobs(db, { onCampus: true, sort: "new", limit: 3 }),
    searchJobs(db, { types: ["internship", "co_op"], onCampus: false, maxMiles: radius, includeRemote: false, sort: "match", limit: 6 }),
    searchJobs(db, { maxMiles: radius, includeRemote: false, onCampus: false, sort: "distance", limit: 5 }),
    db.from("applications").select("status", { count: "exact" }).eq("user_id", user.id).not("status", "in", "(rejected,withdrawn)"),
    db.from("interviews").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("scheduled_at", now.toISOString()),
    db.from("follow_ups").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("done_at", null).lte("due_at", in7),
    db.from("saved_jobs").select("job_id, jobs!inner(deadline)", { count: "exact", head: true }).eq("user_id", user.id).gte("jobs.deadline", now.toISOString().slice(0, 10)).lte("jobs.deadline", in7.slice(0, 10)),
    db.from("agent_runs").select("finished_at, status, stats").eq("kind", "discovery").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("notifications").select("title, body").eq("user_id", user.id).eq("kind", "digest").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    resumeStatus(db, user.id),
    db.from("follow_ups").select("id, due_at, note, applications!follow_ups_parent_owner_fk(id, company_name, job_title)").eq("user_id", user.id).is("done_at", null).lte("due_at", in7).order("due_at").limit(8),
    db.from("interviews").select("id, scheduled_at, kind, applications!interviews_parent_owner_fk(id, company_name, job_title)").eq("user_id", user.id).gte("scheduled_at", now.toISOString()).lte("scheduled_at", in7).order("scheduled_at").limit(8),
    db.from("applications").select("status, applied_at, source, interviews!interviews_parent_owner_fk(id)").eq("user_id", user.id),
  ]);

  type AppRef = { id: string; company_name: string; job_title: string } | null;
  const today: TodayItem[] = [
    ...(dueFollows.data ?? []).map((f) => {
      const a = f.applications as unknown as AppRef;
      return { id: f.id as string, kind: "follow_up" as const, at: f.due_at as string, title: (f.note as string | null) ?? "Follow up", detail: a ? `${a.job_title} · ${a.company_name}` : "Application", href: a ? `/applications?open=${a.id}` : "/applications" };
    }),
    ...(soonInterviews.data ?? []).map((i) => {
      const a = i.applications as unknown as AppRef;
      return { id: i.id as string, kind: "interview" as const, at: i.scheduled_at as string, title: `Interview${i.kind && i.kind !== "interview" ? ` · ${i.kind}` : ""}`, detail: a ? `${a.job_title} · ${a.company_name}` : "Application", href: a ? `/applications?open=${a.id}` : "/applications" };
    }),
  ].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const analytics = analyze((allApps.data ?? []) as unknown as Parameters<typeof analyze>[0]);

  const newMatches = fresh.jobs.filter((j) => j.is_on_campus || (j.score ?? 0) >= 55).length;
  const first = profile?.full_name?.split(" ")[0];
  const [greet, part] = greeting().split(" ");
  const stats = [
    { label: "New matches", value: newMatches, href: "/discover?posted=1" },
    { label: "Applications", value: apps.count ?? 0, href: "/applications" },
    { label: "Interviews", value: interviews.count ?? 0, href: "/calendar" },
    { label: "Follow-ups", value: follows.count ?? 0, href: "/applications" },
    { label: "Deadlines · 7d", value: deadlines.count ?? 0, href: "/discover?saved=1&sort=deadline" },
  ];

  return (
    <div className="flex flex-col gap-12 md:gap-16">
      <header className="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <Label>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" })}</Label>
          <h1 className="text-[40px] leading-[0.98] md:text-[60px]">
            {greet} <span className="serif-em">{part}</span>{first ? `, ${first}` : ""}.
          </h1>
          <p className="max-w-[48ch] text-[17px] leading-relaxed text-muted">
            {newMatches > 0 ? (
              <>FRIDAY found <span className="text-text">{newMatches} new opportunit{newMatches === 1 ? "y" : "ies"}</span> for you.</>
            ) : fresh.total > 0 ? (
              <>{fresh.total} new listing{fresh.total === 1 ? "" : "s"} today — none strongly matched yet. Adding skills sharpens this.</>
            ) : (
              <>No new listings since the last run. Your best current matches are below.</>
            )}
          </p>
          {digest.data && <p className="text-[13px] text-dim">{digest.data.body}</p>}
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <RunAgentButton />
          <span className="text-[11.5px] text-dim">
            {lastRun.data?.finished_at ? `Last searched ${ago(lastRun.data.finished_at)}` : "FRIDAY has not searched yet"}
          </span>
        </div>
      </header>

      {!isAdminConfigured() && (
        <Notice tone="amber" title="Discovery isn't connected yet">
          Add <code className="font-mono text-[12px]">SUPABASE_SECRET_KEY</code> to the server environment so FRIDAY can write newly discovered jobs. Until then, the feed only shows what is already in the catalog.
        </Notice>
      )}

      <Stagger className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card interactive className="flex h-full flex-col gap-3 p-4">
              <Label>{s.label}</Label>
              <CountUp value={s.value} className="num text-[34px] font-light leading-none tracking-[-0.03em]" />
            </Card>
          </Link>
        ))}
      </Stagger>

      <Reveal><TodayPanel items={today} now={now.getTime()} /></Reveal>

      <Reveal>
        <Card className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <Label>Resume status</Label>
            <ResumeSteps status={resume} className="md:flex-row md:flex-wrap md:gap-x-6" />
          </div>
          <LinkButton href={resume.needsConfirmation || (resume.extracted && !resume.reviewed) ? "/resume/review" : "/resume"} size="sm" variant={resume.needsConfirmation ? "primary" : "secondary"}>
            {resume.needsConfirmation ? "Review now" : resume.uploaded ? "Open resumes" : "Upload resume"}
          </LinkButton>
        </Card>
      </Reveal>

      <Reveal as="section" className="flex flex-col gap-5">
        <SectionHeader eyebrow="Ranked for you" title={SJSU_ONLY ? "Best campus jobs for you" : "Best new opportunities"} action={<LinkButton href={SJSU_ONLY ? "/sjsu" : "/discover"} variant="ghost" size="sm">See all <ArrowUpRight size={14} /></LinkButton>} />
        <JobGrid jobs={best.jobs} empty={{ title: "No recent listings yet", body: "Run FRIDAY to search every source, or widen your filters in Discover.", action: <RunAgentButton /> }} />
      </Reveal>

      {/* minmax(0, …) tracks: a long job title truncates instead of widening the column past a phone screen */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-8">
        <Reveal as="section" className="flex flex-col gap-5">
          <SectionHeader eyebrow={`Within ${radius} mi of ${profile?.origin_label ?? "SJSU"}`} title="Around you" action={<LinkButton href={`/discover?miles=${radius}&sort=distance&includeRemote=0`} variant="ghost" size="sm">Map it out <ArrowUpRight size={14} /></LinkButton>} />
          <Card className="divide-y-[0.5px] divide-hairline-strong">
            {nearby.jobs.length ? (
              nearby.jobs.map((j) => (
                <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[rgb(var(--ink)/.03)]">
                  <span className="num w-12 shrink-0 font-mono text-[12px] text-dim">{miles(j.distance_miles)}</span>
                  <CompanyMark name={j.company_name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{j.title}</span>
                    <span className="block truncate text-[12px] text-muted">{j.company_name} · {place(j)} · {TYPE_LABEL[j.employment_type]}{j.pay_text ? ` · ${j.pay_text}` : ""}</span>
                  </span>
                  <MatchBadge score={j.score} className="hidden sm:inline-flex" />
                </Link>
              ))
            ) : (
              <p className="p-5 text-[14px] text-muted">Nothing within {radius} miles right now. Widen your radius in Settings.</p>
            )}
          </Card>
        </Reveal>

        <Reveal as="section" delay={0.08} className="flex flex-col gap-5">
          <SectionHeader eyebrow="Official SJSU pages" title="SJSU on-campus" action={<LinkButton href="/sjsu" variant="ghost" size="sm">All <ArrowUpRight size={14} /></LinkButton>} />
          <div className="flex flex-col gap-2">
            {campus.jobs.length ? (
              campus.jobs.map((j) => (
                <Link key={j.id} href={`/jobs/${j.id}`}>
                  <Card interactive className="flex items-center justify-between gap-3 p-4">
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px]">{j.title}</span>
                      <span className="block truncate text-[12px] text-muted">{j.department ?? j.company_name.replace(/^SJSU /, "")}{j.hours_text ? ` · ${j.hours_text}` : ""}{j.pay_text ? ` · ${j.pay_text}` : ""}</span>
                    </span>
                    <span className={cx("label shrink-0")}>{ago(j.discovered_at)}</span>
                  </Card>
                </Link>
              ))
            ) : (
              <Card className="p-5 text-[14px] text-muted">No on-campus postings found on official pages yet. Most are posted on Handshake — import one from the SJSU page.</Card>
            )}
          </div>
        </Reveal>
      </div>

      <Reveal as="section" className="flex flex-col gap-5">
        <SectionHeader eyebrow="Silicon Valley" title="Internships near campus" action={<LinkButton href="/internships" variant="ghost" size="sm">All internships <ArrowUpRight size={14} /></LinkButton>} />
        <JobGrid jobs={interns.jobs} empty={{ title: `No internships within ${radius} miles yet`, body: "Try a wider radius, or include remote roles on the Internships page." }} />
      </Reveal>

      <Reveal as="section" className="flex flex-col gap-5">
        <SectionHeader eyebrow="Your search" title="Analytics" action={<LinkButton href="/applications" variant="ghost" size="sm">Applications <ArrowUpRight size={14} /></LinkButton>} />
        <AnalyticsPanel a={analytics} />
      </Reveal>
    </div>
  );
}
