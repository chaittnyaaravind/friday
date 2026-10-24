/**
 * DISCOVER → FILTER → DEDUPLICATE → VERIFY. Turns raw postings into catalog rows.
 * One opportunity per canonical key; every place it was seen is a job_sources row.
 * The official employer/ATS URL always wins over an aggregator or user import.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveCutoff } from "@/lib/domain/freshness";
import { resolveLocation } from "@/lib/domain/geo";
import { canonicalKey, classifyCategory, classifyRole, parseDeadline, parsePay } from "@/lib/domain/normalize";
import { isAuthRestricted } from "@/lib/domain/match";
import { extractRequirements } from "@/lib/domain/requirements";
import { skillBySlug } from "@/lib/domain/skills";
import { contentHash, descriptionHash, diffContent, writeJobEvents, type JobEventRow } from "./change";
import { campusEmployerOf, classifyCampusRoles } from "@/lib/domain/campus";
import { hourlyFromPay } from "@/lib/domain/campus-fit";
import { exclusionColumn, staffReason } from "@/lib/domain/exclusions";
import { parseHours } from "@/lib/domain/hours";
import { assessPhysical } from "@/lib/domain/physical";
import { closeDecision, type CloseBlock } from "./close-guard";
import { privateCanonical, privateCompanySlug, privateExternalId } from "./import-scope";
import { AGGREGATOR_SOURCES } from "./providers";
import type { RawPosting } from "./sources";

export type NormalizedJob = {
  row: Record<string, unknown>;
  canonical: string;
  posting: RawPosting;
  requirements: ReturnType<typeof extractRequirements>;
};

/** FILTER + normalize a single posting. Returns a skip reason if it isn't for FRIDAY's users. */
export function normalizePosting(p: RawPosting, company: { id: string; slug: string }): NormalizedJob | { skip: string } {
  const role = classifyRole(p.title, { onCampus: p.onCampus, commitment: p.commitment ?? undefined });
  if (!p.onCampus && !role.isStudentRole) return { skip: "not-student-role" };
  if (role.isSenior && !p.onCampus) return { skip: "senior" };
  if (!p.onCampus && !role.isTechnical) return { skip: "not-technical" };

  const loc = resolveLocation(p.locationText + (p.isRemoteHint ? " remote" : ""));
  if (!p.onCampus && !loc.inUS) return { skip: "outside-us" };
  // Focus: SJSU → San Jose → Silicon Valley, plus remote-US. On-site roles elsewhere are out of scope.
  if (!p.onCampus && !loc.inBayArea && !loc.isRemote) return { skip: "outside-bay-area" };

  const category = p.onCampus ? classifyCategory(p.title, p.department ?? "") ?? "Campus" : classifyCategory(p.title, p.department ?? "");
  // A source's own pay field wins. For campus jobs the description is read as well, but only a figure with a STATED unit
  // ("$18.50 per hour") is taken from prose — a bare "$500" is never turned into pay. Only an hourly unit becomes pay_hourly_*.
  const fromText = p.onCampus ? parsePay(p.description) : null;
  const pay = parsePay(p.payText) ?? (fromText?.unit ? fromText : null);
  const hourly = hourlyFromPay(pay);
  const text = p.description ?? "";
  const hours = parseHours(text);
  const physical = assessPhysical(text);
  const workStudy = /work[- ]study/i.test(`${p.title} ${text}`)
    ? /(?:must|required|only).{0,30}work[- ]study|work[- ]study (?:only|required)/i.test(text) ? "required" : "eligible"
    : p.onCampus ? "unknown" : "not_required";
  const canonical = canonicalKey(company.slug, p.title, p.onCampus ? "sjsu" : loc.city, loc.isRemote);

  const row: Record<string, unknown> = {
    company_id: company.id,
    canonical_key: canonical,
    title: p.title,
    department: p.department,
    description: text.slice(0, 60_000),
    employment_type: role.employmentType,
    category,
    is_on_campus: p.onCampus,
    location_text: p.locationText || null,
    city: p.onCampus ? "San Jose" : loc.city,
    lat: p.onCampus ? 37.3352 : loc.lat,
    lng: p.onCampus ? -121.8811 : loc.lng,
    is_remote: loc.isRemote,
    is_hybrid: loc.isHybrid,
    pay_text: pay?.text ?? null,
    pay_min: pay?.min ?? null,
    pay_max: pay?.max ?? null,
    pay_hourly_min: hourly.min,
    pay_hourly_max: hourly.max,
    physical_demand: physical.level,
    physical_flags: physical.flags,
    hours_text: hours?.text ?? null,
    hours_min: hours?.min ?? null,
    hours_max: hours?.max ?? null,
    // SJSU depth: every campus role the title names, and the campus employer the source belongs to.
    campus_roles: p.onCampus ? classifyCampusRoles(p.title) : [],
    campus_employer: p.onCampus ? campusEmployerOf(company.slug) : null,
    work_study: workStudy,
    deadline: p.deadline ?? parseDeadline(text),
    posted_at: p.postedAt,
    last_verified_at: new Date().toISOString(),
    status: "active",
    closed_at: null, // seen again, so it is not closed (clears a previous closure when a job reopens)
    apply_url: p.applyUrl,
    apply_url_is_official: !AGGREGATOR_SOURCES.has(p.source), // an aggregator's link is not the employer's own
    auth_restricted: isAuthRestricted(text),
    // Exclusion rules (dining and food service) are decided here, in the backend, and recorded with the reason. The row is
    // kept so a listing's open/closed state stays accurate, but search, matching, alerts, tailoring and packets skip it.
    excluded_reason: exclusionColumn({ title: p.title, description: text, department: p.department, category, employer: p.employer ?? p.sourceName })
      ?? (p.onCampus ? staffReason(p.title, pay?.unit) : null),
  };
  // Change detection: what a student would notice changing, hashed (see change.ts).
  row.content_hash = contentHash(row);
  row.description_hash = descriptionHash(row);

  return {
    canonical,
    posting: p,
    requirements: p.onCampus ? extractRequirements(`${p.title}\n${p.department ?? ""}`) : extractRequirements(text),
    row,
  };
}

