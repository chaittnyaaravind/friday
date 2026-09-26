/**
 * Source adapters. Each reads a company's PUBLIC job feed — the same data its own
 * careers page renders — and returns raw postings. No logins, no CAPTCHA handling,
 * no scraping of sites whose terms forbid it (LinkedIn, Indeed, Handshake are
 * user-import only). Requests identify FRIDAY and run with low concurrency.
 */
import { decodeEntities, htmlToText } from "@/lib/domain/normalize";

export type SourceKind = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "sjsu_page" | "usajobs";

export type RawPosting = {
  source: SourceKind;
  sourceName: string;
  externalId: string;
  title: string;
  applyUrl: string;
  sourceUrl: string;
  locationText: string;
  department: string | null;
  description: string; // plain text
  postedAt: string | null;
  /** YYYY-MM-DD when the source states one explicitly (otherwise it is parsed from the description). */
  deadline?: string | null;
  commitment: string | null;
  payText: string | null;
  isRemoteHint: boolean;
  onCampus: boolean;
};

export type CompanyFeed = {
  slug: string;
  name: string;
  ats: SourceKind;
  config: Record<string, string>;
};

const UA = "Mozilla/5.0 (compatible; FRIDAY-JobAgent/1.0; student career assistant)";
const TIMEOUT = 20_000;

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  if (!res.ok) throw new SourceError(`${res.status} ${res.statusText}`, url, res.status);
  return (await res.json()) as T;
}

export class SourceError extends Error {
  constructor(message: string, public url: string, public status?: number) {
    super(message);
    this.name = "SourceError";
  }
}

/** Cheap title pre-filter so we only pull full descriptions for plausible student roles. */
export const STUDENT_TITLE = /\b(?:intern(?:ship)?s?|co-?op|new grad(?:uate)?|university grad(?:uate)?|early career|entry[- ]level|student|apprentice|campus|graduate program)\b/i;

