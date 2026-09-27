/**
 * The shared pipeline for aggregator providers (Adzuna, and any later licensed job API):
 *
 *   provider.search → normalize (FRIDAY's own filters) → resolve each posting's employer → merge duplicates
 *   → insert genuinely new jobs → report per-provider metrics
 *
 * Two rules protect the catalog. An aggregator posting that matches a job FRIDAY already has is attached to it as an
 * extra (non-official) source and changes nothing else — an employer's own listing is never overwritten by a
 * secondhand copy. And a provider failing only marks THAT provider failed; the sync carries on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { areasFromProfiles } from "@/lib/domain/search-area";
import { companySlug, findDuplicate, normalizeCompany, type JobKey } from "./dedupe";
import { normalizePosting, upsertJobs, type NormalizedJob } from "./ingest";
import { AGGREGATOR_SOURCES, emptyMetrics, type JobProvider, type ProviderMetrics } from "./providers";

export type EmployerRow = { id: string; slug: string; name: string };
type ExistingJob = { id: string; company_id: string; title: string; city: string | null; is_remote: boolean; apply_url: string; canonical_key: string; status: string };

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Public employers, findable by their registry slug or by a slug derived from their name. */
export async function loadEmployerIndex(db: SupabaseClient): Promise<Map<string, EmployerRow>> {
  const { data, error } = await db.from("companies").select("id, slug, name").is("imported_by", null);
  if (error) throw error;
  const index = new Map<string, EmployerRow>();
  for (const c of (data ?? []) as EmployerRow[]) {
    index.set(c.slug, c);
    index.set(companySlug(c.name), c);
  }
  return index;
}

/** Create the employers an aggregator named that FRIDAY has not seen (public, not crawled, no invented details). */
export async function ensureEmployers(db: SupabaseClient, missing: Map<string, string>): Promise<Map<string, EmployerRow>> {
  const out = new Map<string, EmployerRow>();
  if (!missing.size) return out;
  const rows = [...missing].map(([slug, name]) => ({ slug, name: name.trim().slice(0, 120), ats: "careers_page", discoverable: false, is_sjsu: false }));
  const { error } = await db.from("companies").upsert(rows, { onConflict: "slug", ignoreDuplicates: true });
  if (error) throw error;
  const { data, error: selErr } = await db.from("companies").select("id, slug, name").in("slug", [...missing.keys()]);
  if (selErr) throw selErr;
  for (const c of (data ?? []) as EmployerRow[]) out.set(c.slug, c);
  return out;
}

export type MergeResult = { fresh: NormalizedJob[]; attached: number; refreshed: number };

/**
 * Split normalized aggregator jobs into (a) duplicates of jobs FRIDAY already has and (b) genuinely new ones.
 * Duplicates get a private-safe extra source row; an aggregator-only job is refreshed so it does not go stale.
 */
export async function mergeAggregated(db: SupabaseClient, jobs: NormalizedJob[], now: () => string = () => new Date().toISOString()): Promise<MergeResult> {
  if (!jobs.length) return { fresh: [], attached: 0, refreshed: 0 };
  const companyIds = [...new Set(jobs.map((j) => j.row.company_id as string))];

  const existing: ExistingJob[] = [];
  for (const ids of chunk(companyIds, 100)) {
    const { data, error } = await db.from("jobs").select("id, company_id, title, city, is_remote, apply_url, canonical_key, status").in("company_id", ids).is("imported_by", null);
    if (error) throw error;
    existing.push(...((data ?? []) as ExistingJob[]));
  }
  // A job FRIDAY got from an employer (or any official source) is never modified by an aggregator.
  const official = new Set<string>();
  for (const ids of chunk(existing.map((e) => e.id), 200)) {
    const { data, error } = await db.from("job_sources").select("job_id, is_official").in("job_id", ids).eq("is_official", true);
    if (error) throw error;
    for (const s of data ?? []) official.add(s.job_id as string);
  }

  const key = (title: string, city: string | null, remote: boolean, url: string | null, company: string): JobKey => ({ company, title, city, remote, url });
  const byCompany = new Map<string, (JobKey & { job: ExistingJob })[]>();
  for (const e of existing) {
    const list = byCompany.get(e.company_id) ?? [];
    list.push({ ...key(e.title, e.city, e.is_remote, e.apply_url, e.company_id), job: e });
    byCompany.set(e.company_id, list);
  }

  const fresh: NormalizedJob[] = [];
  const batch: (JobKey & { canonical: string })[] = [];
  let attached = 0;
  let refreshed = 0;
  const sources: Record<string, unknown>[] = [];
  const reactivate: string[] = [];
  const stamp = now();

  for (const j of jobs) {
    const companyId = j.row.company_id as string;
    const cand = key(j.row.title as string, (j.row.city as string | null) ?? null, Boolean(j.row.is_remote), j.row.apply_url as string, companyId);
    const known = byCompany.get(companyId) ?? [];
    const hit = known.find((k) => k.job.canonical_key === j.canonical) ?? findDuplicate(cand, known);

    if (hit) {
      const job = hit.job;
      sources.push({ job_id: job.id, source: j.posting.source, source_name: j.posting.sourceName, external_id: j.posting.externalId, url: j.posting.sourceUrl, is_official: false, last_seen_at: stamp });
      if (official.has(job.id)) attached++;
      else {
        refreshed++; // aggregator-only job: seen again, so it is still verified
        if (job.status !== "active") reactivate.push(job.id);
      }
      continue;
    }

    // Two aggregator results that are the same job merge with each other too (they become extra sources of the first).
    const twin = findDuplicate(cand, batch);
    if (twin) {
      j.canonical = twin.canonical;
      j.row.canonical_key = twin.canonical;
    } else batch.push({ ...cand, canonical: j.canonical });
    fresh.push(j);
  }

  for (const rows of chunk(sources, 200)) {
    const { error } = await db.from("job_sources").upsert(rows, { onConflict: "source,external_id" });
    if (error) throw error;
  }
  const refreshIds = [...new Set(sources.map((s) => s.job_id as string).filter((id) => !official.has(id)))];
  for (const ids of chunk(refreshIds, 200)) {
    const { error } = await db.from("jobs").update({ last_verified_at: stamp }).in("id", ids);
    if (error) throw error;
  }
  for (const ids of chunk(reactivate, 200)) {
    const { error } = await db.from("jobs").update({ status: "active" }).in("id", ids);
    if (error) throw error;
  }
  return { fresh, attached, refreshed };
}