/**
 * Upsert a company's normalized postings. Returns ids of jobs created in this call
 * (new opportunities → alerts) and all job ids touched.
 */
export type UpsertOptions = {
  /** True on an employer's FIRST crawl: everything found is already open, so it is marked `is_baseline` (not "just opened"). */
  baseline?: boolean;
  runId?: string | null;
};
export type UpsertResult = { created: string[]; touched: string[]; updated: string[]; reopened: string[] };

export async function upsertJobs(
  db: SupabaseClient,
  jobs: NormalizedJob[],
  skillIds: Map<string, number>,
  opts: UpsertOptions = {},
): Promise<UpsertResult> {
  if (!jobs.length) return { created: [], touched: [], updated: [], reopened: [] };

  // In-batch dedupe: the first posting for a canonical key becomes the job; later ones become extra sources.
  const byKey = new Map<string, NormalizedJob>();
  const extraSources: NormalizedJob[] = [];
  for (const j of jobs) {
    if (byKey.has(j.canonical)) extraSources.push(j);
    else byKey.set(j.canonical, j);
  }
  const unique = [...byKey.values()];
  const keys = unique.map((j) => j.canonical);

  const { data: existing, error: exErr } = await db
    .from("jobs")
    .select("id, canonical_key, status, content_hash, description_hash, title, department, employment_type, location_text, pay_text, deadline, apply_url")
    .in("canonical_key", keys);
  if (exErr) throw exErr;
  const previous = new Map((existing ?? []).map((e) => [e.canonical_key as string, e]));
  const existingKeys = new Set(previous.keys());

  const { data: upserted, error } = await db
    .from("jobs")
    .upsert(unique.map((j) => j.row), { onConflict: "canonical_key" })
    .select("id, canonical_key");
  if (error) throw error;
  const idByKey = new Map((upserted ?? []).map((r) => [r.canonical_key as string, r.id as string]));

  const now = new Date().toISOString();
  const sources = [...unique, ...extraSources].map((j) => ({
    job_id: idByKey.get(j.canonical)!,
    source: j.posting.source,
    source_name: j.posting.sourceName,
    external_id: j.posting.externalId,
    url: j.posting.sourceUrl,
    is_official: !AGGREGATOR_SOURCES.has(j.posting.source),
    last_seen_at: now,
    source_fields: j.posting.sourceFields ?? {},
  }));
  const { error: srcErr } = await db.from("job_sources").upsert(sources, { onConflict: "source,external_id" });
  if (srcErr) throw srcErr;

  // Requirements only for new jobs (existing ones keep any AI-refined requirements).
  const created = unique.filter((j) => !existingKeys.has(j.canonical));
  const reqRows = created.flatMap((j) =>
    j.requirements.map((r) => ({
      job_id: idByKey.get(j.canonical)!,
      skill_id: skillIds.get(r.slug) ?? null,
      label: skillBySlug(r.slug)?.name ?? r.slug,
      kind: r.kind,
    })),
  );
  if (reqRows.length) {
    const { error: reqErr } = await db.from("job_requirements").upsert(reqRows, { onConflict: "job_id,label", ignoreDuplicates: true });
    if (reqErr) throw reqErr;
  }

  // ── Change events: NEW, UPDATED and REOPENED, so a run can say what actually changed ──
  const createdIds = created.map((j) => idByKey.get(j.canonical)!);
  const events: JobEventRow[] = [];
  const updated: string[] = [];
  const reopened: string[] = [];
  for (const j of unique) {
    const id = idByKey.get(j.canonical)!;
    const prev = previous.get(j.canonical);
    const source = j.posting.source;
    if (!prev) {
      events.push({ job_id: id, kind: "new", source, run_id: opts.runId ?? null, changes: opts.baseline ? { baseline: true } : {} });
      continue;
    }
    if (prev.status !== "active") {
      reopened.push(id);
      events.push({ job_id: id, kind: "reopened", source, run_id: opts.runId ?? null, changes: { from_status: prev.status } });
    }
    // A job stored before hashing existed has no hash to compare: it is hashed silently, never reported as "updated".
    if (prev.content_hash && prev.content_hash !== j.row.content_hash) {
      updated.push(id);
      events.push({ job_id: id, kind: "updated", source, run_id: opts.runId ?? null, changes: diffContent(prev, j.row) });
    }
  }
  if (opts.baseline && createdIds.length) {
    const { error: baseErr } = await db.from("jobs").update({ is_baseline: true }).in("id", createdIds);
    if (baseErr) throw baseErr;
  }
  await writeJobEvents(db, events);

  return { created: createdIds, touched: [...idByKey.values()], updated, reopened };
}