// ───────────────────────── Greenhouse ─────────────────────────
type GHJob = {
  id: number; title: string; absolute_url: string; updated_at: string; first_published?: string;
  location: { name: string }; content?: string; departments?: { name: string }[];
  metadata?: { name: string; value: unknown }[];
};
async function greenhouse(c: CompanyFeed): Promise<RawPosting[]> {
  const { jobs } = await getJSON<{ jobs: GHJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${c.config.token}/jobs?content=true`);
  return jobs
    .filter((j) => STUDENT_TITLE.test(j.title))
    .map((j) => {
      const description = htmlToText(decodeEntities(j.content ?? ""));
      return {
        source: "greenhouse",
        sourceName: `${c.name} (Greenhouse)`,
        externalId: `${c.config.token}:${j.id}`,
        title: j.title.trim(),
        applyUrl: j.absolute_url,
        sourceUrl: j.absolute_url,
        locationText: j.location?.name ?? "",
        department: j.departments?.[0]?.name ?? null,
        description,
        postedAt: j.first_published ?? j.updated_at ?? null,
        commitment: null,
        payText: payFromText(description),
        isRemoteHint: /remote/i.test(j.location?.name ?? ""),
        onCampus: false,
      };
    });
}

// ───────────────────────── Lever ─────────────────────────
type LeverJob = {
  id: string; text: string; hostedUrl: string; applyUrl: string; createdAt: number;
  categories: { location?: string; allLocations?: string[]; team?: string; department?: string; commitment?: string };
  descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[];
  workplaceType?: string; salaryRange?: { min: number; max: number; interval: string; currency: string };
};
async function lever(c: CompanyFeed): Promise<RawPosting[]> {
  const jobs = await getJSON<LeverJob[]>(`https://api.lever.co/v0/postings/${c.config.token}?mode=json`);
  return jobs
    .filter((j) => STUDENT_TITLE.test(j.text) || /intern/i.test(j.categories.commitment ?? ""))
    .map((j) => {
      const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
      const description = [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join("\n\n");
      const loc = j.categories.allLocations?.join("; ") || j.categories.location || "";
      return {
        source: "lever",
        sourceName: `${c.name} (Lever)`,
        externalId: `${c.config.token}:${j.id}`,
        title: j.text.trim(),
        applyUrl: j.applyUrl || j.hostedUrl,
        sourceUrl: j.hostedUrl,
        locationText: loc,
        department: j.categories.team ?? j.categories.department ?? null,
        description,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        commitment: j.categories.commitment ?? null,
        payText: j.salaryRange
          ? `$${j.salaryRange.min}–$${j.salaryRange.max} per ${j.salaryRange.interval.replace(/^per-/, "")}`
          : payFromText(description),
        isRemoteHint: j.workplaceType === "remote" || /remote/i.test(loc),
        onCampus: false,
      };
    });
}

// ───────────────────────── Ashby ─────────────────────────
type AshbyJob = {
  id: string; title: string; location: string; secondaryLocations?: { location: string }[];
  department?: string; team?: string; employmentType?: string; isRemote?: boolean; workplaceType?: string;
  descriptionPlain?: string; descriptionHtml?: string; publishedAt?: string; jobUrl: string; applyUrl: string;
  compensation?: { compensationTierSummary?: string };
};
async function ashby(c: CompanyFeed): Promise<RawPosting[]> {
  const { jobs } = await getJSON<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${c.config.token}?includeCompensation=true`,
  );
  return jobs
    .filter((j) => STUDENT_TITLE.test(j.title) || /intern/i.test(j.employmentType ?? ""))
    .map((j) => {
      const loc = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; ");
      const description = j.descriptionPlain ?? htmlToText(j.descriptionHtml);
      return {
        source: "ashby",
        sourceName: `${c.name} (Ashby)`,
        externalId: `${c.config.token}:${j.id}`,
        title: j.title.trim(),
        applyUrl: j.applyUrl || j.jobUrl,
        sourceUrl: j.jobUrl,
        locationText: loc,
        department: j.department ?? j.team ?? null,
        description,
        postedAt: j.publishedAt ?? null,
        commitment: j.employmentType ?? null,
        payText: j.compensation?.compensationTierSummary ?? payFromText(description),
        isRemoteHint: Boolean(j.isRemote) || j.workplaceType === "Remote",
        onCampus: false,
      };
    });
}

// ───────────────────────── SmartRecruiters ─────────────────────────
type SRList = { content: { id: string; name: string; releasedDate: string; location: { city?: string; region?: string; country?: string; remote?: boolean }; department?: { label?: string }; typeOfEmployment?: { label?: string } }[] };
type SRDetail = { applyUrl?: string; postingUrl?: string; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
async function smartrecruiters(c: CompanyFeed): Promise<RawPosting[]> {
  const id = encodeURIComponent(c.config.token);
  const out: RawPosting[] = [];
  for (const q of ["intern", "new grad", "student"]) {
    const { content } = await getJSON<SRList>(`https://api.smartrecruiters.com/v1/companies/${id}/postings?q=${encodeURIComponent(q)}&limit=100&country=us`);
    for (const p of content) {
      if (!STUDENT_TITLE.test(p.name) || out.some((o) => o.externalId.endsWith(p.id))) continue;
      const d = await getJSON<SRDetail>(`https://api.smartrecruiters.com/v1/companies/${id}/postings/${p.id}`).catch(() => null);
      const sections = d?.jobAd?.sections ?? {};
      const description = ["jobDescription", "qualifications", "additionalInformation"]
        .map((k) => (sections[k]?.text ? `${sections[k]?.title ?? ""}\n${htmlToText(sections[k]?.text)}` : ""))
        .filter(Boolean)
        .join("\n\n");
      const url = d?.postingUrl ?? `https://jobs.smartrecruiters.com/${c.config.token}/${p.id}`;
      out.push({
        source: "smartrecruiters",
        sourceName: `${c.name} (SmartRecruiters)`,
        externalId: `${c.config.token}:${p.id}`,
        title: p.name.trim(),
        applyUrl: d?.applyUrl ?? url,
        sourceUrl: url,
        locationText: [p.location.city, p.location.region, p.location.country?.toUpperCase()].filter(Boolean).join(", ") + (p.location.remote ? " (Remote)" : ""),
        department: p.department?.label ?? null,
        description,
        postedAt: p.releasedDate ?? null,
        commitment: p.typeOfEmployment?.label ?? null,
        payText: payFromText(description),
        isRemoteHint: Boolean(p.location.remote),
        onCampus: false,
      });
    }
  }
  return out;
}

// ───────────────────────── Workday ─────────────────────────
type WDList = { total: number; jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }[] };
type WDDetail = { jobPostingInfo: { id: string; title: string; jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; timeType?: string; externalUrl?: string; jobReqId?: string } };
const WD_US = /\b(?:US|USA|United States|California|CA)\b|Locations/;
async function workday(c: CompanyFeed): Promise<RawPosting[]> {
  const { tenant, host, site } = c.config; // host = wd1 | wd5 | ...
  const base = `https://${tenant}.${host}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${tenant}/${site}`;
  const seen = new Map<string, WDList["jobPostings"][number]>();
  for (const searchText of ["intern", "university graduate", "student"]) {
    for (let offset = 0; offset < 100; offset += 20) {
      const page = await getJSON<WDList>(`${api}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
      });
      for (const p of page.jobPostings) {
        if (STUDENT_TITLE.test(p.title) && WD_US.test(p.locationsText ?? "")) seen.set(p.externalPath, p);
      }
      if (offset + 20 >= page.total) break;
    }
  }
  const out: RawPosting[] = [];
  for (const [path, p] of seen) {
    const d = await getJSON<WDDetail>(`${api}${path}`).catch(() => null);
    if (!d) continue;
    const info = d.jobPostingInfo;
    const loc = [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join("; ");
    const description = htmlToText(info.jobDescription);
    const url = info.externalUrl ?? `${base}/en-US/${site}${path}`;
    out.push({
      source: "workday",
      sourceName: `${c.name} (Workday)`,
      externalId: `${tenant}:${info.jobReqId ?? info.id}`,
      title: info.title.trim(),
      applyUrl: url,
      sourceUrl: url,
      locationText: loc || p.locationsText || "",
      department: null,
      description,
      postedAt: info.startDate ?? null,
      commitment: info.timeType ?? null,
      payText: payFromText(description),
      isRemoteHint: /remote/i.test(loc),
      onCampus: false,
    });
  }
  return out;
}

// ───────────────────────── Official SJSU pages ─────────────────────────
/**
 * Reads an official SJSU department hiring page. Walks headings in document order so
 * "Student Assistants" listings are kept and "Full-time Staff" listings are skipped.
 * Each posting links to the department's own application system (ADP, iCIMS, Handshake…).
 */
const STAFF_HEAD = /\b(?:full[- ]time|staff|faculty|career|management|administrator)\b/i;
const STUDENT_HEAD = /\b(?:student|assistant|work[- ]study|part[- ]time|peer|tutor|leader|ambassador|lifeguard)/i;
const JOB_WORD = /\b(?:assistant|clerk|aide|tutor|mentor|leader|ambassador|advisor|technician|worker|attendant|lifeguard|coach|intern|associate|coordinator|representative|specialist|facilitator|monitor|instructor|developer|designer|writer|photographer|analyst|operator|host|barista|cashier|teacher)\b/i;
const JOB_HOST = /workforcenow\.adp\.com|icims\.com|applitrack\.com|joinhandshake\.com|dineoncampus\.com|bncollegejobs\.com|governmentjobs\.com|calcareers\.ca\.gov|jobs\.|careers\./i;

async function sjsuPage(c: CompanyFeed): Promise<RawPosting[]> {
  const res = await fetch(c.config.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new SourceError(`${res.status} ${res.statusText}`, c.config.url, res.status);
  const html = await res.text();
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;

  const out: RawPosting[] = [];
  let heading = "";
  const token = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>((?:\s|<br\s*\/?>)*([^<]{0,90}))?/gi;
  for (const m of main.matchAll(token)) {
    if (m[1] !== undefined) {
      heading = htmlToText(m[1]);
      continue;
    }
    const href = decodeEntities(decodeEntities(m[2]));
    const title = htmlToText(m[3].replace(/<span[^>]*(?:sr-only|visually-hidden|screen-reader)[^>]*>[\s\S]*?<\/span>/gi, ""))
      .replace(/\s*\(?this link opens in a new (?:window|tab)\)?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const after = htmlToText(m[5] ?? "").trim();
    if (!title || title.length < 4 || title.length > 90) continue;
    if (STAFF_HEAD.test(heading) && !STUDENT_HEAD.test(heading)) continue;
    const looksLikeJob = (JOB_HOST.test(href) && JOB_WORD.test(title)) || (JOB_WORD.test(title) && /apply|job|position|opening|hiring|employ/i.test(href + heading));
    if (!looksLikeJob || /^(?:apply|learn more|click here|more info|handshake)$/i.test(title)) continue;
    const url = new URL(href, c.config.url).toString();
    out.push({
      source: "sjsu_page",
      sourceName: c.name,
      externalId: `${c.slug}:${url}#${title}`,
      title,
      applyUrl: url,
      sourceUrl: c.config.url,
      locationText: "San Jose, CA (SJSU Campus)",
      department: after && after.length < 70 ? after : c.config.department ?? c.name,
      description: `${title} — ${after || c.name}. Posted on the official ${c.name} hiring page. Open the application link for hours, pay and eligibility.`,
      postedAt: null,
      commitment: "Part-time",
      payText: null,
      isRemoteHint: false,
      onCampus: true,
    });
  }
  return out;
}