/** The areas to search: every distinct area students actually use (capped), read from their own profiles. */
export async function loadSearchAreas(db: SupabaseClient) {
  const { data, error } = await db.from("profiles").select("origin_label, origin_lat, origin_lng, radius_miles, workplace").not("onboarded_at", "is", null);
  if (error) throw error;
  return areasFromProfiles(data ?? []);
}

/** Run one provider end to end. Never throws: a failure is reported in the metrics and the sync continues. */
export async function syncProvider(db: SupabaseClient, provider: JobProvider, skills: Map<string, number>): Promise<{ metrics: ProviderMetrics; createdIds: string[] }> {
  const metrics = emptyMetrics(provider.id, provider.configured());
  if (!metrics.configured) return { metrics, createdIds: [] };
  metrics.attempted = true;
  const started = Date.now();
  let createdIds: string[] = [];
  try {
    const res = await provider.search(await loadSearchAreas(db));
    Object.assign(metrics, { requests: res.requests, succeeded: res.succeeded, failed: res.failed, retries: res.retries, fetched: res.postings.length, rejected: res.rejected });

    const index = await loadEmployerIndex(db);
    const kept: { n: NormalizedJob; slug: string; name: string; known: EmployerRow | undefined }[] = [];
    for (const p of res.postings) {
      const name = p.employer?.trim();
      const slug = name ? (index.get(companySlug(name)) ?? index.get(normalizeCompany(name)))?.slug ?? companySlug(name) : "";
      if (!name || !slug) {
        metrics.rejected++;
        continue;
      }
      const known = index.get(slug) ?? index.get(companySlug(name));
      const n = normalizePosting(p, { id: known?.id ?? "pending", slug });
      if ("skip" in n) metrics.skipped[n.skip] = (metrics.skipped[n.skip] ?? 0) + 1;
      else kept.push({ n, slug, name, known });
    }
    metrics.normalized = kept.length;

    const missing = new Map<string, string>();
    for (const k of kept) if (!k.known) missing.set(k.slug, k.name);
    const created = await ensureEmployers(db, missing);
    const usable: NormalizedJob[] = [];
    for (const k of kept) {
      const emp = k.known ?? created.get(k.slug);
      if (!emp) {
        metrics.rejected++;
        continue;
      }
      k.n.row.company_id = emp.id;
      usable.push(k.n);
    }

    const merged = await mergeAggregated(db, usable);
    metrics.deduplicated = merged.attached;
    metrics.refreshed = merged.refreshed;
    const { created: newIds } = await upsertJobs(db, merged.fresh, skills);
    createdIds = newIds;
    metrics.inserted = newIds.length;
    metrics.ok = true;
  } catch (e) {
    metrics.error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  metrics.ms = Date.now() - started;
  console.log(JSON.stringify({ event: "provider_sync", provider: provider.id, ok: metrics.ok, requests: metrics.requests, fetched: metrics.fetched, normalized: metrics.normalized, rejected: metrics.rejected, inserted: metrics.inserted, refreshed: metrics.refreshed, deduplicated: metrics.deduplicated, failed: metrics.failed, ms: metrics.ms, error: metrics.error ?? null }));
  return { metrics, createdIds };
}

export { AGGREGATOR_SOURCES };
