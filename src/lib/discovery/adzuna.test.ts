import { describe, expect, it, vi } from "vitest";
import { normalizePosting } from "./ingest";

vi.mock("server-only", () => ({}));
const { adzunaConfig, adzunaConfigured, AdzunaError, buildSearchUrl, createAdzunaProvider, mapAdzunaResult, QUERIES } = await import("./adzuna");
import type { AdzunaResult } from "./adzuna";
import type { SearchArea } from "@/lib/domain/search-area";

// Synthetic fixture in the shape documented at developer.adzuna.com — for unit tests only, never production data.
const result = (o: Partial<AdzunaResult> = {}): AdzunaResult => ({
  id: "4900000001",
  title: "Software Engineer <strong>Intern</strong>",
  description: "Build <b>APIs</b> in Python &amp; SQL. Work with a friendly team.",
  created: "2026-09-25T14:03:00Z",
  redirect_url: "https://www.adzuna.com/land/ad/4900000001?se=abc",
  company: { display_name: "NVIDIA Corporation" },
  location: { display_name: "San Jose, Santa Clara County" },
  salary_min: 45000,
  salary_max: 52000,
  salary_is_predicted: "0",
  contract_time: "full_time",
  ...o,
});

const area: SearchArea = { city: "San Jose", state: "CA", country: "US", lat: 37.33, lng: -121.88, radiusMiles: 25, remote: true };
const ENV = { ADZUNA_APP_ID: "test_app_id", ADZUNA_APP_KEY: "test_KEY_secret_value", ADZUNA_COUNTRY: "us" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const provider = (fetcher: typeof fetch, over: Record<string, unknown> = {}) => {
  const logs: Record<string, unknown>[] = [];
  const p = createAdzunaProvider({ env: ENV, fetch: fetcher, sleep: async () => {}, log: (l) => logs.push(l), ...over });
  return { p, logs };
};

describe("configuration", () => {
  it("needs both the app id and key; the country defaults to us and is validated", () => {
    expect(adzunaConfig({})).toBeNull();
    expect(adzunaConfig({ ADZUNA_APP_ID: "x" })).toBeNull();
    expect(adzunaConfig(ENV)).toMatchObject({ appId: "test_app_id", country: "us", maxRequests: 8 });
    expect(adzunaConfig({ ...ENV, ADZUNA_COUNTRY: "GB" })?.country).toBe("gb");
    expect(adzunaConfig({ ...ENV, ADZUNA_COUNTRY: "../etc" })?.country).toBe("us");
    expect(adzunaConfig({ ...ENV, ADZUNA_MAX_REQUESTS: "3" })?.maxRequests).toBe(3);
    expect(adzunaConfig({ ...ENV, ADZUNA_MAX_REQUESTS: "9999" })?.maxRequests).toBe(40);
    expect(adzunaConfigured({})).toBe(false);
    expect(adzunaConfigured(ENV)).toBe(true);
  });
});

describe("mapAdzunaResult — normalization", () => {
  it("maps title, employer, location, url, source and posted date, and strips HTML from text", () => {
    const p = mapAdzunaResult(result())!;
    expect(p).toMatchObject({
      source: "adzuna",
      sourceName: "Adzuna",
      externalId: "adzuna:4900000001",
      title: "Software Engineer Intern",
      employer: "NVIDIA Corporation",
      locationText: "San Jose, Santa Clara County",
      applyUrl: "https://www.adzuna.com/land/ad/4900000001?se=abc",
      sourceUrl: "https://www.adzuna.com/land/ad/4900000001?se=abc",
      postedAt: "2026-09-25T14:03:00.000Z",
      commitment: "Full-time",
      onCampus: false,
    });
    expect(p.description).toBe("Build APIs in Python & SQL. Work with a friendly team.");
  });
  it("shows a stated salary but NEVER an estimated one", () => {
    expect(mapAdzunaResult(result())!.payText).toBe("$45,000–$52,000 per year");
    expect(mapAdzunaResult(result({ salary_is_predicted: "1" }))!.payText).toBeNull();
    expect(mapAdzunaResult(result({ salary_is_predicted: 1 }))!.payText).toBeNull();
    expect(mapAdzunaResult(result({ salary_min: undefined, salary_max: undefined }))!.payText).toBeNull();
    expect(mapAdzunaResult(result({ salary_min: 60000, salary_max: 60000 }))!.payText).toBe("$60,000 per year");
  });
  it("preserves what is present and never invents what is missing", () => {
    const p = mapAdzunaResult(result({ created: undefined, location: undefined, contract_time: undefined, description: undefined }))!;
    expect(p.postedAt).toBeNull();
    expect(p.locationText).toBe("");
    expect(p.commitment).toBeNull();
    expect(p.description).toBe("");
    expect(mapAdzunaResult(result({ created: "not a date" }))!.postedAt).toBeNull();
  });
  it("rejects results missing an id, title, employer or a safe web link", () => {
    for (const bad of [{ id: undefined }, { title: "" }, { company: {} }, { company: undefined }, { redirect_url: undefined }, { redirect_url: "javascript:alert(1)" }, { redirect_url: "ftp://x.example/j" }]) {
      expect(mapAdzunaResult(result(bad as Partial<AdzunaResult>))).toBeNull();
    }
  });
  it("flags remote roles from the title, location or description", () => {
    expect(mapAdzunaResult(result({ location: { display_name: "Remote" } }))!.isRemoteHint).toBe(true);
    expect(mapAdzunaResult(result())!.isRemoteHint).toBe(false);
  });
});

describe("internship classification — explicit rules, never guessed", () => {
  const cls = (title: string) => {
    const n = normalizePosting(mapAdzunaResult(result({ title }))!, { id: "c", slug: "nvidia" });
    return "skip" in n ? n.skip : (n.row.employment_type as string);
  };
  it("labels a job an internship only when the title says so", () => {
    expect(cls("Software Engineer Intern")).toBe("internship");
    expect(cls("Software Engineering Internship")).toBe("internship");
    expect(cls("Software Engineer, New Grad")).toBe("full_time");
    expect(cls("Entry Level Software Engineer")).toBe("full_time");
  });
  it("does not let non-student or senior roles in as if they were", () => {
    expect(cls("Senior Software Engineer")).toBe("not-student-role");
    expect(cls("Software Engineer")).toBe("not-student-role");
  });
});

describe("buildSearchUrl", () => {
  const u = new URL(buildSearchUrl(adzunaConfig(ENV)!, area, QUERIES[0]));
  it("targets the official API for the configured country with the student's location and radius in km", () => {
    expect(u.origin + u.pathname).toBe("https://api.adzuna.com/v1/api/jobs/us/search/1");
    expect(u.searchParams.get("where")).toBe("San Jose, CA");
    expect(u.searchParams.get("distance")).toBe("40"); // 25 miles
    expect(u.searchParams.get("what_or")).toContain("intern");
    expect(u.searchParams.get("sort_by")).toBe("date");
    expect(u.searchParams.get("results_per_page")).toBe("50");
  });
});

describe("provider.search — success, empty, malformed", () => {
  it("returns mapped postings, deduplicated by id across queries, with accounting", async () => {
    const f = vi.fn(async () => json({ results: [result(), result({ id: 2, title: "Data Intern" }), result({ id: 3, title: "" })] })) as unknown as typeof fetch;
    const { p, logs } = provider(f);
    const r = await p.search([area]);
    expect(r.requests).toBe(2); // one area × two queries
    expect(r.succeeded).toBe(2);
    expect(r.postings.map((x) => x.externalId).sort()).toEqual(["adzuna:2", "adzuna:4900000001"]);
    expect(r.rejected).toBe(2); // the title-less result, once per query
    expect(logs.every((l) => l.ok === true)).toBe(true);
  });
  it("an empty response is success with no postings — nothing is invented", async () => {
    const { p } = provider(vi.fn(async () => json({ results: [] })) as unknown as typeof fetch);
    const r = await p.search([area]);
    expect(r).toMatchObject({ postings: [], succeeded: 2, failed: 0 });
  });
  it("a malformed body is a failed request, and with nothing else fetched the search fails", async () => {
    const { p } = provider(vi.fn(async () => json({ nope: true })) as unknown as typeof fetch);
    await expect(p.search([area])).rejects.toThrow(/unexpected response/);
    const { p: p2 } = provider(vi.fn(async () => new Response("<html>oops</html>", { status: 200 })) as unknown as typeof fetch);
    await expect(p2.search([area])).rejects.toBeInstanceOf(AdzunaError);
  });
  it("partial success returns what it got: one query failing does not lose the other", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? json({ results: [result()] }) : json({ error: "x" }, 400))) as unknown as typeof fetch;
    const { p } = provider(f);
    const r = await p.search([area]);
    expect(r).toMatchObject({ succeeded: 1, failed: 1 });
    expect(r.postings).toHaveLength(1);
  });
});