function payFromText(text: string): string | null {
  const m = text.match(/\$\s?[\d,.]+\s*k?\s*(?:[-–—]|to)\s*\$?\s?[\d,.]+\s*k?\s*(?:\/|per)\s*(?:hour|hr|month|year|yr)|\$\s?[\d,.]+\s*(?:\/|per)\s*(?:hour|hr)/i);
  return m ? m[0] : null;
}

// ───────────────────────── USAJOBS (official U.S. federal jobs API) ─────────────────────────
// https://developer.usajobs.gov — requires a free API key and the registered contact email as User-Agent.
// Both come from the environment; without them the source is skipped (never faked).

export function usajobsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.USAJOBS_API_KEY && env.USAJOBS_USER_AGENT);
}

type UsaText = string | string[] | null | undefined;
export type UsaJobsItem = {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionTitle: string;
    PositionURI: string;
    ApplyURI?: string[];
    PositionLocationDisplay?: string;
    PositionLocation?: { LocationName?: string }[];
    OrganizationName?: string;
    DepartmentName?: string;
    PositionSchedule?: { Name?: string }[];
    PositionOfferingType?: { Name?: string }[];
    QualificationSummary?: string;
    PositionRemuneration?: { MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }[];
    PublicationStartDate?: string;
    ApplicationCloseDate?: string;
    UserArea?: { Details?: { JobSummary?: UsaText; MajorDuties?: UsaText; Education?: UsaText; Requirements?: UsaText; Evaluations?: UsaText; RemoteIndicator?: boolean | string } };
  };
};