export type CloseResult = {
  closed: number;
  /** Set when the close guard refused to close anything this run (see close-guard.ts). The listings stay active. */
  blocked: CloseBlock | null;
  activeBefore: number;
  /** Listings this run did not see: the would-be closures. */
  candidates: number;
};

/**
 * VERIFY: postings a feed no longer returns are closed, never silently kept "active" — unless the feed itself looks
 * broken (returned nothing, or would lose most of its listings at once), in which case nothing is closed and the
 * refusal is reported. Pass `returned` (postings the adapter returned) so an empty feed can be recognised.
 */
export async function closeStale(
  db: SupabaseClient,
  companyId: string,
  source: string,
  runStartedAt: string,
  opts: { returned?: number; runId?: string | null } = {},
): Promise<CloseResult> {
  const { data: rows, error } = await db
    .from("job_sources")
    .select("job_id, last_seen_at, jobs!inner(company_id, status)")
    .eq("source", source)
    .eq("jobs.company_id", companyId)
    .eq("jobs.status", "active");
  if (error) throw error;

  const runStart = Date.parse(runStartedAt);
  const seenThisRun = new Map<string, boolean>(); // job id → seen by this source in this run
  for (const r of rows ?? []) {
    const id = r.job_id as string;
    const seen = Date.parse(r.last_seen_at as string) >= runStart;
    seenThisRun.set(id, (seenThisRun.get(id) ?? false) || seen);
  }
  const activeBefore = seenThisRun.size;
  const stale = [...seenThisRun].filter(([, seen]) => !seen).map(([id]) => id);
  if (!stale.length) return { closed: 0, blocked: null, activeBefore, candidates: 0 };

  const decision = closeDecision({ returned: opts.returned, activeBefore, candidates: stale.length });
  if (!decision.allow) return { closed: 0, blocked: decision.reason, activeBefore, candidates: stale.length };

  const { data: closedRows, error: upErr } = await db
    .from("jobs")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .in("id", stale)
    .lt("last_verified_at", runStartedAt)
    .select("id");
  if (upErr) throw upErr;
  const closedIds = (closedRows ?? []).map((r) => r.id as string);
  await writeJobEvents(db, closedIds.map((job_id) => ({ job_id, kind: "closed" as const, source, run_id: opts.runId ?? null, changes: {} })));
  return { closed: closedIds.length, blocked: null, activeBefore, candidates: stale.length };
}

