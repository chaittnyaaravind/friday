/**
 * Adzuna — https://developer.adzuna.com. Server-side only: credentials come from the environment and never reach
 * the browser or the logs. Without them the provider reports itself unconfigured and returns nothing (no fake jobs).
 *
 * Budget: each area is searched with four title queries (intern, internship, entry level, new grad), page 1 of 50 results,
 * capped by ADZUNA_MAX_REQUESTS per sync (default 8 = two areas) — about 32 calls a day per area at the 3-hour cadence.
 */
import "server-only";
import { decodeEntities, htmlToText } from "@/lib/domain/normalize";
import { areaLabel, milesToKm, type SearchArea } from "@/lib/domain/search-area";
import { isHttpUrl } from "./import-scope";
import type { JobProvider, ProviderSearchResult } from "./providers";
import type { RawPosting } from "./sources";

type Env = Record<string, string | undefined>;
export type AdzunaConfig = { appId: string; appKey: string; country: string; maxRequests: number };

export function adzunaConfig(env: Env = process.env): AdzunaConfig | null {
  const appId = env.ADZUNA_APP_ID?.trim();
  const appKey = env.ADZUNA_APP_KEY?.trim();
  if (!appId || !appKey) return null;
  const country = (env.ADZUNA_COUNTRY ?? "us").trim().toLowerCase();
  const max = Number(env.ADZUNA_MAX_REQUESTS);
  return { appId, appKey, country: /^[a-z]{2}$/.test(country) ? country : "us", maxRequests: Number.isFinite(max) && max > 0 ? Math.min(40, Math.floor(max)) : 8 };
}
export const adzunaConfigured = (env: Env = process.env) => adzunaConfig(env) !== null;

export class AdzunaError extends Error {
  constructor(message: string, public status?: number, public retryable = false) {
    super(message);
    this.name = "AdzunaError";
  }
}

// ── response mapping ───────────────────────────────────────────────────────────────────────────

export type AdzunaResult = {
  id?: string | number;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  contract_time?: string;
};

const text = (v: string | undefined) => htmlToText(decodeEntities(v ?? "")).replace(/\s+/g, " ").trim();
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Map one Adzuna result. Returns null when it lacks what FRIDAY needs (id, title, employer, a web link). */
export function mapAdzunaResult(r: AdzunaResult): RawPosting | null {
  const id = r.id != null ? String(r.id) : "";
  const title = text(r.title);
  const employer = text(r.company?.display_name);
  if (!id || !title || !employer || !r.redirect_url || !isHttpUrl(r.redirect_url)) return null;

  const location = text(r.location?.display_name);
  const description = text(r.description);
  // Adzuna sometimes ESTIMATES pay. An estimate is not a stated salary, so it is never shown as one.
  const predicted = r.salary_is_predicted === 1 || r.salary_is_predicted === "1";
  const min = !predicted && typeof r.salary_min === "number" && r.salary_min > 0 ? r.salary_min : null;
  const max = !predicted && typeof r.salary_max === "number" && r.salary_max > 0 ? r.salary_max : null;
  const payText = min ? `${usd(min)}${max && max !== min ? `–${usd(max)}` : ""} per year` : null;
  const created = r.created && !Number.isNaN(Date.parse(r.created)) ? new Date(r.created).toISOString() : null;

  return {
    source: "adzuna",
    sourceName: "Adzuna",
    externalId: `adzuna:${id}`,
    title,
    applyUrl: r.redirect_url,
    sourceUrl: r.redirect_url,
    locationText: location,
    department: null,
    description,
    postedAt: created,
    commitment: r.contract_time === "part_time" ? "Part-time" : r.contract_time === "full_time" ? "Full-time" : null,
    payText,
    isRemoteHint: /\bremote\b/i.test(`${title} ${location} ${description}`),
    onCampus: false,
    employer,
  };
}

// ── requests ───────────────────────────────────────────────────────────────────────────────────

/**
 * `title_only` requires ALL the words to be in the job title, which is what we want: measured against the live API,
 * `what_or "intern internship co-op"` returned 12 student-titled roles per 50, while `title_only "intern"` returns 48.
 * Adzuna does not stem, so "intern" and "internship" are separate queries (0 results overlap).
 */
export type AdzunaQuery = { id: "intern" | "internship" | "entry_level" | "new_grad"; title_only: string; category?: string; maxDaysOld: number };
export const QUERIES: AdzunaQuery[] = [
  { id: "intern", title_only: "intern", category: "it-jobs", maxDaysOld: 30 },
  { id: "internship", title_only: "internship", category: "it-jobs", maxDaysOld: 30 },
  { id: "entry_level", title_only: "entry level", category: "it-jobs", maxDaysOld: 30 },
  { id: "new_grad", title_only: "new grad", category: "it-jobs", maxDaysOld: 30 },
];