const USA_STUDENT = /\b(?:intern(?:ship)?s?|student trainee|pathways|recent graduates?|co-?op|student)\b/i;
const asText = (v: UsaText) => htmlToText(decodeEntities(Array.isArray(v) ? v.join("\n") : v ?? ""));
const money = (n?: string) => (n ? `$${Number(n).toLocaleString("en-US")}` : null);
const RATE: Record<string, string> = { PA: "per year", PH: "per hour", BW: "bi-weekly", PM: "per month", PD: "per day" };

/** Map one USAJOBS result to a RawPosting. Returns null when it is not a student/early-career opening. */
export function mapUsajobsItem(item: UsaJobsItem): RawPosting | null {
  const d = item.MatchedObjectDescriptor;
  if (!d?.PositionTitle || !d.PositionURI) return null;
  const offering = (d.PositionOfferingType ?? []).map((o) => o.Name ?? "").join(" ");
  if (!USA_STUDENT.test(d.PositionTitle) && !USA_STUDENT.test(offering)) return null;

  const u = d.UserArea?.Details ?? {};
  const description = [asText(u.JobSummary), asText(u.MajorDuties), asText(d.QualificationSummary), asText(u.Requirements), asText(u.Education), asText(u.Evaluations)].filter(Boolean).join("\n\n");
  const rem = d.PositionRemuneration?.[0];
  const payText = rem && money(rem.MinimumRange) ? `${money(rem.MinimumRange)}${rem.MaximumRange && rem.MaximumRange !== rem.MinimumRange ? `–${money(rem.MaximumRange)}` : ""} ${RATE[rem.RateIntervalCode ?? ""] ?? ""}`.trim() : null;
  const close = d.ApplicationCloseDate?.slice(0, 10);
  const location = d.PositionLocationDisplay ?? d.PositionLocation?.map((l) => l.LocationName).filter(Boolean).join("; ") ?? "";
  return {
    source: "usajobs",
    sourceName: "USAJOBS",
    externalId: `usajobs:${item.MatchedObjectId}`,
    title: d.PositionTitle.trim(),
    applyUrl: d.ApplyURI?.[0] ?? d.PositionURI,
    sourceUrl: d.PositionURI,
    locationText: location,
    department: [d.OrganizationName, d.DepartmentName].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ") || null,
    description,
    postedAt: d.PublicationStartDate ?? null,
    deadline: close && /^\d{4}-\d{2}-\d{2}$/.test(close) ? close : null,
    commitment: d.PositionSchedule?.[0]?.Name ?? null,
    payText,
    isRemoteHint: u.RemoteIndicator === true || u.RemoteIndicator === "True" || /remote/i.test(location),
    onCampus: false,
  };
}

