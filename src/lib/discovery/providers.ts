/**
 * The contract for a job provider that returns postings from its OWN search API (Adzuna today; USAJOBS, licensed
 * boards and others later). Employer career feeds keep using the per-company ADAPTERS; this is for aggregators,
 * where every posting names its own employer.
 *
 * A provider only fetches and maps. Deduplication, employer resolution, persistence and stale handling are the
 * shared pipeline's job, so adding a provider never touches the core job system.
 */
import type { SearchArea } from "@/lib/domain/search-area";
import type { RawPosting, SourceKind } from "./sources";

export type ProviderSearchResult = {
  postings: RawPosting[];
  /** Request-level accounting for observability. */
  requests: number;
  succeeded: number;
  failed: number;
  retries: number;
  /** Results the provider returned that could not be mapped (missing id/title/employer/url). */
  rejected: number;
};

export interface JobProvider {
  id: SourceKind;
  name: string;
  /** True when the credentials it needs are present. An unconfigured provider is skipped, never faked. */
  configured(env?: Record<string, string | undefined>): boolean;
  /** Search every area. Must throw only when NOTHING could be fetched; partial results are returned. */
  search(areas: SearchArea[]): Promise<ProviderSearchResult>;
}

/** Sources whose listings are NOT the employer's own: never marked official, never overwrite an employer's listing. */
export const AGGREGATOR_SOURCES = new Set<string>(["adzuna"]);

/** One provider's numbers for a sync run — surfaced by the cron and the manual sync. */
export type ProviderMetrics = {
  provider: string;
  configured: boolean;
  attempted: boolean;
  ok: boolean;
  requests: number;
  succeeded: number;
  failed: number;
  retries: number;
  fetched: number;
  normalized: number;
  rejected: number;
  skipped: Record<string, number>;
  inserted: number;
  refreshed: number;
  deduplicated: number;
  ms: number;
  error?: string;
};

export const emptyMetrics = (provider: string, configured: boolean): ProviderMetrics => ({
  provider, configured, attempted: false, ok: false, requests: 0, succeeded: 0, failed: 0, retries: 0,
  fetched: 0, normalized: 0, rejected: 0, skipped: {}, inserted: 0, refreshed: 0, deduplicated: 0, ms: 0,
});
