/**
 * The FRIDAY agent. One run: sync catalog → crawl every discoverable company →
 * normalize/filter/dedupe/verify → close stale listings → re-match every user →
 * raise alerts (new matches, new on-campus jobs, deadlines, follow-ups, interviews).
 * Runs daily from Vercel Cron and on demand (POST /api/agent/search).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCampusFit, normalizeCampusPrefs, type CampusPrefs, type FitJob } from "@/lib/domain/campus-fit";
import { checkEligibility } from "@/lib/domain/eligibility";
import { isPhysicalLevel, type PhysicalFlag } from "@/lib/domain/physical";
import { computeMatch, type MatchJob, type MatchProfile } from "@/lib/domain/match";
import { normalizePrefs } from "@/lib/domain/notify-prefs";
import { SKILLS } from "@/lib/domain/skills";
import { adzunaProvider } from "./adzuna";
import { syncProvider } from "./aggregate";
import { capabilityRows } from "./capabilities";
import type { CloseBlock } from "./close-guard";
import { recordSourceRun } from "./health";
import { syncApplicationsWithListings } from "@/lib/apply/listing-sync";
import { archiveExpired, closeStale, normalizePosting, upsertJobs, type NormalizedJob } from "./ingest";
import type { ProviderMetrics } from "./providers";
import { REGISTRY } from "./registry";
import { SJSU_ONLY } from "@/lib/scope";
import { ADAPTERS, usajobsConfigured, type CompanyFeed, type SourceKind } from "./sources";

type CompanyRow = { id: string; slug: string; name: string; ats: string | null; ats_config: Record<string, string>; discoverable: boolean; last_crawled_at: string | null };

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
  // What FRIDAY can honestly claim about each source lives in code (capabilities.ts); the table only mirrors it for the UI.
  // It is metadata, so a failure to mirror it is logged, never allowed to stop discovery.
  const { error: capErr } = await db.from("source_capabilities").upsert(capabilityRows().map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: "source" });
  if (capErr) console.error(JSON.stringify({ event: "source_capabilities_sync_failed", error: capErr.message }));
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
  /** Existing listings whose content changed (title, pay, location, deadline, link or description). */
  updated: number;
  /** Closed or expired listings a source is listing again. */
  reopened: number;
  /** Of `created`, the jobs found on an employer's FIRST crawl: already open, so not "just opened". */
  baseline: number;
  closed: number;
  /** Closures the close guard refused (a feed that returned nothing, or would lose most of its listings). They stay active. */
  closeBlocked: { company: string; source: string; reason: CloseBlock; candidates: number; active: number }[];
  /** Active listings no source confirmed for ARCHIVE_DAYS, marked expired this run. */
  archived: number;
  /** Tracked applications (not yet submitted) moved to "closed" because their listing closed, and back because it reopened. */
  trackerClosed?: number;
  trackerReopened?: number;
  /** Per-provider numbers for aggregator sources (Adzuna): requests, fetched, inserted, deduplicated, errors. */
  providers: Record<string, ProviderMetrics>;
  skipped: Record<string, number>;
  /** Postings kept in the catalog but excluded by rule (e.g. dining), by rule id. Never shown, matched or alerted. */
  excluded: Record<string, number>;
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

  const report: DiscoveryReport = { runId: run.id, companies: 0, failures: [], seen: 0, kept: 0, created: 0, updated: 0, reopened: 0, baseline: 0, closed: 0, closeBlocked: [], archived: 0, providers: {}, skipped: {}, excluded: {}, newJobIds: [] };
  try {
    const { count: sourcesBefore } = await db.from("companies").select("id", { count: "exact", head: true }).eq("discoverable", true);
    await syncCatalog(db);
    const { count: sourcesAfter } = await db.from("companies").select("id", { count: "exact", head: true }).eq("discoverable", true);
    if ((sourcesAfter ?? 0) > (sourcesBefore ?? 0) && (sourcesBefore ?? 0) > 0) await notifySourceUpdate(db, (sourcesAfter ?? 0) - (sourcesBefore ?? 0), sourcesAfter ?? 0);
    const skills = await skillIdMap(db);
    let q = db.from("companies").select("id, slug, name, ats, ats_config, discoverable, last_crawled_at").eq("discoverable", true);
    if (opts.companySlugs?.length) q = q.in("slug", opts.companySlugs);
    if (opts.onlySjsu || SJSU_ONLY) q = q.eq("is_sjsu", true);
    const { data: companies, error } = await q;
    if (error) throw error;
    report.companies = companies?.length ?? 0;

    await pool((companies ?? []) as CompanyRow[], 4, async (c) => {
      // Aggregators return postings for many employers, so they run through the shared provider pipeline.
      // A provider that is unconfigured is skipped; one that fails is recorded — neither stops the other sources.
      if (c.ats === "adzuna") {
        const baseline = c.last_crawled_at == null;
        const { metrics, createdIds } = await syncProvider(db, adzunaProvider, skills, { baseline, runId: run.id });
        report.providers.adzuna = metrics;
        if (!metrics.configured) {
          report.skipped["adzuna-not-configured"] = 1;
          report.companies -= 1;
          return;
        }
        report.seen += metrics.fetched;
        report.kept += metrics.normalized;
        report.created += createdIds.length;
        if (baseline) report.baseline += createdIds.length;
        report.newJobIds.push(...createdIds);
        if (!metrics.ok) report.failures.push({ company: "adzuna", error: metrics.error ?? "Adzuna failed" });
        await recordSourceRun(db, { source: "adzuna", scope: c.slug }, { ok: metrics.ok, returned: metrics.fetched, kept: metrics.normalized, error: metrics.error });
        await db.from("companies").update({ last_crawled_at: new Date().toISOString() }).eq("id", c.id);
        return;
      }
      const adapter = ADAPTERS[c.ats as SourceKind];
      if (!adapter) return;
      // A credentialed source without credentials is reported as skipped, not as a failure, and never faked.
      if (c.ats === "usajobs" && !usajobsConfigured()) {
        report.skipped["usajobs-not-configured"] = 1;
        report.companies -= 1;
        return;
      }
      const health = { source: c.ats as string, scope: c.slug };
      try {
        const feed: CompanyFeed = { slug: c.slug, name: c.name, ats: c.ats as SourceKind, config: c.ats_config };
        const postings = await adapter(feed);
        report.seen += postings.length;
        const kept: NormalizedJob[] = [];
        for (const p of postings) {
          const n = normalizePosting(p, c);
          if ("skip" in n) report.skipped[n.skip] = (report.skipped[n.skip] ?? 0) + 1;
          else {
            kept.push(n);
            const rule = typeof n.row.excluded_reason === "string" ? n.row.excluded_reason.split(":")[0] : null;
            if (rule) report.excluded[rule] = (report.excluded[rule] ?? 0) + 1;
          }
        }
        report.kept += kept.length;
        // First crawl of this employer: everything found is already open, so it is a baseline, not "just opened".
        const baseline = c.last_crawled_at == null;
        const up = await upsertJobs(db, kept, skills, { baseline, runId: run.id });
        report.created += up.created.length;
        report.updated += up.updated.length;
        report.reopened += up.reopened.length;
        if (baseline) report.baseline += up.created.length;
        report.newJobIds.push(...up.created);
        const close = await closeStale(db, c.id, c.ats!, startedAt, { returned: postings.length, runId: run.id });
        report.closed += close.closed;
        if (close.blocked) report.closeBlocked.push({ company: c.slug, source: c.ats!, reason: close.blocked, candidates: close.candidates, active: close.activeBefore });
        await db.from("companies").update({ last_crawled_at: new Date().toISOString() }).eq("id", c.id);
        await recordSourceRun(db, health, { ok: true, returned: postings.length, kept: kept.length, closed: close.closed, closeBlocked: close.blocked });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        report.failures.push({ company: c.slug, error });
        await recordSourceRun(db, health, { ok: false, error });
      }
    });

    report.archived = await archiveExpired(db, Date.now(), { runId: run.id });
    // The tracker follows the listings (pre-submission applications only; see apply/listing-sync.ts). Never fatal to a run.
    try {
      const sync = await syncApplicationsWithListings(db);
      report.trackerClosed = sync.closed;
      report.trackerReopened = sync.reopened;
    } catch (e) {
      report.failures.push({ company: "(tracker sync)", error: e instanceof Error ? e.message : String(e) });
    }
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
  id: string; company_id: string; imported_by: string | null; title: string; employment_type: MatchJob["employmentType"]; category: string | null; is_on_campus: boolean;
  lat: number | null; lng: number | null; city: string | null; is_remote: boolean; is_hybrid: boolean; description: string | null;
  status: string; deadline: string | null; hours_max: number | null; work_study: NonNullable<MatchJob["workStudy"]>;
  campus_roles?: string[] | null; pay_hourly_min?: number | null; pay_hourly_max?: number | null; physical_demand?: string | null;
  physical_flags?: PhysicalFlag[] | null; last_verified_at?: string | null; job_sources?: { is_official: boolean }[] | null;
  companies: { name: string } | null;
  job_requirements: { label: string; kind: "required" | "preferred"; skills: { slug: string } | null }[];
};

