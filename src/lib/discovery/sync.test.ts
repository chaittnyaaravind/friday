import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobProvider, ProviderSearchResult } from "./providers";
import type { RawPosting } from "./sources";

vi.mock("server-only", () => ({}));
const { syncProvider } = await import("./aggregate");

// ── an in-memory stand-in for the parts of the Supabase client the pipeline uses ──
type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]>) {
  const tables = seed;
  let id = 0;
  const conflictKey = (t: string, r: Row, cols: string[]) => tables[t].find((x) => cols.every((c) => x[c] === r[c]));
  return {
    tables,
    from(name: string) {
      tables[name] ??= [];
      let op = "select";
      let payload: Row | Row[] | null = null;
      let opts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let returning = false;
      const filters: ((r: Row) => boolean)[] = [];
      const q: Record<string, unknown> = {
        select: () => ((returning = true), q),
        insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
        upsert: (p: Row | Row[], o: typeof opts = {}) => ((op = "upsert"), (payload = p), (opts = o), q),
        update: (p: Row) => ((op = "update"), (payload = p), q),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        is: (k: string, v: null) => (filters.push((r) => (v === null ? r[k] == null : r[k] === v)), q),
        not: (k: string, _o: string, v: null) => (filters.push((r) => (v === null ? r[k] != null : r[k] !== v)), q),
        single: async () => ({ data: (await run()).data?.[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: (await run()).data?.[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      const run = async (): Promise<{ data: Row[]; error: null }> => {
        const matched = () => tables[name].filter((r) => filters.every((f) => f(r)));
        if (op === "select") return { data: matched(), error: null };
        if (op === "update") {
          const rows = matched();
          for (const r of rows) Object.assign(r, payload);
          return { data: returning ? rows : [], error: null };
        }
        const out: Row[] = [];
        for (const raw of [payload].flat() as Row[]) {
          const cols = opts.onConflict?.split(",").map((c) => c.trim());
          const hit = op === "upsert" && cols ? conflictKey(name, raw, cols) : undefined;
          if (hit) {
            if (!opts.ignoreDuplicates) Object.assign(hit, raw);
            out.push(hit);
          } else {
            const row = { id: `${name}-${++id}`, imported_by: null, ...raw };
            tables[name].push(row);
            out.push(row);
          }
        }
        return { data: returning ? out : [], error: null };
      };
      return q;
    },
  };
}

const posting = (o: Partial<RawPosting> = {}): RawPosting => ({
  source: "adzuna", sourceName: "Adzuna", externalId: "adzuna:1", title: "Software Engineer Intern", applyUrl: "https://www.adzuna.com/land/ad/1", sourceUrl: "https://www.adzuna.com/land/ad/1",
  locationText: "San Jose, Santa Clara County", department: null, description: "Build APIs in Python and SQL.", postedAt: "2026-09-25T00:00:00.000Z", commitment: null, payText: null, isRemoteHint: false, onCampus: false, employer: "Acme Robotics, Inc.", ...o,
});
const provider = (postings: RawPosting[], over: Partial<ProviderSearchResult> = {}, configured = true): JobProvider => ({
  id: "adzuna", name: "Adzuna", configured: () => configured,
  search: vi.fn(async () => ({ postings, requests: 2, succeeded: 2, failed: 0, retries: 0, rejected: 0, ...over })),
});
const failing = (msg = "Adzuna returned 503"): JobProvider => ({ id: "adzuna", name: "Adzuna", configured: () => true, search: vi.fn(async () => { throw new Error(msg); }) });

let db: ReturnType<typeof fakeDb>;
const OLD = "2026-08-01T00:00:00.000Z";
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  db = fakeDb({
    profiles: [{ id: "u1", origin_label: "SJSU Campus", origin_lat: 37.33, origin_lng: -121.88, radius_miles: 25, workplace: "any", onboarded_at: "2026-09-01" }],
    companies: [{ id: "c-nvidia", slug: "nvidia", name: "NVIDIA", imported_by: null }],
    jobs: [
      // an employer's own listing, verified by its feed
      { id: "j-emp", company_id: "c-nvidia", title: "Software Engineering Intern", city: "San Jose", is_remote: false, apply_url: "https://nvidia.wd5.myworkdayjobs.com/job/1", canonical_key: "nvidia::software-engineering-intern::san-jose", status: "active", last_verified_at: OLD, imported_by: null },
    ],
    job_sources: [{ id: "s-emp", job_id: "j-emp", source: "workday", external_id: "wd:1", url: "https://nvidia.wd5.myworkdayjobs.com/job/1", is_official: true, imported_by: null }],
    job_requirements: [],
    skills: [],
  });
});
const sync = (p: JobProvider) => syncProvider(db as never, p, new Map());
const jobs = () => db.tables.jobs;
const sources = () => db.tables.job_sources;

describe("sync — success and new listings", () => {
  it("inserts a genuinely new job under an employer it creates, as a non-official Adzuna listing", async () => {
    const { metrics, createdIds } = await sync(provider([posting()]));
    expect(metrics).toMatchObject({ ok: true, attempted: true, configured: true, requests: 2, fetched: 1, normalized: 1, inserted: 1, deduplicated: 0, refreshed: 0 });
    expect(createdIds).toHaveLength(1);
    const company = db.tables.companies.find((c) => c.slug === "acme-robotics");
    expect(company).toMatchObject({ name: "Acme Robotics, Inc.", discoverable: false, ats: "careers_page" });
    const job = jobs().find((j) => j.title === "Software Engineer Intern")!;
    expect(job).toMatchObject({ company_id: company!.id, apply_url_is_official: false, employment_type: "internship", status: "active" });
    expect(sources().find((s) => s.job_id === job.id)).toMatchObject({ source: "adzuna", is_official: false, url: "https://www.adzuna.com/land/ad/1", external_id: "adzuna:1" });
  });
  it("reuses an existing employer instead of creating a duplicate (NVIDIA Corporation → nvidia)", async () => {
    await sync(provider([posting({ employer: "NVIDIA Corporation", title: "Machine Learning Intern", externalId: "adzuna:9" })]));
    expect(db.tables.companies).toHaveLength(1);
    expect(jobs().find((j) => j.title === "Machine Learning Intern")).toMatchObject({ company_id: "c-nvidia" });
  });
});

describe("sync — duplicates across providers", () => {
  it("the same job as an employer's own listing is ATTACHED as a second source; the employer job is untouched", async () => {
    const before = JSON.stringify(jobs().find((j) => j.id === "j-emp"));
    const { metrics } = await sync(provider([posting({ employer: "NVIDIA Corporation", title: "NVIDIA Software Engineer Internship", externalId: "adzuna:55" })]));
    expect(metrics).toMatchObject({ ok: true, inserted: 0, deduplicated: 1 });
    expect(jobs()).toHaveLength(1); // no duplicate card
    expect(JSON.stringify(jobs().find((j) => j.id === "j-emp"))).toBe(before); // not overwritten, not "re-verified" by a secondhand copy
    const list = sources().filter((s) => s.job_id === "j-emp");
    expect(list.map((s) => s.source).sort()).toEqual(["adzuna", "workday"]); // both provider URLs preserved
    expect(list.find((s) => s.source === "adzuna")).toMatchObject({ is_official: false, url: "https://www.adzuna.com/land/ad/1" });
    expect(list.find((s) => s.source === "workday")).toMatchObject({ is_official: true, url: "https://nvidia.wd5.myworkdayjobs.com/job/1" });
  });
  it("an exact canonical match is attached too, and never marks the employer's listing as unofficial", async () => {
    await sync(provider([posting({ employer: "NVIDIA", title: "Software Engineering Intern", externalId: "adzuna:77" })]));
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0].apply_url_is_official).not.toBe(false);
    expect(jobs()[0].apply_url).toBe("https://nvidia.wd5.myworkdayjobs.com/job/1");
  });
  it("two Adzuna results that are the same job become ONE job with two sources", async () => {
    await sync(provider([posting({ externalId: "adzuna:1" }), posting({ externalId: "adzuna:2", title: "Software Engineering Internship", sourceUrl: "https://www.adzuna.com/land/ad/2", applyUrl: "https://www.adzuna.com/land/ad/2" })]));
    const acme = jobs().filter((j) => j.company_id !== "c-nvidia");
    expect(acme).toHaveLength(1);
    expect(sources().filter((s) => s.job_id === acme[0].id && s.source === "adzuna").map((s) => s.external_id).sort()).toEqual(["adzuna:1", "adzuna:2"]);
  });
  it("a similar title that is a DIFFERENT job (different role, seniority or city) stays separate", async () => {
    const { metrics } = await sync(provider([
      posting({ employer: "NVIDIA", title: "Hardware Engineer Intern", externalId: "adzuna:a" }),
      posting({ employer: "NVIDIA", title: "Software Engineer Intern", externalId: "adzuna:b", locationText: "Austin, Texas" }),
    ]));
    // Austin is outside the Bay Area filter, so it is skipped rather than merged onto the San Jose job.
    expect(metrics.inserted).toBe(1);
    expect(metrics.skipped["outside-bay-area"]).toBe(1);
    expect(jobs().map((j) => j.title).sort()).toEqual(["Hardware Engineer Intern", "Software Engineering Intern"]);
  });
  it("re-running the sync does not duplicate anything (idempotent)", async () => {
    const p = () => provider([posting()]);
    await sync(p());
    const count = jobs().length;
    const srcCount = sources().length;
    const second = await sync(p());
    expect(jobs()).toHaveLength(count);
    expect(sources()).toHaveLength(srcCount);
    expect(second.metrics).toMatchObject({ inserted: 0, refreshed: 1 });
  });
});

describe("sync — stale handling for aggregator-only listings", () => {
  it("seeing an Adzuna-only job again refreshes its verification and reactivates it; nothing else changes", async () => {
    await sync(provider([posting()]));
    const job = jobs().find((j) => j.title === "Software Engineer Intern")!;
    job.last_verified_at = OLD;
    job.status = "closed";
    await sync(provider([posting()]));
    expect(job.status).toBe("active");
    expect(String(job.last_verified_at) > OLD).toBe(true);
  });
  it("a closed EMPLOYER job is not reactivated by an aggregator", async () => {
    jobs()[0].status = "closed";
    await sync(provider([posting({ employer: "NVIDIA", title: "Software Engineering Intern" })]));
    expect(jobs()[0].status).toBe("closed");
  });
});

describe("sync — failures are isolated and honest", () => {
  it("a provider failure is reported, does not throw, and writes nothing", async () => {
    const before = JSON.stringify(db.tables);
    const { metrics, createdIds } = await sync(failing());
    expect(metrics).toMatchObject({ ok: false, attempted: true, inserted: 0, error: "Adzuna returned 503" });
    expect(createdIds).toEqual([]);
    expect(JSON.stringify(db.tables)).toBe(before);
  });
  it("Adzuna failing does not affect a second, working provider run in the same sync", async () => {
    const bad = await sync(failing());
    const good = await sync({ ...provider([posting({ externalId: "adzuna:1" })]), id: "usajobs", name: "USAJOBS" });
    expect(bad.metrics.ok).toBe(false);
    expect(good.metrics).toMatchObject({ ok: true, inserted: 1 });
  });
  it("an unconfigured provider is not attempted, reports not-configured, and creates no jobs", async () => {
    const p = provider([posting()], {}, false);
    const { metrics } = await sync(p);
    expect(metrics).toMatchObject({ configured: false, attempted: false, ok: false, fetched: 0 });
    expect(p.search).not.toHaveBeenCalled();
    expect(jobs()).toHaveLength(1);
  });
  it("partial results (some requests failed) still sync what was fetched and report the failures", async () => {
    const { metrics } = await sync(provider([posting()], { succeeded: 1, failed: 1, retries: 2 }));
    expect(metrics).toMatchObject({ ok: true, requests: 2, succeeded: 1, failed: 1, retries: 2, inserted: 1 });
  });
  it("empty results are a successful, empty sync — nothing is fabricated", async () => {
    const { metrics } = await sync(provider([]));
    expect(metrics).toMatchObject({ ok: true, fetched: 0, inserted: 0 });
    expect(jobs()).toHaveLength(1);
  });
});

describe("sync — data quality and rejection", () => {
  it("postings without an employer are rejected and counted, not guessed", async () => {
    const { metrics } = await sync(provider([posting({ employer: undefined }), posting({ employer: "  " })]));
    expect(metrics).toMatchObject({ fetched: 2, rejected: 2, inserted: 0 });
  });
  it("FRIDAY's own filters apply: senior, non-technical and out-of-area roles are skipped with reasons", async () => {
    const { metrics } = await sync(provider([
      posting({ externalId: "adzuna:s", title: "Senior Software Engineer" }),
      posting({ externalId: "adzuna:o", locationText: "Chicago, Illinois" }),
      posting({ externalId: "adzuna:k", title: "Sales Intern" }),
    ]));
    expect(metrics.inserted).toBe(0);
    expect(Object.values(metrics.skipped).reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("preserves what the provider stated and invents nothing (pay, posted date, remote)", async () => {
    await sync(provider([posting({ payText: "$45,000–$52,000 per year", postedAt: "2026-09-20T00:00:00.000Z" })]));
    const job = jobs().find((j) => j.title === "Software Engineer Intern")!;
    expect(job.pay_text).toBe("$45K–$52K/yr"); // FRIDAY's existing pay formatting, applied to every source
    expect([job.pay_min, job.pay_max]).toEqual([45000, 52000]);
    expect(job.posted_at).toBe("2026-09-20T00:00:00.000Z");
    const second = await sync(provider([posting({ externalId: "adzuna:n", title: "Machine Learning Intern", payText: null, applyUrl: "https://www.adzuna.com/land/ad/n", sourceUrl: "https://www.adzuna.com/land/ad/n" })]));
    expect({ ...second.metrics, ms: 0 }).toMatchObject({ ok: true, inserted: 1 });
    expect(jobs().find((j) => j.title === "Machine Learning Intern")!.pay_text).toBeNull();
  });
});
