// Captures REAL public job-feed payloads and trims them into test fixtures.
//
//   node test/fixtures/sources/capture.mjs
//
// One request per source (plus detail requests for Workday and SmartRecruiters), the same public
// endpoints FRIDAY's adapters read, sent with FRIDAY's own User-Agent. Nothing is invented: postings are
// selected from the live response and only trimmed (long strings cut, long arrays capped). Each fixture
// records when it was captured so a reader knows what "observed" means. Re-run to refresh; the adapter
// tests assert on shape and behavior, not on the specific postings.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (compatible; FRIDAY-JobAgent/1.0; student career assistant)";
const STUDENT = /\b(?:intern(?:ship)?s?|co-?op|new grad(?:uate)?|university grad(?:uate)?|early career|entry[- ]level|student|apprentice|campus|graduate program)\b/i;
const capturedAt = new Date().toISOString();

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

/** Cut long strings and cap long arrays so a fixture stays small but keeps the real shape. */
function trim(v, { str = 1500, arr = 3 } = {}) {
  if (typeof v === "string") return v.length > str ? v.slice(0, str) : v;
  if (Array.isArray(v)) return v.slice(0, arr).map((x) => trim(x, { str, arr }));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, { str, arr })]));
  return v;
}
/** HTML-escaped Greenhouse content: cut on an entity boundary so no entity is split. */
const cutEscaped = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/&[a-z#0-9]*$/i, ""));

const save = (name, data, meta) => {
  writeFileSync(join(OUT, name), JSON.stringify({ _capture: { capturedAt, ...meta }, ...data }, null, 2) + "\n");
  console.log("wrote", name);
};

mkdirSync(OUT, { recursive: true });

// ── Greenhouse ── https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
{
  const url = "https://boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true";
  const { jobs } = await (await get(url)).json();
  const pick = [...jobs.filter((j) => STUDENT.test(j.title)).slice(0, 2), ...jobs.filter((j) => !STUDENT.test(j.title)).slice(0, 1)];
  const cut = pick.map((j) => trim({ ...j, content: cutEscaped(j.content ?? "", 3000) }, { str: 3000, arr: 2 }));
  save("greenhouse.json", { jobs: cut }, { url, totalInFeed: jobs.length, withFirstPublished: jobs.filter((j) => j.first_published).length, withApplicationDeadline: jobs.filter((j) => j.application_deadline).length });
}

// ── Lever ── https://api.lever.co/v0/postings/{token}?mode=json
{
  const url = "https://api.lever.co/v0/postings/palantir?mode=json";
  const all = await (await get(url)).json();
  const isStu = (p) => STUDENT.test(p.text) || /intern/i.test(p.categories?.commitment ?? "");
  const pick = [...all.filter(isStu).slice(0, 2), ...all.filter((p) => !isStu(p)).slice(0, 1)];
  save("lever.json", { data: pick.map((p) => trim(p, { str: 2500, arr: 2 })) }, { url, totalInFeed: all.length, withSalaryRange: all.filter((p) => p.salaryRange).length });
}

// ── Ashby ── https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true
{
  // The first board in FRIDAY's registry that currently lists a student role, so the fixture exercises the adapter's filter.
  const isStu = (j) => STUDENT.test(j.title) || /intern/i.test(j.employmentType ?? "");
  let done = false;
  for (const token of ["openai", "ramp", "notion", "ashby"]) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`;
    const { jobs } = await (await get(url)).json();
    if (!jobs.some(isStu)) continue;
    const pick = [...jobs.filter(isStu).slice(0, 2), ...jobs.filter((j) => !isStu(j)).slice(0, 2)];
    save("ashby.json", { jobs: pick.map((j) => trim(j, { str: 2500, arr: 2 })) }, { url, totalInFeed: jobs.length, studentInFeed: jobs.filter(isStu).length });
    done = true;
    break;
  }
  if (!done) throw new Error("no registered Ashby board lists a student role right now; re-run later");
}

// ── SmartRecruiters ── list + one detail
{
  const listUrl = "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings?q=intern&limit=100&country=us";
  const list = await (await get(listUrl)).json();
  const chosen = list.content.find((p) => STUDENT.test(p.name));
  if (!chosen) throw new Error("no student-titled SmartRecruiters posting in the live list right now; re-run later");
  const detailUrl = `https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/${chosen.id}`;
  const detail = await (await get(detailUrl)).json();
  const nonStudent = list.content.find((p) => !STUDENT.test(p.name));
  save(
    "smartrecruiters.json",
    { list: { ...list, content: trim([chosen, nonStudent].filter(Boolean), { str: 500, arr: 6 }) }, detail: trim(detail, { str: 3000, arr: 4 }), detailFor: chosen.id },
    { listUrl, detailUrl, listedTotal: list.content.length },
  );
}

// ── Workday ── list (POST) + two details
{
  const base = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite";
  const list = await (await get(`${base}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "intern" }) })).json();
  const us = list.jobPostings.filter((p) => /US, CA/.test(p.locationsText ?? "")).slice(0, 2);
  const details = {};
  for (const p of us) details[p.externalPath] = trim(await (await get(`${base}${p.externalPath}`)).json(), { str: 3000, arr: 3 });
  save("workday.json", { list: { total: us.length, jobPostings: us }, details }, { listUrl: `${base}/jobs`, note: `list.total is rewritten to the number of kept postings so the adapter's paging loop ends; the live total was ${list.total}` });
}

// ── Official SJSU page ── HTML, the <main> element only
{
  const url = "https://www.sjsu.edu/as/jobs/index.php";
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const main = (await res.text()).match(/<main[\s\S]*?<\/main>/i)?.[0];
  if (!main) throw new Error("no <main> in the SJSU page right now");
  writeFileSync(join(OUT, "sjsu-associated-students.html"), `<!-- captured ${capturedAt} from ${url}; <main> only -->\n${main}\n`);
  console.log("wrote sjsu-associated-students.html");
}

// ── More official SJSU pages (HTML, <main> only): a recruitment page, one whose window has closed, one with no openings ──
for (const [file, url] of [
  ["sjsu-peerconnections-team.html", "https://www.sjsu.edu/peerconnections/about/our-team.php"],
  ["sjsu-orientation-leaders.html", "https://www.sjsu.edu/newspartans/about-us/orientation-leader-recruitment.php"],
  ["sjsu-tower-careers.html", "https://www.sjsu.edu/towerfoundation/about-us/Careers.php"],
]) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const main = (await res.text()).match(/<main[\s\S]*?<\/main>/i)?.[0];
  if (!main) throw new Error(`no <main> in ${url}`);
  writeFileSync(join(OUT, file), `<!-- captured ${capturedAt} from ${url}; <main> only -->\n${main}\n`);
  console.log("wrote", file);
  await new Promise((r) => setTimeout(r, 800));
}

// ── Pinpoint ── https://{subdomain}.pinpointhq.com/postings.json  (SJSU Student Union, Inc.)
{
  const url = "https://sjsustudentunion.pinpointhq.com/postings.json";
  const feed = await (await get(url)).json();
  save("pinpoint.json", { data: trim(feed.data, { str: 3500, arr: 8 }) }, { url, totalInFeed: feed.data.length, topLevelKeys: Object.keys(feed) });
}

// ── SJSU Research Foundation on Workday ── list only (what is open right now)
{
  const api = "https://sjsurf.wd1.myworkdayjobs.com/wday/cxs/sjsurf/SJSURF";
  const list = await (await get(`${api}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "" }) })).json();
  save("workday-sjsurf.json", { list }, { listUrl: `${api}/jobs`, note: "every posting open at capture time; none was a student role" });
}