export async function loadActiveJobsForMatching(db: SupabaseClient, onlyIds?: string[]): Promise<JobForMatch[]> {
  const all: JobForMatch[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let q = db
      .from("jobs")
      .select("id, company_id, imported_by, title, employment_type, category, is_on_campus, lat, lng, city, is_remote, is_hybrid, description, status, deadline, hours_max, work_study, campus_roles, pay_hourly_min, pay_hourly_max, physical_demand, physical_flags, last_verified_at, companies(name), job_sources(is_official), job_requirements(label, kind, skills(slug))")
      .eq("status", "active")
      // Excluded jobs (exclusions.ts) are never scored, ranked or alerted on.
      .is("excluded_reason", null)
      // A stable order: pages of an unordered query can skip or repeat rows once there are more than pageSize jobs.
      .order("id")
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
    requirements: (j.job_requirements ?? []).map((r) => ({ slug: r.skills?.slug ?? null, label: r.label, kind: r.kind })),
    status: j.status,
    deadline: j.deadline,
    hoursMax: j.hours_max,
    workStudy: j.work_study,
  };
}

/** The campus-fit view of a job (on-campus jobs only). */
export function toFitJob(j: JobForMatch): FitJob | null {
  if (!j.is_on_campus) return null;
  return {
    campusRoles: j.campus_roles ?? [],
    payHourlyMin: j.pay_hourly_min ?? null,
    payHourlyMax: j.pay_hourly_max ?? null,
    hoursMax: j.hours_max,
    physical: isPhysicalLevel(j.physical_demand) ? j.physical_demand : "unknown",
    physicalFlags: Array.isArray(j.physical_flags) ? j.physical_flags : [],
    deadline: j.deadline,
    lastVerifiedAt: j.last_verified_at ?? null,
    official: (j.job_sources ?? []).some((s) => s.is_official),
    status: j.status,
  };
}

