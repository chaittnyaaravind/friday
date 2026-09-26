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
  const pay = parsePay(p.payText);
  const text = p.description ?? "";
  const workStudy = /work[- ]study/i.test(`${p.title} ${text}`)
    ? /(?:must|required|only).{0,30}work[- ]study|work[- ]study (?:only|required)/i.test(text) ? "required" : "eligible"
    : p.onCampus ? "unknown" : "not_required";
  const canonical = canonicalKey(company.slug, p.title, p.onCampus ? "sjsu" : loc.city, loc.isRemote);

  return {
    canonical,
    posting: p,
    requirements: p.onCampus ? extractRequirements(`${p.title}\n${p.department ?? ""}`) : extractRequirements(text),
    row: {
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
      hours_text: hoursFrom(text),
      work_study: workStudy,
      deadline: p.deadline ?? parseDeadline(text),
      posted_at: p.postedAt,
      last_verified_at: new Date().toISOString(),
      status: "active",
      apply_url: p.applyUrl,
      apply_url_is_official: true,
      auth_restricted: isAuthRestricted(text),
    },
  };
}

function hoursFrom(text: string): string | null {
  const m = text.match(/(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})\s*(?:hours|hrs)\s*(?:per|\/|a)\s*week/i) ?? text.match(/(?:up to|maximum of)\s*(\d{1,2})\s*(?:hours|hrs)\s*(?:per|\/|a)\s*week/i);
  if (!m) return null;
  return m[2] ? `${m[1]}–${m[2]} hrs/week` : `Up to ${m[1]} hrs/week`;
}

/**
 * Upsert a company's normalized postings. Returns ids of jobs created in this call
 * (new opportunities → alerts) and all job ids touched.
 */
export async function upsertJobs(
  db: SupabaseClient,
  jobs: NormalizedJob[],
  skillIds: Map<string, number>,
): Promise<{ created: string[]; touched: string[] }> {
  if (!jobs.length) return { created: [], touched: [] };

  // In-batch dedupe: the first posting for a canonical key becomes the job; later ones become extra sources.
  const byKey = new Map<string, NormalizedJob>();
  const extraSources: NormalizedJob[] = [];
  for (const j of jobs) {
    if (byKey.has(j.canonical)) extraSources.push(j);
    else byKey.set(j.canonical, j);
  }
  const unique = [...byKey.values()];
  const keys = unique.map((j) => j.canonical);

  const { data: existing, error: exErr } = await db.from("jobs").select("canonical_key").in("canonical_key", keys);
  if (exErr) throw exErr;
  const existingKeys = new Set((existing ?? []).map((e) => e.canonical_key as string));

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
    is_official: true,
    last_seen_at: now,
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

  return { created: created.map((j) => idByKey.get(j.canonical)!), touched: [...idByKey.values()] };
}

/** VERIFY: postings a feed no longer returns are closed, never silently kept "active". */
export async function closeStale(db: SupabaseClient, companyId: string, source: string, runStartedAt: string) {
  const { data: stale, error } = await db
    .from("job_sources")
    .select("job_id, jobs!inner(company_id, status)")
    .eq("source", source)
    .eq("jobs.company_id", companyId)
    .eq("jobs.status", "active")
    .lt("last_seen_at", runStartedAt);
  if (error) throw error;
  const ids = [...new Set((stale ?? []).map((s) => s.job_id as string))];
  if (!ids.length) return 0;
  const { error: upErr } = await db.from("jobs").update({ status: "closed" }).in("id", ids).lt("last_verified_at", runStartedAt);
  if (upErr) throw upErr;
  return ids.length;
}

/**
 * ARCHIVE: an active listing no source has confirmed for ARCHIVE_DAYS is marked expired, so it can never
 * keep looking open on evidence that stopped arriving (manual imports, retired sources, changed filters).
 * Deadlines are shown in the UI but never auto-expire a job: they are parsed from free text.
 */
export async function archiveExpired(db: SupabaseClient, now: number = Date.now()): Promise<number> {
  const { data, error } = await db.from("jobs").update({ status: "expired" }).eq("status", "active").lt("last_verified_at", archiveCutoff(now)).select("id");
  if (error) throw error;
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
 * A user pastes a listing FRIDAY can't crawl. It joins the same dedupe pipeline:
 * if the role already exists (e.g. found on the company's Greenhouse), the import is
 * attached as an extra source and the official apply URL is kept.
 */
export async function importPosting(db: SupabaseClient, input: ImportInput, skillIds: Map<string, number>) {
  const host = new URL(input.url).hostname;
  const companySlug = input.onCampus ? "sjsu-handshake" : input.company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let { data: company } = await db.from("companies").select("id, slug").eq("slug", companySlug).maybeSingle();
  if (!company) {
    const { data: created, error } = await db
      .from("companies")
      .insert({
        slug: companySlug,
        name: input.onCampus ? "SJSU (via Handshake)" : input.company.trim(),
        ats: "careers_page",
        discoverable: false,
        is_sjsu: Boolean(input.onCampus),
        careers_url: AGGREGATOR.test(host) ? null : `https://${host}`,
      })
      .select("id, slug")
      .single();
    if (error) throw error;
    company = created;
  }

  const role = classifyRole(input.title, { onCampus: input.onCampus });
  const loc = resolveLocation(input.onCampus ? "San Jose, CA" : input.location ?? "");
  const text = input.description ?? "";
  const pay = parsePay(input.pay ?? text);
  const canonical = canonicalKey(company.slug, input.title, input.onCampus ? "sjsu" : loc.city, loc.isRemote);
  const official = !AGGREGATOR.test(host);
  const source = IMPORT_SOURCE[input.source];

  const { data: existing } = await db.from("jobs").select("id, apply_url_is_official").eq("canonical_key", canonical).maybeSingle();
  let jobId = existing?.id as string | undefined;
  if (!jobId) {
    const { data: created, error } = await db
      .from("jobs")
      .insert({
        company_id: company.id,
        canonical_key: canonical,
        title: input.title.trim(),
        description: text.slice(0, 60_000) || null,
        employment_type: role.employmentType,
        category: classifyCategory(input.title) ?? (input.onCampus ? "Campus" : null),
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
        deadline: input.deadline || parseDeadline(text),
        apply_url: input.url,
        apply_url_is_official: official,
        auth_restricted: isAuthRestricted(text),
      })
      .select("id")
      .single();
    if (error) throw error;
    jobId = created.id as string;
    const reqs = extractRequirements(text).map((r) => ({ job_id: jobId!, skill_id: skillIds.get(r.slug) ?? null, label: skillBySlug(r.slug)?.name ?? r.slug, kind: r.kind }));
    if (reqs.length) await db.from("job_requirements").upsert(reqs, { onConflict: "job_id,label", ignoreDuplicates: true });
  } else if (official && !existing?.apply_url_is_official) {
    // An official link beats an aggregator link that was imported earlier.
    await db.from("jobs").update({ apply_url: input.url, apply_url_is_official: true }).eq("id", jobId);
  }

  const { error: srcErr } = await db.from("job_sources").upsert(
    { job_id: jobId, source, source_name: sourceName(input.source, host), external_id: input.url, url: input.url, is_official: official, last_seen_at: new Date().toISOString() },
    { onConflict: "source,external_id" },
  );
  if (srcErr) throw srcErr;
  return { jobId, merged: Boolean(existing) };
}

function sourceName(source: ImportInput["source"], host: string) {
  return { handshake: "SJSU Handshake", linkedin: "LinkedIn", indeed: "Indeed", other: host.replace(/^www\./, "") }[source];
}