/** The request URL. It carries the credentials, so it must never be logged. */
export function buildSearchUrl(cfg: AdzunaConfig, area: SearchArea, q: AdzunaQuery, page = 1, perPage = 50): string {
  const p = new URLSearchParams({
    app_id: cfg.appId,
    app_key: cfg.appKey,
    results_per_page: String(perPage),
    title_only: q.title_only,
    where: areaLabel(area),
    distance: String(milesToKm(area.radiusMiles)), // Adzuna's distance is in kilometres
    max_days_old: String(q.maxDaysOld),
    sort_by: "date",
    "content-type": "application/json",
  });
  if (q.category) p.set("category", q.category);
  return `https://api.adzuna.com/v1/api/jobs/${cfg.country}/search/${page}?${p}`;
}

type Deps = {
  env?: Env;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: Record<string, unknown>) => void;
  timeoutMs?: number;
  maxRetries?: number;
};
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One request with a timeout, and bounded retries for rate limits (429), server errors and network failures. */
async function requestPage(url: string, deps: Required<Pick<Deps, "fetch" | "sleep" | "timeoutMs" | "maxRetries">>): Promise<{ results: AdzunaResult[]; retries: number }> {
  let retries = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await deps.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs), cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new AdzunaError("Adzuna rejected the credentials", res.status);
      if (res.status === 429 || res.status >= 500) throw new AdzunaError(`Adzuna returned ${res.status}`, res.status, true);
      if (!res.ok) throw new AdzunaError(`Adzuna returned ${res.status}`, res.status);
      const body = (await res.json().catch(() => null)) as { results?: unknown } | null;
      if (!body || !Array.isArray(body.results)) throw new AdzunaError("Adzuna returned an unexpected response");
      return { results: body.results as AdzunaResult[], retries };
    } catch (e) {
      const err = e instanceof AdzunaError ? e : new AdzunaError(e instanceof Error && e.name === "TimeoutError" ? "Adzuna timed out" : "Adzuna could not be reached", undefined, true);
      if (!err.retryable || attempt >= deps.maxRetries) throw err;
      retries++;
      await deps.sleep(500 * 2 ** attempt); // 0.5s, 1s, …
    }
  }
}

export function createAdzunaProvider(deps: Deps = {}): JobProvider {
  const env = () => deps.env ?? process.env;
  return {
    id: "adzuna",
    name: "Adzuna",
    configured: (e) => adzunaConfigured(e ?? env()),
    async search(areas: SearchArea[]): Promise<ProviderSearchResult> {
      const cfg = adzunaConfig(env());
      if (!cfg) throw new AdzunaError("Adzuna is not configured (ADZUNA_APP_ID / ADZUNA_APP_KEY)");
      const d = { fetch: deps.fetch ?? fetch, sleep: deps.sleep ?? defaultSleep, timeoutMs: deps.timeoutMs ?? 15_000, maxRetries: deps.maxRetries ?? 2 };
      const log = deps.log ?? ((l) => console.log(JSON.stringify({ provider: "adzuna", ...l })));

      const out = new Map<string, RawPosting>();
      const stats: ProviderSearchResult = { postings: [], requests: 0, succeeded: 0, failed: 0, retries: 0, rejected: 0 };
      let lastError: AdzunaError | null = null;

      outer: for (const area of areas) {
        for (const q of QUERIES) {
          if (stats.requests >= cfg.maxRequests) break outer;
          stats.requests++;
          const started = Date.now();
          try {
            const { results, retries } = await requestPage(buildSearchUrl(cfg, area, q), d);
            stats.succeeded++;
            stats.retries += retries;
            let mapped = 0;
            for (const r of results) {
              const p = mapAdzunaResult(r);
              if (!p) stats.rejected++;
              else {
                mapped++;
                out.set(p.externalId, p);
              }
            }
            log({ event: "request", ok: true, city: area.city, query: q.id, results: results.length, mapped, retries, ms: Date.now() - started });
          } catch (e) {
            const err = e as AdzunaError;
            stats.failed++;
            lastError = err;
            log({ event: "request", ok: false, city: area.city, query: q.id, status: err.status ?? null, error: err.message, ms: Date.now() - started });
            if (err.status === 401 || err.status === 403) break outer; // bad credentials: retrying every query only burns quota
          }
          await d.sleep(250); // be polite between calls
        }
      }
      if (!stats.succeeded && lastError) throw lastError; // nothing could be fetched
      stats.postings = [...out.values()];
      return stats;
    },
  };
}

export const adzunaProvider = createAdzunaProvider();