async function usajobs(c: CompanyFeed): Promise<RawPosting[]> {
  if (!usajobsConfigured()) throw new SourceError("USAJOBS is not configured (USAJOBS_API_KEY / USAJOBS_USER_AGENT)", "https://data.usajobs.gov");
  const headers = { Host: "data.usajobs.gov", "User-Agent": process.env.USAJOBS_USER_AGENT!, "Authorization-Key": process.env.USAJOBS_API_KEY! };
  const keywords = (c.config.keywords ?? "intern,student trainee,pathways").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 4);
  const areas: Record<string, string>[] = [{ LocationName: c.config.location ?? "San Jose, California", Radius: c.config.radius ?? "60" }, { RemoteIndicator: "True" }];
  const out = new Map<string, RawPosting>();
  // At most keywords × 2 areas requests, sequential with a pause: well inside USAJOBS's fair-use limits.
  for (const keyword of keywords) {
    for (const area of areas) {
      const q = new URLSearchParams({ Keyword: keyword, ResultsPerPage: "250", ...area });
      if (c.config.categories) q.set("JobCategoryCode", c.config.categories);
      const res = await getJSON<{ SearchResult?: { SearchResultItems?: UsaJobsItem[] } }>(`https://data.usajobs.gov/api/search?${q}`, { headers });
      for (const item of res.SearchResult?.SearchResultItems ?? []) {
        const p = mapUsajobsItem(item);
        if (p) out.set(p.externalId, p);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return [...out.values()];
}

export const ADAPTERS: Record<SourceKind, (c: CompanyFeed) => Promise<RawPosting[]>> = {
  usajobs,
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  sjsu_page: sjsuPage,
};
