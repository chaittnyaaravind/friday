/**
 * The FRIDAY agent. One run: sync catalog → crawl every discoverable company →
 * normalize/filter/dedupe/verify → close stale listings → re-match every user →
 * raise alerts (new matches, new on-campus jobs, deadlines, follow-ups, interviews).
 * Runs daily from Vercel Cron and on demand (POST /api/agent/search).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatch, type MatchJob, type MatchProfile } from "@/lib/domain/match";
import { SKILLS } from "@/lib/domain/skills";
import { archiveExpired, closeStale, normalizePosting, upsertJobs, type NormalizedJob } from "./ingest";
import { REGISTRY } from "./registry";
import { ADAPTERS, usajobsConfigured, type CompanyFeed, type SourceKind } from "./sources";

type CompanyRow = { id: string; slug: string; name: string; ats: string | null; ats_config: Record<string, string>; discoverable: boolean };

export async function syncCatalog(db: SupabaseClient) {
  const { error: sErr } = await db.from("skills").upsert(
    SKILLS.map((k) => ({ slug: k.slug, name: k.name, category: k.category, aliases: k.aliases })),
    { onConflict: "slug" },
  );
  if (sErr) throw sErr;
  const { error: cErr } = await db.from("companies").upsert(
    REGISTRY.map((c) => ({
      slug: c.slug,
      name: c.name,
      domain: c.domain,
      hq_city: c.hqCity,
      industry: c.industry,
      careers_url: c.careersUrl,
      ats: c.ats === "watch" ? "careers_page" : c.ats,
      ats_config: c.config ?? {},
      is_sjsu: Boolean(c.isSjsu),
      discoverable: c.ats !== "watch",
    })),
    { onConflict: "slug" },
  );
  if (cErr) throw cErr;
}

export async function skillIdMap(db: SupabaseClient) {
  const { data, error } = await db.from("skills").select("id, slug");
  if (error) throw error;
  return new Map((data ?? []).map((s) => [s.slug as string, s.id as number]));
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export type DiscoveryReport = {
  runId: string;
  companies: number;
  failures: { company: string; error: string }[];
  seen: number;
  kept: number;
  created: number;
  closed: number;
  /** Active listings no source confirmed for ARCHIVE_DAYS, marked expired this run. */
  archived: number;
  skipped: Record<string, number>;
  newJobIds: string[];
};