/**
 * ARCHIVE: an active listing no source has confirmed for ARCHIVE_DAYS is marked expired, so it can never
 * keep looking open on evidence that stopped arriving (manual imports, retired sources, changed filters).
 * Deadlines are shown in the UI but never auto-expire a job: they are parsed from free text.
 */
export async function archiveExpired(db: SupabaseClient, now: number = Date.now(), opts: { runId?: string | null } = {}): Promise<number> {
  const { data, error } = await db
    .from("jobs")
    .update({ status: "expired", closed_at: new Date(now).toISOString() })
    .eq("status", "active")
    .lt("last_verified_at", archiveCutoff(now))
    .select("id");
  if (error) throw error;
  await writeJobEvents(db, (data ?? []).map((r) => ({ job_id: r.id as string, kind: "expired" as const, source: null, run_id: opts.runId ?? null, changes: {} })));
  return data?.length ?? 0;
}

// ───────────────────────── User imports (Handshake / LinkedIn / Indeed / other) ─────────────────────────

export type ImportInput = {
  url: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  pay?: string | null;
  deadline?: string | null;
  source: "handshake" | "linkedin" | "indeed" | "other";
  onCampus?: boolean;
};

const IMPORT_SOURCE = { handshake: "handshake_import", linkedin: "linkedin_import", indeed: "indeed_import", other: "manual" } as const;
const AGGREGATOR = /(?:^|\.)(?:linkedin\.com|indeed\.com|joinhandshake\.com|glassdoor\.com|ziprecruiter\.com|simplify\.jobs|wayup\.com)$/i;

/**
 * A student brings a listing FRIDAY can't crawl (Handshake, LinkedIn, Indeed, a company page).
 *
 * It is PRIVATE to that student (migration 0009): the job, its source and any company it creates carry
 * `imported_by`, and RLS shows them only to their owner. An import never changes a public row, never overwrites
 * an apply link, and is never recorded as an official source. If the same role already exists in the public
 * catalog (e.g. found on the employer's own Greenhouse), the import is attached to it as a private extra source
 * and the public listing is left exactly as it was.
 */