export async function loadMatchProfile(db: SupabaseClient, userId: string): Promise<(MatchProfile & { campusPrefs: CampusPrefs }) | null> {
  const { data: p } = await db
    .from("profiles")
    .select("major, origin_lat, origin_lng, radius_miles, workplace, desired_titles, work_authorization, graduation_year, campus_prefs, profile_skills(skills(slug))")
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
    workAuthorization: p.work_authorization ?? null,
    graduationYear: p.graduation_year ?? null,
    campusPrefs: normalizeCampusPrefs(p.campus_prefs),
  };
}

/** What is stored with a match besides its score: the breakdown and the eligibility verdict with each check's reason. */
export function matchColumns(profile: MatchProfile & { campusPrefs?: CampusPrefs }, job: MatchJob, fit: FitJob | null = null) {
  const m = computeMatch(profile, job);
  const e = checkEligibility(profile, job, m.distanceMiles);
  // Campus fit is a separate ranking for on-campus jobs, stored beside (never folded into) the score and the verdict.
  const f = fit && profile.campusPrefs ? computeCampusFit(fit, profile.campusPrefs) : null;
  return {
    campus_fit: f?.score ?? null,
    campus_fit_breakdown: f ? { parts: f.parts, reasons: f.reasons, cautions: f.cautions } : null,
    score: m.score,
    strong: m.strong,
    missing: m.missing,
    difficulty: m.difficulty,
    distance_miles: m.distanceMiles,
    breakdown: m.breakdown,
    eligibility: e.verdict,
    eligibility_checks: e.checks.map(({ id, label, status, detail }) => ({ id, label, status, detail })),
  };
}