describe("provider.search — errors, rate limits, timeouts, credentials", () => {
  it("a 429 is retried with backoff and then succeeds", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const f = vi.fn(async () => (++n < 3 ? json({}, 429) : json({ results: [result()] }))) as unknown as typeof fetch;
    const { p } = provider(f, { sleep: async (ms: number) => void sleeps.push(ms) });
    const r = await p.search([area]);
    expect(r.retries).toBe(2);
    expect(r.postings).toHaveLength(1);
    expect(sleeps.slice(0, 2)).toEqual([500, 1000]); // exponential backoff
  });
  it("a persistent rate limit gives up after the retry budget and reports failure", async () => {
    const f = vi.fn(async () => json({}, 429)) as unknown as typeof fetch;
    const { p } = provider(f);
    await expect(p.search([area])).rejects.toThrow(/429/);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3 * 2); // (1 try + 2 retries) × 2 queries
  });
  it("a server error is retried; a client error is not", async () => {
    const f5 = vi.fn(async () => json({}, 503)) as unknown as typeof fetch;
    await expect(provider(f5).p.search([area])).rejects.toThrow(/503/);
    expect((f5 as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(6);
    const f4 = vi.fn(async () => json({}, 400)) as unknown as typeof fetch;
    await expect(provider(f4).p.search([area])).rejects.toThrow(/400/);
    expect((f4 as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
  it("a timeout is a retryable failure with a clear message", async () => {
    const f = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
    await expect(provider(f).p.search([area])).rejects.toThrow(/timed out/);
  });
  it("a network error is reported without leaking the request URL", async () => {
    const f = vi.fn(async (url: string) => { throw new Error(`connect ECONNRESET ${url}`); }) as unknown as typeof fetch;
    const { p } = provider(f);
    const err = await p.search([area]).catch((e) => e);
    expect(err.message).toBe("Adzuna could not be reached");
    expect(err.message).not.toContain(ENV.ADZUNA_APP_KEY);
  });
  it("rejected credentials (401/403) stop immediately instead of burning quota on every query", async () => {
    const f = vi.fn(async () => json({}, 401)) as unknown as typeof fetch;
    await expect(provider(f).p.search([area, { ...area, city: "Palo Alto" }])).rejects.toThrow(/credentials/);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
  it("missing credentials: not configured, refuses to search, and never calls the network", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const p = createAdzunaProvider({ env: {}, fetch: f, sleep: async () => {} });
    expect(p.configured()).toBe(false);
    await expect(p.search([area])).rejects.toThrow(/not configured/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("limits and secrets", () => {
  it("never exceeds the request budget, however many areas there are", async () => {
    const f = vi.fn(async () => json({ results: [] })) as unknown as typeof fetch;
    const { p } = provider(f, { env: { ...ENV, ADZUNA_MAX_REQUESTS: "3" } });
    const r = await p.search([area, { ...area, city: "A" }, { ...area, city: "B" }, { ...area, city: "C" }]);
    expect(r.requests).toBe(3);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });
  it("credentials appear only in the request URL — never in logs, errors or results", async () => {
    const good = provider(vi.fn(async () => json({ results: [result()] })) as unknown as typeof fetch);
    const r = await good.p.search([area]);
    const bad = provider(vi.fn(async () => json({}, 500)) as unknown as typeof fetch);
    const err = await bad.p.search([area]).catch((e) => e);
    const blob = JSON.stringify([good.logs, bad.logs, r, err.message]);
    expect(blob).not.toContain(ENV.ADZUNA_APP_KEY);
    expect(blob).not.toContain(ENV.ADZUNA_APP_ID);
    expect(blob).not.toContain("app_key");
  });
});