export async function importPosting(db: SupabaseClient, input: ImportInput, skillIds: Map<string, number>, userId: string) {
  const host = new URL(input.url).hostname;
  const baseSlug = input.onCampus ? "sjsu-handshake" : input.company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // Prefer the public company with this slug so the listing groups with the employer's real page;
  // otherwise the company is private to this student.
  let { data: company } = await db.from("companies").select("id, slug").eq("slug", baseSlug).is("imported_by", null).maybeSingle();
  if (!company) {
    const slug = privateCompanySlug(userId, baseSlug);
    const { data: mine } = await db.from("companies").select("id, slug").eq("slug", slug).eq("imported_by", userId).maybeSingle();
    if (mine) company = mine;
    else {
      const { data: created, error } = await db
        .from("companies")
        .insert({
          slug,
          name: input.onCampus ? "SJSU (via Handshake)" : input.company.trim(),
          ats: "careers_page",
          discoverable: false,
          is_sjsu: Boolean(input.onCampus),
          careers_url: AGGREGATOR.test(host) ? null : `https://${host}`,
          imported_by: userId,
        })
        .select("id, slug")
        .single();
      if (error) throw error;
      company = created;
    }
  }

  const role = classifyRole(input.title, { onCampus: input.onCampus });
  const loc = resolveLocation(input.onCampus ? "San Jose, CA" : input.location ?? "");
  const text = input.description ?? "";
  const pay = parsePay(input.pay ?? text);
  const hours = parseHours(text);
  const hourly = hourlyFromPay(pay);
  const physical = assessPhysical(text);
  const category = classifyCategory(input.title) ?? (input.onCampus ? "Campus" : null);
  const canonical = canonicalKey(company.slug, input.title, input.onCampus ? "sjsu" : loc.city, loc.isRemote);
  const source = IMPORT_SOURCE[input.source];

  // 1) The same role in the PUBLIC catalog: attach a private source, change nothing public.
  const { data: publicJob } = await db.from("jobs").select("id").eq("canonical_key", canonical).is("imported_by", null).maybeSingle();
  let jobId = publicJob?.id as string | undefined;
  let merged = Boolean(publicJob);

  // 2) Otherwise this student's own copy — reused if they imported it before, created if not.
  if (!jobId) {
    const mineKey = privateCanonical(userId, canonical);
    const { data: mine } = await db.from("jobs").select("id").eq("canonical_key", mineKey).eq("imported_by", userId).maybeSingle();
    if (mine) {
      jobId = mine.id as string;
      merged = true;
    } else {
      const { data: created, error } = await db
        .from("jobs")
        .insert({
          company_id: company.id,
          canonical_key: mineKey,
          imported_by: userId,
          title: input.title.trim(),
          description: text.slice(0, 60_000) || null,
          employment_type: role.employmentType,
          category,
          is_on_campus: Boolean(input.onCampus),
          location_text: input.location ?? null,
          city: input.onCampus ? "San Jose" : loc.city,
          lat: input.onCampus ? 37.3352 : loc.lat,
          lng: input.onCampus ? -121.8811 : loc.lng,
          is_remote: loc.isRemote,
          is_hybrid: loc.isHybrid,
          pay_text: pay?.text ?? null,
          pay_min: pay?.min ?? null,
          pay_max: pay?.max ?? null,
          hours_text: hours?.text ?? null,
          hours_min: hours?.min ?? null,
          hours_max: hours?.max ?? null,
          campus_roles: input.onCampus ? classifyCampusRoles(input.title) : [],
          campus_employer: input.onCampus ? campusEmployerOf(company.slug) : null, // a student's import is not attributed to a named employer
          deadline: input.deadline || parseDeadline(text),
          apply_url: input.url,
          apply_url_is_official: false, // the student's own link — never presented as the employer's
          auth_restricted: isAuthRestricted(text),
          // The same backend rules as discovered listings: a dining import is excluded; desk/physical is read from its text.
          pay_hourly_min: hourly.min,
          pay_hourly_max: hourly.max,
          physical_demand: physical.level,
          physical_flags: physical.flags,
          excluded_reason: exclusionColumn({ title: input.title, description: text, department: null, category, employer: input.company })
            ?? (input.onCampus ? staffReason(input.title, pay?.unit) : null),
        })
        .select("id")
        .single();
      if (error) throw error;
      jobId = created.id as string;
      const reqs = extractRequirements(text).map((r) => ({ job_id: jobId!, skill_id: skillIds.get(r.slug) ?? null, label: skillBySlug(r.slug)?.name ?? r.slug, kind: r.kind }));
      if (reqs.length) await db.from("job_requirements").upsert(reqs, { onConflict: "job_id,label", ignoreDuplicates: true });
    }
  }

  const { error: srcErr } = await db.from("job_sources").upsert(
    { job_id: jobId, source, source_name: sourceName(input.source, host), external_id: privateExternalId(userId, input.url), url: input.url, is_official: false, imported_by: userId, last_seen_at: new Date().toISOString() },
    { onConflict: "source,external_id" },
  );
  if (srcErr) throw srcErr;
  return { jobId, merged };
}

function sourceName(source: ImportInput["source"], host: string) {
  return { handshake: "SJSU Handshake", linkedin: "LinkedIn", indeed: "Indeed", other: host.replace(/^www\./, "") }[source];
}