/** Recompute matches for one user (after profile/resume changes) or every onboarded user. */
export async function rematchAll(db: SupabaseClient, opts: { userId?: string; newJobIds?: Set<string> } = {}) {
  const base = db.from("profiles").select("id, notification_prefs");
  const { data: users, error } = await (opts.userId ? base.eq("id", opts.userId) : base.not("onboarded_at", "is", null));
  if (error) throw error;
  if (!users?.length) return;

  const jobs = await loadActiveJobsForMatching(db);
  for (const u of users) {
    const profile = await loadMatchProfile(db, u.id);
    if (!profile) continue;
    // A student's imports are private: never score, or reveal the requirements of, someone else's.
    const visible = jobs.filter((j) => !j.imported_by || j.imported_by === u.id);
    const rows = visible.map((j) => ({ user_id: u.id, job_id: j.id, ...matchColumns(profile, toMatchJob(j), toFitJob(j)), computed_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: mErr } = await db.from("job_matches").upsert(rows.slice(i, i + 500), { onConflict: "user_id,job_id" });
      if (mErr) throw mErr;
    }

    // Alerts for brand-new opportunities only — and only if the student wants them, above their own threshold.
    const prefs = normalizePrefs(u.notification_prefs);
    if (opts.newJobIds?.size && prefs.in_app.new_matches) {
      const fresh = visible.filter((j) => opts.newJobIds!.has(j.id));
      const scored = new Map(rows.map((r) => [r.job_id, r]));
      const { data: watch } = await db.from("company_watchlists").select("company_id").eq("user_id", u.id);
      const followed = new Set((watch ?? []).map((w) => w.company_id as string));
      const notes = fresh
        .filter((j) => j.is_on_campus || followed.has(j.company_id) || (scored.get(j.id)?.score ?? 0) >= prefs.min_match_score)
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

/** Opt-in ("Source updates"): tell students who asked when FRIDAY starts checking more employers. */
async function notifySourceUpdate(db: SupabaseClient, added: number, total: number) {
  const { data: people } = await db.from("profiles").select("id, notification_prefs").not("onboarded_at", "is", null);
  const rows = (people ?? [])
    .filter((p) => normalizePrefs(p.notification_prefs).in_app.source_updates)
    .map((p) => ({ user_id: p.id, kind: "source_update", title: `FRIDAY now checks ${added} more employer${added === 1 ? "" : "s"}`, body: `${total} employers are monitored for new internships and jobs.`, dedupe_key: `sources:${total}` }));
  if (rows.length) await db.from("notifications").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
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

  // Each kind of reminder respects the student's own notification preferences.
  const { data: people } = await db.from("profiles").select("id, notification_prefs");
  const prefsOf = new Map((people ?? []).map((p) => [p.id as string, normalizePrefs(p.notification_prefs)]));
  const wants = (userId: string, key: "closing_soon" | "follow_ups" | "interviews") => prefsOf.get(userId)?.in_app[key] ?? true;
  const all = [
    ...deadlineNotes.filter((n) => wants(n.user_id as string, "closing_soon")),
    ...followNotes.filter((n) => wants(n.user_id as string, "follow_ups")),
    ...interviewNotes.filter((n) => wants(n.user_id as string, "interviews")),
  ];
  if (all.length) await db.from("notifications").upsert(all, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
}