export async function runDiscovery(
  db: SupabaseClient,
  opts: { trigger: "cron" | "manual" | "user"; userId?: string; companySlugs?: string[]; onlySjsu?: boolean } = { trigger: "manual" },
): Promise<DiscoveryReport> {
  const startedAt = new Date().toISOString();
  const { data: run, error: runErr } = await db
    .from("agent_runs")
    .insert({ kind: "discovery", trigger: opts.trigger, user_id: opts.userId ?? null })
    .select("id")
    .single();
  if (runErr) throw runErr;

  const report: DiscoveryReport = { runId: run.id, companies: 0, failures: [], seen: 0, kept: 0, created: 0, closed: 0, archived: 0, skipped: {}, newJobIds: [] };
  try {
    await syncCatalog(db);
    const skills = await skillIdMap(db);
    let q = db.from("companies").select("id, slug, name, ats, ats_config, discoverable").eq("discoverable", true);
    if (opts.companySlugs?.length) q = q.in("slug", opts.companySlugs);
    if (opts.onlySjsu) q = q.eq("is_sjsu", true);
    const { data: companies, error } = await q;
    if (error) throw error;
    report.companies = companies?.length ?? 0;

    await pool((companies ?? []) as CompanyRow[], 4, async (c) => {
      const adapter = ADAPTERS[c.ats as SourceKind];
      if (!adapter) return;
      // A credentialed source without credentials is reported as skipped, not as a failure, and never faked.
      if (c.ats === "usajobs" && !usajobsConfigured()) {
        report.skipped["usajobs-not-configured"] = 1;
        report.companies -= 1;
        return;
      }
      try {
        const feed: CompanyFeed = { slug: c.slug, name: c.name, ats: c.ats as SourceKind, config: c.ats_config };
        const postings = await adapter(feed);
        report.seen += postings.length;
        const kept: NormalizedJob[] = [];
        for (const p of postings) {
          const n = normalizePosting(p, c);
          if ("skip" in n) report.skipped[n.skip] = (report.skipped[n.skip] ?? 0) + 1;
          else kept.push(n);
        }
        report.kept += kept.length;
        const { created } = await upsertJobs(db, kept, skills);
        report.created += created.length;
        report.newJobIds.push(...created);
        report.closed += await closeStale(db, c.id, c.ats!, startedAt);
        await db.from("companies").update({ last_crawled_at: new Date().toISOString() }).eq("id", c.id);
      } catch (e) {
        report.failures.push({ company: c.slug, error: e instanceof Error ? e.message : String(e) });
      }
    });

    report.archived = await archiveExpired(db);
    await rematchAll(db, { newJobIds: new Set(report.newJobIds) });
    await raiseReminders(db);

    await db
      .from("agent_runs")
      .update({
        status: report.failures.length ? "partial" : "succeeded",
        finished_at: new Date().toISOString(),
        stats: { ...report, newJobIds: report.newJobIds.length },
      })
      .eq("id", run.id);
    return report;
  } catch (e) {
    await db
      .from("agent_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) })
      .eq("id", run.id);
    throw e;
  }
}

// ───────────────────────── MATCH ─────────────────────────

type JobForMatch = {
  id: string; company_id: string; title: string; employment_type: MatchJob["employmentType"]; category: string | null; is_on_campus: boolean;
  lat: number | null; lng: number | null; city: string | null; is_remote: boolean; is_hybrid: boolean; description: string | null;
  companies: { name: string } | null;
  job_requirements: { label: string; kind: "required" | "preferred"; skills: { slug: string } | null }[];
};

export async function loadActiveJobsForMatching(db: SupabaseClient, onlyIds?: string[]): Promise<JobForMatch[]> {
  const all: JobForMatch[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let q = db
      .from("jobs")
      .select("id, company_id, title, employment_type, category, is_on_campus, lat, lng, city, is_remote, is_hybrid, description, companies(name), job_requirements(label, kind, skills(slug))")
      .eq("status", "active")
      .range(from, from + pageSize - 1);
    if (onlyIds) q = q.in("id", onlyIds);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...((data ?? []) as unknown as JobForMatch[]));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export function toMatchJob(j: JobForMatch): MatchJob {
  return {
    title: j.title,
    employmentType: j.employment_type,
    category: j.category,
    isOnCampus: j.is_on_campus,
    lat: j.lat,
    lng: j.lng,
    city: j.city,
    isRemote: j.is_remote,
    isHybrid: j.is_hybrid,
    description: j.description,
    requirements: j.job_requirements.map((r) => ({ slug: r.skills?.slug ?? null, label: r.label, kind: r.kind })),
  };
}

export async function loadMatchProfile(db: SupabaseClient, userId: string): Promise<MatchProfile | null> {
  const { data: p } = await db
    .from("profiles")
    .select("major, origin_lat, origin_lng, radius_miles, workplace, desired_titles, profile_skills(skills(slug))")
    .eq("id", userId)
    .single();
  if (!p) return null;
  return {
    major: p.major,
    skills: ((p.profile_skills ?? []) as unknown as { skills: { slug: string } | null }[]).map((s) => s.skills?.slug).filter(Boolean) as string[],
    origin: { lat: p.origin_lat, lng: p.origin_lng },
    radiusMiles: p.radius_miles,
    workplace: p.workplace,
    desiredTitles: p.desired_titles ?? [],
  };
}

/** Recompute matches for one user (after profile/resume changes) or every onboarded user. */
export async function rematchAll(db: SupabaseClient, opts: { userId?: string; newJobIds?: Set<string> } = {}) {
  const base = db.from("profiles").select("id");
  const { data: users, error } = await (opts.userId ? base.eq("id", opts.userId) : base.not("onboarded_at", "is", null));
  if (error) throw error;
  if (!users?.length) return;

  const jobs = await loadActiveJobsForMatching(db);
  for (const u of users) {
    const profile = await loadMatchProfile(db, u.id);
    if (!profile) continue;
    const rows = jobs.map((j) => {
      const m = computeMatch(profile, toMatchJob(j));
      return { user_id: u.id, job_id: j.id, score: m.score, strong: m.strong, missing: m.missing, difficulty: m.difficulty, distance_miles: m.distanceMiles, computed_at: new Date().toISOString() };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error: mErr } = await db.from("job_matches").upsert(rows.slice(i, i + 500), { onConflict: "user_id,job_id" });
      if (mErr) throw mErr;
    }

    // Alerts for brand-new opportunities only.
    if (opts.newJobIds?.size) {
      const fresh = jobs.filter((j) => opts.newJobIds!.has(j.id));
      const scored = new Map(rows.map((r) => [r.job_id, r]));
      const { data: watch } = await db.from("company_watchlists").select("company_id").eq("user_id", u.id);
      const followed = new Set((watch ?? []).map((w) => w.company_id as string));
      const notes = fresh
        .filter((j) => j.is_on_campus || followed.has(j.company_id) || (scored.get(j.id)?.score ?? 0) >= 70)
        .slice(0, 25)
        .map((j) => ({
          user_id: u.id,
          kind: j.is_on_campus ? "new_on_campus" : followed.has(j.company_id) ? "watchlist" : "new_match",
          title: j.is_on_campus
            ? `New SJSU on-campus job: ${j.title}`
            : followed.has(j.company_id)
              ? `${j.companies?.name ?? "A company you follow"} posted: ${j.title}`
              : `New match: ${j.title} at ${j.companies?.name ?? ""}`.trim(),
          body: j.is_on_campus ? "Posted on an official SJSU hiring page." : `${scored.get(j.id)?.score}% match${j.city ? ` · ${j.city}` : ""}`,
          job_id: j.id,
          dedupe_key: `job:${j.id}`,
        }));
      if (notes.length) await db.from("notifications").upsert(notes, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
      await writeDigest(db, u.id, fresh, scored);
    }
  }
}

async function writeDigest(db: SupabaseClient, userId: string, fresh: JobForMatch[], scored: Map<string, { score: number }>) {
  if (!fresh.length) return;
  const day = new Date().toISOString().slice(0, 10);
  const sjsu = fresh.filter((j) => j.is_on_campus).length;
  const ai = fresh.filter((j) => !j.is_on_campus && j.category === "AI/ML").length;
  const research = fresh.filter((j) => !j.is_on_campus && j.category === "Research").length;
  const swe = fresh.length - sjsu - ai - research;
  const strong = fresh.filter((j) => (scored.get(j.id)?.score ?? 0) >= 75).length;
  const parts = [sjsu && `${sjsu} SJSU job${sjsu > 1 ? "s" : ""}`, swe && `${swe} software internship${swe > 1 ? "s" : ""}`, ai && `${ai} AI internship${ai > 1 ? "s" : ""}`, research && `${research} research position${research > 1 ? "s" : ""}`].filter(Boolean);
  await db.from("notifications").upsert(
    {
      user_id: userId,
      kind: "digest",
      title: `FRIDAY found ${fresh.length} new opportunit${fresh.length === 1 ? "y" : "ies"} today.`,
      body: `${parts.join(" · ")}${strong ? ` — ${strong} strong match${strong > 1 ? "es" : ""}` : ""}`,
      dedupe_key: `digest:${day}`,
    },
    { onConflict: "user_id,dedupe_key" },
  );
}

// ───────────────────────── REMIND ─────────────────────────

/** Deadline, follow-up and interview reminders. Idempotent per day via dedupe keys. */
export async function raiseReminders(db: SupabaseClient) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const in3 = new Date(now.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  const tomorrowEnd = new Date(now.getTime() + 2 * 86_400_000).toISOString();

  const { data: saved } = await db
    .from("saved_jobs")
    .select("user_id, job_id, jobs!inner(title, deadline, status, companies(name))")
    .gte("jobs.deadline", day)
    .lte("jobs.deadline", in3)
    .eq("jobs.status", "active");
  const deadlineNotes = (saved ?? []).map((s) => {
    const j = s.jobs as unknown as { title: string; deadline: string; companies: { name: string } | null };
    return { user_id: s.user_id, kind: "deadline", title: `Deadline ${j.deadline}: ${j.title}`, body: j.companies?.name ?? null, job_id: s.job_id, dedupe_key: `deadline:${s.job_id}` };
  });

  const { data: follows } = await db
    .from("follow_ups")
    .select("id, user_id, application_id, due_at, note, applications!follow_ups_parent_owner_fk(company_name, job_title)")
    .is("done_at", null)
    .lte("due_at", tomorrowEnd);
  const followNotes = (follows ?? []).map((f) => {
    const a = f.applications as unknown as { company_name: string; job_title: string } | null;
    return { user_id: f.user_id, kind: "follow_up", title: `Follow up: ${a?.company_name ?? "application"}`, body: f.note ?? a?.job_title ?? null, application_id: f.application_id, dedupe_key: `follow:${f.id}` };
  });

  const { data: interviews } = await db
    .from("interviews")
    .select("id, user_id, application_id, scheduled_at, kind, applications!interviews_parent_owner_fk(company_name, job_title)")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", tomorrowEnd);
  const interviewNotes = (interviews ?? []).map((i) => {
    const a = i.applications as unknown as { company_name: string; job_title: string } | null;
    return { user_id: i.user_id, kind: "interview", title: `${i.kind === "interview" ? "Interview" : i.kind} soon: ${a?.company_name ?? ""}`, body: new Date(i.scheduled_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }), application_id: i.application_id, dedupe_key: `interview:${i.id}` };
  });

  const all = [...deadlineNotes, ...followNotes, ...interviewNotes];
  if (all.length) await db.from("notifications").upsert(all, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
}
