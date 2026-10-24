/**
 * Source-adapter tests. Every adapter runs against a payload CAPTURED FROM THE LIVE SOURCE (test/fixtures/sources,
 * written by capture.mjs) with `fetch` stubbed — no network, no invented API behavior. Where the real payload did
 * not exercise a branch, the test says so in its name ("UNVERIFIED") and only asserts what the adapter does with
 * the assumed shape; it makes no claim about the live API.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campusEmployerOf } from "@/lib/domain/campus";
import { parseHours } from "@/lib/domain/hours";
import { parsePay } from "@/lib/domain/normalize";
import { REGISTRY } from "./registry";
import { acrobatPdfUrl, ADAPTERS, adpStudentPosting, applicationWindow, isCampusTitle, mapAdpRequisition, parseRecruitmentPage, parseWindowPage, SourceError, STUDENT_TITLE, usable, type CompanyFeed } from "./sources";

const dir = new URL("../../../test/fixtures/sources/", import.meta.url);
const json = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, dir), "utf8")) as T;
const html = (file: string) => readFileSync(new URL(file, dir), "utf8");

type Call = { url: string; method: string; body: string | undefined };
function stubFetch(route: (url: string, init?: RequestInit) => Response | object | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      const r = route(url, init);
      if (r instanceof Response) return r;
      if (r === undefined) return new Response("not found", { status: 404, statusText: "Not Found" });
      return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const feed = (ats: CompanyFeed["ats"], name: string, config: Record<string, string>): CompanyFeed => ({ slug: name.toLowerCase(), name, ats, config });
const run = (kind: keyof typeof ADAPTERS, f: CompanyFeed) => ADAPTERS[kind]!(f);

// ───────────────────────── Greenhouse ─────────────────────────
type GH = { jobs: { id: number; title: string; absolute_url: string; first_published?: string; updated_at: string; location: { name: string }; departments?: { name: string }[]; content?: string }[] };
describe("greenhouse adapter (live payload: databricks)", () => {
  const fx = json<GH>("greenhouse.json");
  const f = feed("greenhouse", "Databricks", { token: "databricks" });
  const student = fx.jobs.filter((j) => STUDENT_TITLE.test(j.title));

  it("the fixture is a real capture with student and non-student postings", () => {
    expect(student.length).toBeGreaterThan(0);
    expect(fx.jobs.length).toBeGreaterThan(student.length);
  });

  it("keeps only student-titled postings and maps every field from the real payload", async () => {
    const calls = stubFetch(() => fx);
    const out = await run("greenhouse", f);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true");
    expect(out.map((p) => p.title)).toEqual(student.map((j) => j.title.trim()));
    for (const [i, p] of out.entries()) {
      const j = student[i];
      expect(p).toMatchObject({ source: "greenhouse", sourceName: "Databricks (Greenhouse)", externalId: `databricks:${j.id}`, applyUrl: j.absolute_url, sourceUrl: j.absolute_url, locationText: j.location.name, onCampus: false });
      expect(p.department).toBe(j.departments?.[0]?.name ?? null);
      expect(p.postedAt).toBe(j.first_published ?? null);
      expect(p.description.length).toBeGreaterThan(50);
      expect(p.description).not.toMatch(/&lt;|&gt;|<p[ >]|<strong>/); // HTML-escaped HTML is decoded to plain text
    }
  });

  it("never falls back to updated_at as the posted date (an edit time is not a posting date)", async () => {
    const rest: Record<string, unknown> = { ...student[0] };
    delete rest.first_published;
    stubFetch(() => ({ jobs: [rest] }));
    const [p] = await run("greenhouse", f);
    expect(p.postedAt).toBeNull();
  });

  it("FAILS SAFE: an HTTP error throws a SourceError carrying the status", async () => {
    stubFetch(() => new Response("boom", { status: 503, statusText: "Service Unavailable" }));
    await expect(run("greenhouse", f)).rejects.toMatchObject({ name: "SourceError", status: 503 });
  });
  it("FAILS SAFE: a payload that is not the assumed shape throws instead of returning an empty success", async () => {
    stubFetch(() => ({ error: "no such board" }));
    await expect(run("greenhouse", f)).rejects.toBeInstanceOf(SourceError);
    stubFetch(() => ({ jobs: fx.jobs.map(() => ({ unexpected: true })) }));
    await expect(run("greenhouse", f)).rejects.toThrow(/none of \d+ jobs had the expected fields/);
  });
  it("drops one malformed posting but keeps the good ones", async () => {
    stubFetch(() => ({ jobs: [{ id: 1, title: undefined }, ...student] }));
    expect(await run("greenhouse", f)).toHaveLength(student.length);
  });
  it("an empty board is a legitimate empty result (the close guard, not the adapter, protects existing listings)", async () => {
    stubFetch(() => ({ jobs: [] }));
    expect(await run("greenhouse", f)).toEqual([]);
  });
});

// ───────────────────────── Lever ─────────────────────────
type LV = { data: { id: string; text: string; hostedUrl: string; applyUrl: string; createdAt: number; categories: { commitment?: string; location?: string; team?: string }; descriptionPlain?: string; salaryRange?: unknown }[] };
describe("lever adapter (live payload: palantir)", () => {
  const fx = json<LV>("lever.json");
  const f = feed("lever", "Palantir", { token: "palantir" });
  const isStudent = (j: LV["data"][number]) => STUDENT_TITLE.test(j.text) || /intern/i.test(j.categories.commitment ?? "");
  const student = fx.data.filter(isStudent);

  it("keeps student roles (by title or 'Internship' commitment) and maps the real fields", async () => {
    const calls = stubFetch(() => fx.data);
    const out = await run("lever", f);
    expect(calls[0].url).toBe("https://api.lever.co/v0/postings/palantir?mode=json");
    expect(student.length).toBeGreaterThan(0);
    expect(out).toHaveLength(student.length);
    for (const [i, p] of out.entries()) {
      const j = student[i];
      expect(p).toMatchObject({ source: "lever", externalId: `palantir:${j.id}`, title: j.text.trim(), applyUrl: j.applyUrl, sourceUrl: j.hostedUrl, commitment: j.categories.commitment ?? null, onCampus: false });
      expect(p.postedAt).toBe(new Date(j.createdAt).toISOString()); // createdAt is epoch milliseconds
      expect(p.description).toContain((j.descriptionPlain ?? "").slice(0, 40));
      expect(p.locationText).toBeTruthy();
    }
  });
  it("UNVERIFIED branch (no live salaryRange observed in 321 postings): a salaryRange, if present, becomes pay text and does not throw", async () => {
    stubFetch(() => [{ ...student[0], salaryRange: { min: 40, max: 55, interval: "per-hour", currency: "USD" } }]);
    const [p] = await run("lever", f);
    expect(p.payText).toBe("$40–$55 per hour");
  });
  it("FAILS SAFE: a non-list payload and a list with no usable postings both throw", async () => {
    stubFetch(() => ({ ok: false, message: "Document not found" }));
    await expect(run("lever", f)).rejects.toBeInstanceOf(SourceError);
    stubFetch(() => [{ id: "x" }, { id: "y" }]);
    await expect(run("lever", f)).rejects.toThrow(/expected fields/);
  });
  it("a 404 (unknown company token) is a SourceError, not an empty result", async () => {
    stubFetch(() => new Response("{}", { status: 404, statusText: "Not Found" }));
    await expect(run("lever", f)).rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────── Ashby ─────────────────────────
type AB = { jobs: { id: string; title: string; employmentType?: string; location: string; publishedAt?: string; jobUrl: string; applyUrl: string; department?: string; compensation?: { compensationTierSummary?: string } }[] };
describe("ashby adapter (live payload: ramp)", () => {
  const fx = json<AB>("ashby.json");
  const f = feed("ashby", "Ramp", { token: "ramp" });
  const isStudent = (j: AB["jobs"][number]) => STUDENT_TITLE.test(j.title) || /intern/i.test(j.employmentType ?? "");
  const student = fx.jobs.filter(isStudent);

  it("keeps student roles and maps the real fields (publishedAt, compensation, urls)", async () => {
    const calls = stubFetch(() => fx);
    const out = await run("ashby", f);
    expect(calls[0].url).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true");
    expect(student.length).toBeGreaterThan(0);
    expect(fx.jobs.length).toBeGreaterThan(student.length);
    expect(out).toHaveLength(student.length);
    for (const [i, p] of out.entries()) {
      const j = student[i];
      expect(p).toMatchObject({ source: "ashby", externalId: `ramp:${j.id}`, title: j.title.trim(), applyUrl: j.applyUrl || j.jobUrl, sourceUrl: j.jobUrl, postedAt: j.publishedAt ?? null, commitment: j.employmentType ?? null });
      expect(p.payText).toBe(j.compensation?.compensationTierSummary ?? p.payText);
      expect(p.description.length).toBeGreaterThan(50);
    }
  });
  it("FAILS SAFE: a payload without a jobs list throws", async () => {
    stubFetch(() => ({ apiVersion: "1" }));
    await expect(run("ashby", f)).rejects.toBeInstanceOf(SourceError);
  });
});

// ───────────────────────── SmartRecruiters ─────────────────────────
type SR = { list: { content: { id: string; name: string; releasedDate: string; location: { city?: string; region?: string; country?: string; remote?: boolean }; typeOfEmployment?: { label?: string } }[] }; detail: { postingUrl?: string; applyUrl?: string }; detailFor: string };
describe("smartrecruiters adapter (live payload: ServiceNow)", () => {
  const fx = json<SR>("smartrecruiters.json");
  const f = feed("smartrecruiters", "ServiceNow", { token: "ServiceNow" });
  const chosen = fx.list.content.find((p) => p.id === fx.detailFor)!;
  const route = (url: string) => (url.includes(`/postings/${fx.detailFor}`) ? fx.detail : /\/postings\?q=/.test(url) ? fx.list : undefined);

  it("lists three queries, fetches ONE detail for the student-titled posting, and de-duplicates across queries", async () => {
    const calls = stubFetch(route);
    const out = await run("smartrecruiters", f);
    expect(calls.filter((c) => /\/postings\?q=/.test(c.url))).toHaveLength(3);
    expect(calls.filter((c) => c.url.endsWith(`/postings/${fx.detailFor}`))).toHaveLength(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "smartrecruiters", externalId: `ServiceNow:${chosen.id}`, title: chosen.name.trim(), postedAt: chosen.releasedDate, commitment: chosen.typeOfEmployment?.label ?? null, onCampus: false });
    expect(out[0].applyUrl).toBe(fx.detail.applyUrl ?? fx.detail.postingUrl);
    expect(out[0].description.length).toBeGreaterThan(50);
  });
  it("a detail that cannot be fetched still yields the posting, with the public URL and no invented description", async () => {
    stubFetch((url) => (/\/postings\?q=/.test(url) ? fx.list : undefined));
    const [p] = await run("smartrecruiters", f);
    expect(p.applyUrl).toBe(`https://jobs.smartrecruiters.com/ServiceNow/${chosen.id}`);
    expect(p.description).toBe("");
  });
  it("FAILS SAFE: a list payload without `content` throws", async () => {
    stubFetch(() => ({ totalFound: 0 }));
    await expect(run("smartrecruiters", f)).rejects.toBeInstanceOf(SourceError);
  });
});

// ───────────────────────── Workday ─────────────────────────
type WD = { list: { total: number; jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string }[] }; details: Record<string, { jobPostingInfo: { title: string; startDate?: string; postedOn?: string; jobReqId?: string; externalUrl?: string; timeType?: string } }> };
describe("workday adapter (live payload: NVIDIA)", () => {
  const fx = json<WD>("workday.json");
  const f = feed("workday", "NVIDIA", { tenant: "nvidia", host: "wd5", site: "NVIDIAExternalCareerSite" });
  const api = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite";
  const route = (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url === `${api}/jobs`) return fx.list;
    const path = url.startsWith(api) ? url.slice(api.length) : "";
    return fx.details[path];
  };

  it("maps the real list + detail payloads", async () => {
    const calls = stubFetch(route);
    const out = await run("workday", f);
    expect(out).toHaveLength(fx.list.jobPostings.length);
    expect(out.length).toBeGreaterThan(0);
    // three search terms are queried; every posting is fetched once
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(out.length);
    for (const p of out) {
      const info = fx.details[fx.list.jobPostings.find((x) => x.title === p.title)!.externalPath].jobPostingInfo;
      expect(p).toMatchObject({ source: "workday", externalId: `nvidia:${info.jobReqId}`, title: info.title.trim(), applyUrl: info.externalUrl, onCampus: false, commitment: info.timeType ?? null });
    }
  });

  it("UNVERIFIED SEMANTICS: startDate is NOT used as the posted date; both raw values are kept as source data", async () => {
    stubFetch(route);
    const out = await run("workday", f);
    for (const p of out) {
      const listed = fx.list.jobPostings.find((x) => x.title === p.title)!;
      const info = fx.details[listed.externalPath].jobPostingInfo;
      expect(info.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // the observed shape
      expect(p.postedAt).toBeNull();
      expect(p.sourceFields).toEqual({ startDate: info.startDate ?? null, postedOn: listed.postedOn ?? info.postedOn ?? null });
    }
  });

  it("OBSERVED: `total` is reported only on the first page (later pages say 0), so paging must not stop at page 2", async () => {
    const page = (n: number, offset: number) => ({
      total: offset === 0 ? 45 : 0, // <- what the live endpoint does
      jobPostings: Array.from({ length: n }, (_, i) => ({ title: `Software Engineer Intern ${offset + i}`, externalPath: `/job/US-CA-Santa-Clara/Intern-${offset + i}_R${offset + i}`, locationsText: "US, CA, Santa Clara" })),
    });
    const calls = stubFetch((url, init) => {
      if (init?.method !== "POST") return undefined; // details: not needed to observe paging
      const body = JSON.parse(String(init.body)) as { offset: number };
      return page(body.offset >= 40 ? 5 : 20, body.offset);
    });
    await run("workday", f);
    const offsets = calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body!) as { offset: number; searchText: string });
    expect(offsets.filter((o) => o.searchText === "intern").map((o) => o.offset)).toEqual([0, 20, 40]); // stops once offset+20 >= the FIRST page's total (45)
  });

  it("caps paging at offset 100 however large the reported total", async () => {
    const calls = stubFetch((url, init) => {
      if (init?.method !== "POST") return undefined;
      const { offset } = JSON.parse(String(init.body)) as { offset: number };
      return { total: offset === 0 ? 5000 : 0, jobPostings: [{ title: `Intern ${offset}`, externalPath: `/job/US-CA/Intern-${offset}_R${offset}`, locationsText: "US, CA" }] };
    });
    await run("workday", f);
    const offsets = calls.filter((c) => c.method === "POST").map((c) => (JSON.parse(c.body!) as { offset: number }).offset);
    expect(Math.max(...offsets)).toBe(80);
  });

  it("FAILS SAFE: a list without jobPostings throws; an unreadable detail is skipped, never guessed", async () => {
    stubFetch(() => ({ total: 0, unexpected: true }));
    await expect(run("workday", f)).rejects.toBeInstanceOf(SourceError);
    stubFetch((url, init) => (init?.method === "POST" ? fx.list : { somethingElse: true }));
    expect(await run("workday", f)).toEqual([]);
  });
  it("skips postings outside the US (only the US locations are read in detail)", async () => {
    const calls = stubFetch((url, init) => (init?.method === "POST" ? { total: 2, jobPostings: [{ title: "Custom SOC Intern", externalPath: "/job/China-Shanghai/x_JR1", locationsText: "China, Shanghai" }, fx.list.jobPostings[0]] } : fx.details[url.slice(api.length)]));
    const out = await run("workday", f);
    expect(out).toHaveLength(1);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });
});

// ───────────────────────── Official SJSU page ─────────────────────────
describe("sjsu_page adapter (live page: Associated Students)", () => {
  const url = "https://www.sjsu.edu/as/jobs/index.php";
  const f = feed("sjsu_page", "SJSU Associated Students", { url, department: "Associated Students" });
  const page = html("sjsu-associated-students.html");

  it("reads postings from the real page: on-campus, absolute https application links, decoded", async () => {
    stubFetch(() => new Response(page, { status: 200 }));
    const out = await run("sjsu_page", f);
    expect(out.length).toBeGreaterThan(3);
    for (const p of out) {
      expect(p).toMatchObject({ source: "sjsu_page", onCampus: true, postedAt: null, payText: null, commitment: "Part-time", sourceUrl: url });
      expect(p.applyUrl).toMatch(/^https:\/\//);
      expect(p.applyUrl).not.toContain("&amp;"); // the page double-encodes ampersands in its ADP links
      expect(p.externalId).toContain(p.title);
    }
    expect(out.map((p) => p.title)).toEqual(expect.arrayContaining(["Kitchen Assistant", "Office Assistant"]));
  });
  it("decodes links that the page encodes three or four times, so the ADP query string is intact", async () => {
    stubFetch(() => new Response(page, { status: 200 }));
    const out = await run("sjsu_page", f);
    const adp = out.filter((p) => p.applyUrl.includes("workforcenow.adp.com"));
    expect(adp.length).toBeGreaterThan(0);
    for (const p of adp) {
      const q = new URL(p.applyUrl).searchParams;
      expect([...q.keys()]).not.toContainEqual(expect.stringMatching(/^amp;/)); // no "amp;ccId" debris
      expect(q.get("jobId")).toMatch(/^\d+$/);
      expect(q.get("ccId")).toBe("19000101_000001");
    }
  });
  it("skips the page's staff section (a manager listing on the same page is not returned)", async () => {
    stubFetch(() => new Response(page, { status: 200 }));
    const titles = (await run("sjsu_page", f)).map((p) => p.title);
    expect(page).toContain("Marketing Manager");
    expect(titles).not.toContain("Marketing Manager");
  });
  it("FAILS SAFE: an HTTP error is a SourceError", async () => {
    stubFetch(() => new Response("gone", { status: 404, statusText: "Not Found" }));
    await expect(run("sjsu_page", f)).rejects.toMatchObject({ name: "SourceError", status: 404 });
  });
  it("a page with no recognisable postings yields an empty list (protected downstream by the close guard)", async () => {
    stubFetch(() => new Response("<html><body><main><p>We are redesigning this page.</p></main></body></html>", { status: 200 }));
    expect(await run("sjsu_page", f)).toEqual([]);
  });
});

// ───────────────────────── Pinpoint (SJSU Student Union) ─────────────────────────
type PP = { data: { id: string; title: string; url: string; description: string; compensation?: string; compensation_visible?: boolean; deadline_at?: string; employment_type: string; employment_type_text: string; job?: { department?: { name?: string }; structure_custom_group_one?: { name?: string; title?: string } } }[] };
describe("pinpoint adapter (live feed: sjsustudentunion.pinpointhq.com)", () => {
  const fx = json<PP>("pinpoint.json");
  const f = feed("pinpoint", "SJSU Student Union", { subdomain: "sjsustudentunion", campus: "1" });

  it("maps every real posting: pay, deadline, department, decoded text, on campus, no invented posting date", async () => {
    const calls = stubFetch(() => ({ data: fx.data }));
    const out = await run("pinpoint", f);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sjsustudentunion.pinpointhq.com/postings.json");
    expect(out).toHaveLength(fx.data.length);
    expect(out.length).toBeGreaterThan(0);
    for (const [i, p] of out.entries()) {
      const j = fx.data[i];
      expect(p).toMatchObject({ source: "pinpoint", sourceName: "SJSU Student Union (Pinpoint)", externalId: `sjsustudentunion:${j.id}`, title: j.title.trim(), applyUrl: j.url, sourceUrl: j.url, onCampus: true, postedAt: null, commitment: j.employment_type_text });
      expect(p.department).toBe(j.job?.department?.name ?? null);
      expect(p.payText).toBe(j.compensation); // structured pay used verbatim
      expect(p.deadline).toBe(j.deadline_at!.slice(0, 10));
      expect(p.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.description.length).toBeGreaterThan(100);
      expect(p.description).not.toMatch(/<div|<ul|<li|<!--/);
    }
  });
  it("the real pay strings and hours text parse to numbers (the reason these fields matter)", async () => {
    stubFetch(() => ({ data: fx.data }));
    const out = await run("pinpoint", f);
    expect(out.every((p) => parsePay(p.payText)?.unit === "hour")).toBe(true);
    const caps = out.map((p) => parseHours(p.description)?.max);
    expect(caps).toContain(20); // "may work up to, but not in excess of 20 hours per week" while school is in session
  });
  it("without campus mode nothing is treated as on campus", async () => {
    stubFetch(() => ({ data: fx.data }));
    const out = await run("pinpoint", feed("pinpoint", "SJSU Student Union", { subdomain: "sjsustudentunion" }));
    expect(out.every((p) => p.onCampus === false)).toBe(true);
  });
  it("a hidden compensation is not shown as pay", async () => {
    stubFetch(() => ({ data: [{ ...fx.data[0], compensation_visible: false, compensation: "$99 / hour", description: "<div>No pay stated here.</div>" }] }));
    const [p] = await run("pinpoint", f);
    expect(p.payText).toBeNull();
  });
  it("UNVERIFIED (only student postings were seen): a posting whose 'Employment Type' field is not Student is dropped; one with no such field is kept only if part-time or titled 'student'", async () => {
    const base = fx.data[0];
    const staff = { ...base, id: "s1", title: "Facilities Manager", job: { ...base.job, structure_custom_group_one: { name: "Career", title: "Employment Type" } } };
    const noFieldPart = { ...base, id: "s2", title: "Barista", employment_type: "part_time", job: { department: { name: "Cafe" } } };
    const noFieldFull = { ...base, id: "s3", title: "Accountant", employment_type: "full_time", job: { department: { name: "Finance" } } };
    const noFieldStudentTitle = { ...base, id: "s4", title: "Student Accountant", employment_type: "full_time", job: {} };
    stubFetch(() => ({ data: [staff, noFieldPart, noFieldFull, noFieldStudentTitle] }));
    expect((await run("pinpoint", f)).map((p) => p.externalId)).toEqual(["sjsustudentunion:s2", "sjsustudentunion:s4"]);
  });
  it("FAILS SAFE: an unsafe subdomain never reaches the network; a payload without `data` or an HTTP error throws", async () => {
    const calls = stubFetch(() => ({ data: [] }));
    await expect(run("pinpoint", feed("pinpoint", "X", { subdomain: "evil.com/x" }))).rejects.toBeInstanceOf(SourceError);
    await expect(run("pinpoint", feed("pinpoint", "X", {}))).rejects.toBeInstanceOf(SourceError);
    expect(calls).toHaveLength(0);
    stubFetch(() => ({ postings: [] }));
    await expect(run("pinpoint", f)).rejects.toBeInstanceOf(SourceError);
    stubFetch(() => new Response("nope", { status: 404, statusText: "Not Found" }));
    await expect(run("pinpoint", f)).rejects.toMatchObject({ status: 404 });
  });
  it("an employer with no open postings is a legitimate empty result", async () => {
    stubFetch(() => ({ data: [] }));
    expect(await run("pinpoint", f)).toEqual([]);
  });
});

// ───────────────────────── Workday, campus mode (SJSU Research Foundation) ─────────────────────────
describe("workday campus mode (live feed: sjsurf.wd1.myworkdayjobs.com/SJSURF)", () => {
  const fx = json<{ list: { total: number; jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string }[] } }>("workday-sjsurf.json");
  const f = feed("workday", "SJSU Research Foundation", { tenant: "sjsurf", host: "wd1", site: "SJSURF", campus: "1" });

  it("REAL: every posting open at capture time was a staff role, so none is kept — and no detail is fetched for them", async () => {
    const calls = stubFetch((url, init) => (init?.method === "POST" ? fx.list : undefined));
    expect(await run("workday", f)).toEqual([]);
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
    expect(calls.filter((c) => c.method === "POST").map((c) => (JSON.parse(c.body!) as { searchText: string }).searchText)).toEqual(["student", "assistant", "research", "intern"]);
    expect(fx.list.jobPostings.map((p) => p.title)).toEqual(expect.arrayContaining(["Accounting Manager", "Senior Research Associate"]));
  });
  it("isCampusTitle: student-level titles pass; staff titles that merely contain 'assistant' or 'research' do not", () => {
    for (const t of ["Student Assistant", "Research Assistant", "Lab Assistant", "Peer Tutor", "Summer Intern", "Student Aide"]) expect(isCampusTitle(t), t).toBe(true);
    for (const t of fx.list.jobPostings.map((p) => p.title)) expect(isCampusTitle(t), t).toBe(false); // the real staff titles
    for (const t of ["Assistant Director, Post Award", "Executive Assistant", "Assistant Professor", "Senior Research Assistant Manager", "Office Manager"]) expect(isCampusTitle(t), t).toBe(false);
  });
  it("UNVERIFIED (no student posting existed to capture): a student-titled posting is read, located anywhere, and marked on campus", async () => {
    const listed = { title: "Student Research Assistant", externalPath: "/job/Research-Foundation-Central-Office/Student-Research-Assistant_R1", locationsText: "Research Foundation Central Office" };
    stubFetch((url, init) =>
      init?.method === "POST"
        ? { total: 2, jobPostings: [listed, fx.list.jobPostings[0]] }
        : { jobPostingInfo: { id: "x1", title: "Student Research Assistant", jobReqId: "R1", location: "Research Foundation Central Office", timeType: "Part time", jobDescription: "<p>Assist with grant-funded research. Up to 20 hours per week.</p>", externalUrl: `https://sjsurf.wd1.myworkdayjobs.com/SJSURF${listed.externalPath}` } },
    );
    const out = await run("workday", f);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Student Research Assistant", onCampus: true, externalId: "sjsurf:R1", postedAt: null, commitment: "Part time" });
    expect(parseHours(out[0].description)?.max).toBe(20);
  });
  it("without campus mode the same adapter behaves exactly as before (US-only, intern/student titles, not on campus)", async () => {
    stubFetch((url, init) => (init?.method === "POST" ? fx.list : undefined));
    expect(await run("workday", feed("workday", "SJSU Research Foundation", { tenant: "sjsurf", host: "wd1", site: "SJSURF" }))).toEqual([]);
  });
});

// ───────────────────────── SJSU recruitment pages ─────────────────────────
describe("sjsu_page recruitment mode (live pages)", () => {
  const peerHtml = html("sjsu-peerconnections-team.html");
  const orientHtml = html("sjsu-orientation-leaders.html");
  const peerUrl = "https://www.sjsu.edu/peerconnections/about/our-team.php";
  const orientUrl = "https://www.sjsu.edu/newspartans/about-us/orientation-leader-recruitment.php";
  const peer = feed("sjsu_page", "SJSU Peer Connections", { url: peerUrl, department: "Peer Connections", mode: "recruitment" });
  const orient = feed("sjsu_page", "SJSU Orientation & Transition Team", { url: orientUrl, department: "Orientation & Transition", mode: "recruitment", role: "Orientation & Transition Leader" });
  const at = (iso: string) => Date.parse(iso);

  it("REAL Peer Connections page (applications open, due October 31, 2026): one posting per role section", () => {
    const out = parseRecruitmentPage(peerHtml, peer, at("2026-09-27T12:00:00Z"));
    expect(out.map((p) => p.title)).toEqual(["Learning Assistants", "Academic Peer Mentors", "Peer Tutors", "Supplemental Instruction (SI) Leaders"]);
    for (const p of out) {
      expect(p).toMatchObject({ source: "sjsu_page", onCampus: true, deadline: "2026-10-31", postedAt: null, commitment: null, payText: null, department: "Peer Connections", sourceUrl: peerUrl });
      expect(p.externalId).toBe(`${peer.slug}:${p.title}#2026-10-31`); // the due date is part of the identity: a new cycle is a new posting
      expect(p.applyUrl).toMatch(/^https:\/\/docs\.google\.com\/forms\//); // the link in the "applications are open" sentence
      expect(p.description).toContain("Applications are open until October 31, 2026.");
    }
    expect(out[0].description).toMatch(/undergraduate students/); // the role's own paragraph is kept
  });
  it("the same page after its due date produces nothing", () => {
    expect(parseRecruitmentPage(peerHtml, peer, at("2026-11-01T12:00:00Z"))).toEqual([]);
  });
  it("the due date itself still counts as open", () => {
    expect(parseRecruitmentPage(peerHtml, peer, at("2026-10-31T20:00:00Z"))).toHaveLength(4);
  });
  it("REAL Orientation page: it still says 'Applications are now OPEN!' but its close date has passed → NOTHING is emitted", () => {
    expect(orientHtml).toMatch(/Applications are now OPEN/i); // the stale banner really is on the page
    expect(parseRecruitmentPage(orientHtml, orient, at("2026-09-27T12:00:00Z"))).toEqual([]);
  });
  it("the same real Orientation page, read at a date INSIDE its stated window (assumption: the clock, not the page, is simulated), yields the configured role", () => {
    const out = parseRecruitmentPage(orientHtml, orient, at("2026-08-30T12:00:00Z"));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Orientation & Transition Leader", deadline: "2026-09-16", onCampus: true });
    expect(out[0].applyUrl).toMatch(/^https:\/\//);
  });
  it("the adapter reads the page through fetch and uses the real clock", async () => {
    stubFetch(() => new Response(peerHtml, { status: 200 }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    try {
      expect(await run("sjsu_page", peer)).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it("WITHOUT recruitment mode the same page yields nothing: the old registry entry could never have worked", async () => {
    stubFetch(() => new Response(peerHtml, { status: 200 }));
    expect(await run("sjsu_page", feed("sjsu_page", "SJSU Peer Connections", { url: peerUrl }))).toEqual([]);
  });
  it("REAL Tower Foundation page ('No open positions at this time') yields nothing", async () => {
    stubFetch(() => new Response(html("sjsu-tower-careers.html"), { status: 200 }));
    expect(await run("sjsu_page", feed("sjsu_page", "SJSU Tower Foundation", { url: "https://www.sjsu.edu/towerfoundation/about-us/Careers.php" }))).toEqual([]);
  });

  describe("what makes it refuse (small synthetic pages, each testing one rule)", () => {
    const now = at("2026-09-27T12:00:00Z");
    const page = (body: string) => `<html><body><main>${body}</main></body></html>`;
    it("open, but no due date → nothing", () => {
      expect(parseRecruitmentPage(page("<h1>Join</h1><p>Applications are open.</p><h2>Tutor</h2><p>Help students.</p>"), peer, now)).toEqual([]);
    });
    it("a due date but no 'applications are open' statement → nothing", () => {
      expect(parseRecruitmentPage(page("<h1>Join</h1><p>Applications are due: October 31, 2026.</p><h2>Tutor</h2><p>Help.</p>"), peer, now)).toEqual([]);
    });
    it("an impossible date is not a date", () => {
      expect(parseRecruitmentPage(page("<p>Applications are open.</p><p>Applications are due: February 30, 2027.</p><h2>Tutor</h2>"), peer, now)).toEqual([]);
    });
    it("generic headings are not roles; the earliest upcoming date is the deadline; a non-web link is ignored", () => {
      const out = parseRecruitmentPage(
        page(`<h1>Join Our Team</h1><p>Applications are now open — <a href="javascript:alert(1)">apply</a>. Applications are due: December 1, 2026 and the second round closes January 15, 2027.</p><h2>FAQ</h2><p>Q</p><h2>Peer Coach</h2><p>Coach peers.</p>`),
        peer, now,
      );
      expect(out.map((p) => p.title)).toEqual(["Peer Coach"]);
      expect(out[0].deadline).toBe("2026-12-01");
      expect(out[0].applyUrl).toBe(peerUrl); // the javascript: link is never used
    });
    it("section headings and calls to action are never roles (the real Orientation page has 'Application Process' and 'Student Leaders Wanted!')", () => {
      const noRole = feed("sjsu_page", "SJSU Orientation", { url: orientUrl, mode: "recruitment" }); // no configured role
      expect(parseRecruitmentPage(orientHtml, noRole, at("2026-08-30T12:00:00Z"))).toEqual([]);
    });
    it("a configured role wins over the page's headings", () => {
      const out = parseRecruitmentPage(page("<p>Applications are open.</p><p>Applications are due: December 1, 2026.</p><h2>Peer Tutors</h2><p>x</p>"), { ...peer, config: { ...peer.config, role: "Peer Educator" } }, now);
      expect(out.map((p) => p.title)).toEqual(["Peer Educator"]);
    });
    it("a page with more than eight role-like headings is not a list of roles", () => {
      const many = Array.from({ length: 9 }, (_, i) => `<h2>Peer Tutor ${i}</h2><p>x</p>`).join("");
      expect(parseRecruitmentPage(page(`<p>Applications are open.</p><p>Applications are due: December 1, 2026.</p>${many}`), peer, now)).toEqual([]);
    });
    it("no role sections and no configured role → nothing (a role is never invented)", () => {
      expect(parseRecruitmentPage(page("<p>Applications are open.</p><p>Applications are due: December 1, 2026.</p>"), peer, now)).toEqual([]);
    });
  });
});

// ───────────────────────── the registry itself ─────────────────────────
describe("SJSU registry entries", () => {
  const sjsuEntries = REGISTRY.filter((c) => c.isSjsu);
  it("every slug is unique across the whole registry", () => {
    const slugs = REGISTRY.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it("every SJSU source has a reader, an https address and a named campus employer", () => {
    expect(sjsuEntries.length).toBeGreaterThanOrEqual(8);
    for (const c of sjsuEntries) {
      expect(c.slug, c.slug).toMatch(/^sjsu-/);
      expect(c.careersUrl, c.slug).toMatch(/^https:\/\//);
      expect(ADAPTERS[c.ats as keyof typeof ADAPTERS], `${c.slug} → ${c.ats}`).toBeTypeOf("function");
      if (c.slug !== "sjsu-student-jobs") expect(campusEmployerOf(c.slug), c.slug).not.toBe("other");
    }
  });
  it("feeds are configured safely: Pinpoint subdomains are plain, Workday campus sites name tenant/host/site", () => {
    for (const c of REGISTRY.filter((x) => x.ats === "pinpoint")) expect(c.config!.subdomain).toMatch(/^[a-z0-9-]+$/i);
    for (const c of sjsuEntries.filter((x) => x.ats === "workday")) expect(c.config).toMatchObject({ campus: "1", tenant: expect.any(String), host: expect.any(String), site: expect.any(String) });
    for (const c of sjsuEntries.filter((x) => x.config?.mode === "recruitment")) expect(c.config!.url).toMatch(/^https:\/\//);
  });
  it("the Student Union and Research Foundation are read from their real feeds, and Peer Connections no longer uses the address that redirects away", () => {
    expect(REGISTRY.find((c) => c.slug === "sjsu-student-union")).toMatchObject({ ats: "pinpoint", config: { subdomain: "sjsustudentunion", campus: "1" } });
    expect(REGISTRY.find((c) => c.slug === "sjsu-research-foundation")).toMatchObject({ ats: "workday", config: { tenant: "sjsurf", host: "wd1", site: "SJSURF", campus: "1" } });
    const peerCfg = REGISTRY.find((c) => c.slug === "sjsu-peer-connections")!.config!;
    expect(peerCfg.url).toBe("https://www.sjsu.edu/peerconnections/about/our-team.php");
    expect(peerCfg.mode).toBe("recruitment");
  });
});

// ───────────────────────── shared behavior ─────────────────────────
describe("usable() — the adapter boundary guard", () => {
  const ok = (x: { id?: string }) => Boolean(x.id);
  it("returns usable items and drops unusable ones", () => {
    expect(usable<{ id?: string }>([{ id: "a" }, {}, null, { id: "b" }], ok, "postings", "u")).toEqual([{ id: "a" }, { id: "b" }]);
  });
  it("throws when the payload is not a list", () => {
    expect(() => usable({}, ok, "postings", "u")).toThrow(/not a list/);
  });
  it("throws when items exist but none is usable — never an empty success that would look like 'all closed'", () => {
    expect(() => usable([{}, {}], ok, "postings", "u")).toThrow(/none of 2 postings/);
  });
  it("an empty list is fine", () => {
    expect(usable([], ok, "postings", "u")).toEqual([]);
  });
});

describe("every registered adapter", () => {
  it("is present for each public-feed source and only those", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["ashby", "greenhouse", "lever", "pinpoint", "sjsu_page", "smartrecruiters", "usajobs", "workday"]);
  });
  it("always sends FRIDAY's own User-Agent and never credentials", async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }));
    await run("greenhouse", feed("greenhouse", "X", { token: "x" }));
    expect(seen[0]["user-agent"]).toMatch(/FRIDAY-JobAgent/);
    expect(Object.keys(seen[0]).map((k) => k.toLowerCase())).not.toContain("authorization");
  });
});

// ───────────────────────── SJSU application-window pages ─────────────────────────
describe("sjsu_page window mode (live University Housing page)", () => {
  const housingHtml = html("sjsu-housing-employment.html");
  const url = "https://www.sjsu.edu/housing/about-us/employment-opportunities.php";
  const roles = "Community Desk Assistant (CDA/ECDA)|Student Administrative Assistant (SAA)|International House Office Aide (IHOA)|Peer Academic Success Coach (PASC)|Resident Advisor (RA)|Theme Community Resident Advisor (TCRA)";
  const housing = feed("sjsu_page", "SJSU University Housing Services", { url, department: "University Housing Services", mode: "window", applyHost: "starrezhousing.com", roles });
  const at = (iso: string) => Date.parse(iso);

  it("reads the stated window: open November 2, 2026, close January 25, 2027", () => {
    expect(applicationWindow("Applications open: November 2, 2026 Applications close: January 25, 2027")).toEqual({ opens: "2026-11-02", closes: "2027-01-25" });
    expect(applicationWindow("Applications open: November 2, 2026")).toBeNull();
  });
  it("before the window opens: nothing, even though the roles are described", () => {
    expect(parseWindowPage(housingHtml, housing, at("2026-10-24T12:00:00Z"))).toEqual([]);
  });
  it("inside the window: one posting per configured role, deadline = close date, apply link = the StarRez portal", () => {
    const out = parseWindowPage(housingHtml, housing, at("2026-11-03T18:00:00Z"));
    expect(out.map((p) => p.title)).toEqual(roles.split("|"));
    for (const p of out) {
      expect(p.deadline).toBe("2027-01-25");
      expect(p.onCampus).toBe(true);
      expect(p.applyUrl).toContain("starrezhousing.com");
    }
    const cda = out.find((p) => p.title.startsWith("Community Desk"))!;
    expect(cda.description).toMatch(/front desk/i);
    expect(cda.description).not.toMatch(/Student Administrative Assistant/); // the blurb stops at the next role
  });
  it("after the window closes: nothing", () => {
    expect(parseWindowPage(housingHtml, housing, at("2027-01-26T20:00:00Z"))).toEqual([]);
  });
  it("a configured role the page no longer names is not emitted", () => {
    const out = parseWindowPage(housingHtml, feed("sjsu_page", "SJSU University Housing Services", { url, mode: "window", roles: "Community Desk Assistant (CDA/ECDA)|Night Owl Monitor" }), at("2026-11-03T18:00:00Z"));
    expect(out.map((p) => p.title)).toEqual(["Community Desk Assistant (CDA/ECDA)"]);
  });
});

// ───────────────────────── ADP career center (Associated Students) ─────────────────────────
describe("ADP career center (live Associated Students data, 2026-10-24)", () => {
  const list = JSON.parse(html("adp-as-list.json")) as { jobRequisitions: { itemID: string; requisitionTitle: string }[] };
  const clerk = JSON.parse(html("adp-as-counter-clerk.json"));
  const teacher = JSON.parse(html("adp-as-head-teacher.json"));
  const as = feed("sjsu_page", "SJSU Associated Students", { url: "https://www.sjsu.edu/as/jobs/index.php", department: "Associated Students", adpCid: "1f21e958-d199-4456-afb9-29fa26ef70be", adpCcId: "19000101_000001" });

  it("a student posting keeps its full description, stated pay, department and the AS apply link", () => {
    const base = list.jobRequisitions.find((r) => r.itemID === "9201199030613_1")!;
    const p = mapAdpRequisition({ ...base, ...clerk }, as)!;
    expect(p.title).toBe("Counter Clerk");
    expect(p.payText).toBe("$18.45 per hour");
    expect(p.department).toBe("A.S. Print Shop");
    expect(p.description.length).toBeGreaterThan(2000);
    expect(p.applyUrl).toContain("jobId=596163");
    expect(p.onCampus).toBe(true);
  });
  it("a staff posting is not kept", () => {
    const base = list.jobRequisitions.find((r) => r.itemID === "9201096844127_1")!;
    expect(mapAdpRequisition({ ...base, ...teacher }, as)).toBeNull();
  });
  it("a posting is a student one if ADP's Full/Part-Time line says Student, or the title is a student title", () => {
    expect(adpStudentPosting("Office Assistant", "Full/Part-Time: Part-Time, Student\nCompensation: $18")).toBe(true);
    expect(adpStudentPosting("Head Teacher, Preschool", "Full/Part-Time: Full-Time\n")).toBe(false);
    expect(adpStudentPosting("Student Assistant Teacher, Pre-K", "Full/Part-Time: Part-Time\n")).toBe(true); // a student title is enough
    expect(adpStudentPosting("Office Assistant", "no such line")).toBe(true);
  });
  it("the adapter reads the list, then each requisition's detail", async () => {
    stubFetch((url) => (url.includes("9201199030613_1") ? clerk : url.includes("/job-requisitions/") ? teacher : url.includes("/job-requisitions?") ? list : undefined));
    const out = await run("sjsu_page", as);
    expect(out.map((p) => p.title)).toEqual(["Counter Clerk"]);
  }, 30_000);
});

describe("Acrobat share pages (King Library job descriptions)", () => {
  // The shape seen on a live share page (2026-10-24): JSON in the page with a signed download_url on Adobe storage.
  const page = `<script>window.__s={"name":"2026 Student Assistant Job Opportunity - IT Help Desk.pdf","api_key=dc_sendtrack","download_url":"https://acp-aep-cs-blobstore-prod-va6-data.adobe.io/a93a86b5-edd6?response-content-disposition=attachment&response-content-type=application%2Fpdf&X-Amz-Expires=14400&X-Amz-Signature=abc"}</script>
  <a href="https://evil.adobe.io.example.com/x.pdf">x</a>`;
  it("finds the signed PDF link on Adobe storage, and nothing else", () => {
    expect(acrobatPdfUrl(page)).toBe("https://acp-aep-cs-blobstore-prod-va6-data.adobe.io/a93a86b5-edd6?response-content-disposition=attachment&response-content-type=application%2Fpdf&X-Amz-Expires=14400&X-Amz-Signature=abc");
    expect(acrobatPdfUrl('<a href="https://acp-aep-cs-blobstore-prod-va6-data.adobe.io.evil.com/a?response-content-type=application%2Fpdf">')).toBeNull();
    expect(acrobatPdfUrl("<p>no link</p>")).toBeNull();
  });
});
