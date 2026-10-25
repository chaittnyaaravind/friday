/**
 * Source adapters. Each reads a company's PUBLIC job feed — the same data its own
 * careers page renders — and returns raw postings. No logins, no CAPTCHA handling,
 * no scraping of sites whose terms forbid it (LinkedIn, Indeed, Handshake are
 * user-import only). Requests identify FRIDAY and run with low concurrency.
 */
import { todayISODate } from "@/lib/domain/hunt";
import { decodeEntities, htmlToText } from "@/lib/domain/normalize";

export type SourceKind = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday" | "pinpoint" | "sjsu_page" | "usajobs" | "adzuna";

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
  /** The employer's own name, for aggregators where each posting names a different one (see providers.ts). */
  employer?: string;
  commitment: string | null;
  payText: string | null;
  isRemoteHint: boolean;
  onCampus: boolean;
  /** The posting's detail (e.g. its description PDF) could not be read this run: reuse the last good copy, never the stub. */
  detailUnread?: boolean;
  /**
   * Source-specific raw values kept verbatim for audit (e.g. Workday's `startDate` and its "Posted 30+ Days Ago" text).
   * They are data, never a business rule: nothing derives freshness or eligibility from them until the source's
   * meaning is verified (see capabilities.ts).
   */
  sourceFields?: Record<string, string | null>;
};

export type CompanyFeed = {
  slug: string;
  name: string;
  ats: SourceKind;
  config: Record<string, string>;
  /** Fast tick: external ids already held. Adapters skip their detail fetches (the posting is dropped by the caller). */
  known?: Set<string>;
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

const has = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Fail-safe shape check at the adapter boundary. Feeds are external and can change without notice. If the payload is
 * not the list we assumed, or items exist but NONE has the fields we rely on, the adapter throws: the run records a
 * failure and closes nothing. Returning an empty "success" instead would look like "every posting was removed".
 * Individual postings missing a required field are dropped.
 */
export function usable<T>(items: unknown, isUsable: (x: T) => boolean, what: string, url: string): T[] {
  if (!Array.isArray(items)) throw new SourceError(`unexpected payload: ${what} is not a list`, url);
  const ok = (items as T[]).filter((x) => x != null && typeof x === "object" && isUsable(x));
  if (items.length > 0 && ok.length === 0) throw new SourceError(`unexpected payload: none of ${items.length} ${what} had the expected fields`, url);
  return ok;
}

/** Cheap title pre-filter so we only pull full descriptions for plausible student roles. */
/**
 * What an adapter knows about its own feed beyond the postings it returns (close-guard.ts needs both):
 *   total       postings the source listed BEFORE FRIDAY's student filter (a feed with only staff jobs is not "empty")
 *   incomplete  some posting's details could not be read, so it was left out: this run must not close anything
 * Kept beside the array (not on it) so RawPosting[] stays a plain array everywhere else.
 */
export type FeedMeta = { total: number; incomplete: boolean };
const FEED_META = new WeakMap<RawPosting[], FeedMeta>();
export const withFeed = (list: RawPosting[], meta: Partial<FeedMeta>): RawPosting[] => {
  const prev = FEED_META.get(list);
  FEED_META.set(list, { total: meta.total ?? prev?.total ?? list.length, incomplete: Boolean(meta.incomplete ?? prev?.incomplete) });
  return list;
};
export const feedMeta = (list: RawPosting[]): FeedMeta => FEED_META.get(list) ?? { total: list.length, incomplete: false };

export const STUDENT_TITLE = /\b(?:intern(?:ship)?s?|co-?op|new grad(?:uate)?|university grad(?:uate)?|early career|entry[- ]level|student|apprentice|campus|graduate program)\b/i;

// ───────────────────────── Greenhouse ─────────────────────────
type GHJob = {
  id: number; title: string; absolute_url: string; updated_at: string; first_published?: string;
  location: { name: string }; content?: string; departments?: { name: string }[];
  metadata?: { name: string; value: unknown }[];
};
async function greenhouse(c: CompanyFeed): Promise<RawPosting[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${c.config.token}/jobs?content=true`;
  const raw = await getJSON<{ jobs: GHJob[] }>(url);
  const jobs = usable<GHJob>(raw?.jobs, (j) => j.id != null && has(j.title) && has(j.absolute_url), "jobs", url);
  return withFeed(jobs
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
        // `first_published` was present on every posting observed (887/887, 2026-09-27). `updated_at` is an EDIT time, not a
        // posting date, so it is never used as a fallback: a missing first_published means "unknown", not "just now".
        postedAt: j.first_published ?? null,
        commitment: null,
        payText: payFromText(description),
        isRemoteHint: /remote/i.test(j.location?.name ?? ""),
        onCampus: false,
      };
    }), { total: jobs.length });
}

// ───────────────────────── Lever ─────────────────────────
type LeverJob = {
  id: string; text: string; hostedUrl: string; applyUrl: string; createdAt: number;
  categories: { location?: string; allLocations?: string[]; team?: string; department?: string; commitment?: string };
  descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[];
  workplaceType?: string; salaryRange?: { min: number; max: number; interval: string; currency: string };
};
async function lever(c: CompanyFeed): Promise<RawPosting[]> {
  const url = `https://api.lever.co/v0/postings/${c.config.token}?mode=json`;
  const jobs = usable<LeverJob>(await getJSON<LeverJob[]>(url), (j) => has(j.id) && has(j.text) && has(j.hostedUrl) && typeof j.categories === "object" && j.categories !== null, "postings", url);
  return withFeed(jobs
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
    }), { total: jobs.length });
}

// ───────────────────────── Ashby ─────────────────────────
type AshbyJob = {
  id: string; title: string; location: string; secondaryLocations?: { location: string }[];
  department?: string; team?: string; employmentType?: string; isRemote?: boolean; workplaceType?: string;
  descriptionPlain?: string; descriptionHtml?: string; publishedAt?: string; jobUrl: string; applyUrl: string;
  compensation?: { compensationTierSummary?: string };
};
async function ashby(c: CompanyFeed): Promise<RawPosting[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${c.config.token}?includeCompensation=true`;
  const raw = await getJSON<{ jobs: AshbyJob[] }>(url);
  const jobs = usable<AshbyJob>(raw?.jobs, (j) => has(j.id) && has(j.title) && has(j.jobUrl), "jobs", url);
  return withFeed(jobs
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
    }), { total: jobs.length });
}

// ───────────────────────── SmartRecruiters ─────────────────────────
type SRList = { content: { id: string; name: string; releasedDate: string; location: { city?: string; region?: string; country?: string; remote?: boolean }; department?: { label?: string }; typeOfEmployment?: { label?: string } }[] };
type SRDetail = { applyUrl?: string; postingUrl?: string; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
async function smartrecruiters(c: CompanyFeed): Promise<RawPosting[]> {
  const id = encodeURIComponent(c.config.token);
  const out: RawPosting[] = [];
  let listed = 0;
  for (const q of ["intern", "new grad", "student"]) {
    const listUrl = `https://api.smartrecruiters.com/v1/companies/${id}/postings?q=${encodeURIComponent(q)}&limit=100&country=us`;
    const raw = await getJSON<SRList>(listUrl);
    const content = usable<SRList["content"][number]>(raw?.content, (p) => has(p.id) && has(p.name) && typeof p.location === "object" && p.location !== null, "postings", listUrl);
    listed += content.length;
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
        // An unreadable detail keeps the posting (public URL, no invented text); agent.ts restores its last good copy.
        ...(d ? {} : { detailUnread: true }),
      });
    }
  }
  return withFeed(out, { total: listed });
}

// ───────────────────────── Pinpoint ─────────────────────────
/**
 * Pinpoint hosts each employer's careers site at {subdomain}.pinpointhq.com and serves the same postings as JSON at
 * /postings.json. Verified live 2026-09-27 against the SJSU Student Union (sjsustudentunion.pinpointhq.com): every
 * posting carried a title, url, HTML sections, structured compensation and a deadline_at. There is no posting date.
 */
type PinpointPosting = {
  id: string; title: string; url: string;
  description?: string; key_responsibilities?: string; key_responsibilities_header?: string;
  skills_knowledge_expertise?: string; skills_knowledge_expertise_header?: string; benefits?: string; benefits_header?: string;
  compensation?: string; compensation_visible?: boolean; deadline_at?: string | null;
  employment_type?: string; employment_type_text?: string; workplace_type?: string;
  location?: { name?: string; city?: string; province?: string } | null;
  job?: { department?: { name?: string } | null; structure_custom_group_one?: { name?: string; title?: string } | null } | null;
};

/**
 * OBSERVED: the Student Union tags every posting with a custom field titled "Employment Type" whose value was "Student"
 * on all five postings seen. If that field is present and is not "Student" the posting is a staff job and is dropped;
 * if it is absent, a part-time posting or a title that says "student" is kept.
 */
export function isStudentPosting(p: Pick<PinpointPosting, "title" | "employment_type" | "job">): boolean {
  const group = p.job?.structure_custom_group_one;
  if (group?.title === "Employment Type") return /student/i.test(group.name ?? "");
  return p.employment_type === "part_time" || /\bstudent\b/i.test(p.title);
}

async function pinpoint(c: CompanyFeed): Promise<RawPosting[]> {
  const sub = c.config.subdomain ?? "";
  if (!/^[a-z0-9-]+$/i.test(sub)) throw new SourceError(`invalid Pinpoint subdomain "${sub}"`, "pinpointhq.com");
  const url = `https://${sub}.pinpointhq.com/postings.json`;
  const raw = await getJSON<{ data: PinpointPosting[] }>(url);
  const items = usable<PinpointPosting>(raw?.data, (p) => has(p.id) && has(p.title) && has(p.url), "postings", url);
  const campus = c.config.campus === "1";
  return withFeed(items
    .filter((p) => !campus || isStudentPosting(p))
    .map((p) => {
      const section = (head: string | undefined, body: string | undefined) => (body ? `${head ?? ""}\n${htmlToText(decodeEntities(body))}`.trim() : "");
      const description = [
        htmlToText(decodeEntities(p.description ?? "")),
        section(p.key_responsibilities_header, p.key_responsibilities),
        section(p.skills_knowledge_expertise_header, p.skills_knowledge_expertise),
        section(p.benefits_header, p.benefits),
      ].filter(Boolean).join("\n\n");
      const where = [p.location?.name, p.location?.city, p.location?.province].filter(Boolean).join(", ");
      const due = p.deadline_at?.slice(0, 10); // the local date the posting states, e.g. "2026-09-30T23:59:59-07:00" → 2026-09-30
      return {
        source: "pinpoint",
        sourceName: `${c.name} (Pinpoint)`,
        externalId: `${sub}:${p.id}`,
        title: p.title.trim(),
        applyUrl: p.url,
        sourceUrl: p.url,
        locationText: where,
        department: p.job?.department?.name ?? null,
        description,
        postedAt: null, // the feed carries no posting date
        deadline: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        commitment: p.employment_type_text ?? null,
        payText: p.compensation_visible && has(p.compensation) ? p.compensation : payFromText(description),
        isRemoteHint: p.workplace_type === "remote",
        onCampus: campus,
      };
    }), { total: items.length });
}

// ───────────────────────── Workday ─────────────────────────
type WDList = { total: number; jobPostings: { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }[] };
type WDDetail = { jobPostingInfo: { id: string; title: string; jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; postedOn?: string; timeType?: string; externalUrl?: string; jobReqId?: string } };
const WD_US = /\b(?:US|USA|United States|California|CA)\b|Locations/;

/**
 * Campus mode (config.campus = "1", e.g. the SJSU Research Foundation): the site is an SJSU employer, so location is
 * not filtered and a posting is kept only when its TITLE names a student-level role. Staff titles that merely contain
 * "assistant" ("Assistant Director", "Executive Assistant") are excluded.
 * Verified live 2026-09-27 (sjsurf.wd1.myworkdayjobs.com/SJSURF): the feed works, and every one of its five open
 * postings was a staff role ("Accounting Manager", "Senior Research Associate"…) — none matched, correctly.
 */
const CAMPUS_TITLE = /\b(?:students?|assistants?|aides?|tutors?|interns?|internship)\b/i;
const NOT_STUDENT_TITLE = /\b(?:assistant\s+(?:director|professor|dean|vice|controller|manager|coach)|executive\s+assistant|senior|principal|director|manager)\b/i;
export const isCampusTitle = (title: string) => CAMPUS_TITLE.test(title) && !NOT_STUDENT_TITLE.test(title);

async function workday(c: CompanyFeed): Promise<RawPosting[]> {
  const { tenant, host, site } = c.config; // host = wd1 | wd5 | ...
  const campus = c.config.campus === "1";
  const base = `https://${tenant}.${host}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${tenant}/${site}`;
  const seen = new Map<string, WDList["jobPostings"][number]>();
  const listUrl = `${api}/jobs`;
  let listed = 0;
  for (const searchText of campus ? ["student", "assistant", "research", "intern"] : ["intern", "university graduate", "student"]) {
    // OBSERVED (2026-09-27, NVIDIA): Workday returns `total` ONLY on the first page (offset 0); later pages report
    // total 0 while still returning postings. The first page's total is therefore the one that bounds the loop.
    let total = 0;
    for (let offset = 0; offset < 100; offset += 20) {
      const page = await getJSON<WDList>(listUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
      });
      const postings = usable<WDList["jobPostings"][number]>(page?.jobPostings, (p) => has(p.title) && has(p.externalPath), "job postings", listUrl);
      if (offset === 0) total = Number.isFinite(page.total) ? page.total : 0;
      listed += postings.length;
      for (const p of postings) {
        const keep = campus ? isCampusTitle(p.title) : STUDENT_TITLE.test(p.title) && WD_US.test(p.locationsText ?? "");
        if (keep) seen.set(p.externalPath, p);
      }
      if (offset + 20 >= total || postings.length === 0) break;
    }
  }
  const out: RawPosting[] = [];
  let incomplete = false;
  for (const [path, p] of seen) {
    const d = await getJSON<WDDetail>(`${api}${path}`).catch(() => null);
    const info = d?.jobPostingInfo;
    if (!info || !has(info.title)) { incomplete = true; continue; } // a detail we cannot read is skipped, never guessed, and the run closes nothing
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
      // UNVERIFIED: what Workday's `startDate` means (a posting date or a role start date) is not documented in anything
      // we can verify; the one payload observed shows "2026-05-06" beside "Posted 30+ Days Ago", which fits either
      // reading. So it is NOT used as the posted date. `posted_at` stays null (FRIDAY's own first-seen time is used
      // instead, honestly) and both raw values are kept in `sourceFields` until the meaning is verified.
      postedAt: null,
      sourceFields: { startDate: info.startDate ?? null, postedOn: p.postedOn ?? info.postedOn ?? null },
      commitment: info.timeType ?? null,
      payText: payFromText(description),
      isRemoteHint: /remote/i.test(loc),
      onCampus: campus,
    });
  }
  return withFeed(out, { total: Math.max(listed, out.length), incomplete });
}

// ───────────────────────── Official SJSU pages ─────────────────────────
/**
 * Reads an official SJSU department hiring page. Walks headings in document order so
 * "Student Assistants" listings are kept and "Full-time Staff" listings are skipped.
 * Each posting links to the department's own application system (ADP, iCIMS, Handshake…).
 */
/**
 * OBSERVED (2026-09-27, sjsu.edu/as/jobs): the page encodes `&` in some ADP links three or four times
 * ("&amp;amp;amp;amp;"), and two decoding passes leave "amp;" debris in the query string. Decode until nothing changes.
 */
export function decodeUntilStable(s: string): string {
  let cur = s;
  for (let i = 0; i < 6; i++) {
    const next = decodeEntities(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

// ── Recruitment pages ─────────────────────────────────────────────────────────────────────────
// Some campus employers post no list of jobs, only a cohort recruitment: "Applications for Spring 2027 are open.
// Applications are due: October 31, 2026." followed by one section per role. Verified live 2026-09-27:
//   Peer Connections (/peerconnections/about/our-team.php) — open, four roles, due date in the future → postings
//   Orientation Leaders (…/orientation-leader-recruitment.php) — still says "Applications are now OPEN!" but its stated
//     close date (September 16) had passed → NOTHING is emitted. A banner alone is never trusted.
// A posting is produced only when the page BOTH says applications are open AND states an upcoming due date.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const OPEN_RE = /\bapplications?\b[^.]{0,80}?\b(?:are|is)\s+(?:now\s+)?open\b/i;
const DUE_RE = /(?:due|deadline|close[sd]?|closing)\b[^.\n]{0,50}?\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi;
const GENERIC_HEAD = /^(?:join our team|apply(?: now)?|how to apply|faq|frequently asked questions|questions\??|contact(?: us)?|requirements|qualifications|resources|about(?: us)?)$/i;
const ROLE_WORD = /\b(?:assistants?|mentors?|tutors?|leaders?|advisors?|advisers?|coach(?:es)?|ambassadors?|educators?|consultants?|aides?|interns?|coordinators?|representatives?|supervisors?|instructors?|monitors?)\b/i;
const NOT_A_ROLE = /[!?]$|\b(?:wanted|process|preparing|prepare|apply|application|how|why|what|learn|outcomes?|benefits?|requirements?)\b/i;

const isoDate = (y: number, monthIndex: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, monthIndex, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === monthIndex && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};

export function parseRecruitmentPage(html: string, c: CompanyFeed, now: number): RawPosting[] {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = htmlToText(main).replace(/\s+/g, " ");
  // An empty result from a page that parsed is a real answer (not open / past due), not a broken feed: total 1.
  if (!OPEN_RE.test(text)) return withFeed([], { total: 1 });

  const today = todayISODate(now);
  const upcoming = [...text.matchAll(DUE_RE)]
    .map((m) => isoDate(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2])))
    .filter((d): d is string => Boolean(d) && (d as string) >= today)
    .sort();
  if (!upcoming.length) return withFeed([], { total: 1 }); // open banner, but no upcoming due date: not evidence of a live opening
  const due = upcoming[0];
  const dueText = `${MONTHS[Number(due.slice(5, 7)) - 1].replace(/^./, (x) => x.toUpperCase())} ${Number(due.slice(8))}, ${due.slice(0, 4)}`;

  // The application link: the first link in the paragraph that announces the opening, if it is a web address.
  let applyUrl = c.config.url;
  for (const p of main.matchAll(/<p[^>]*>[\s\S]*?<\/p>/gi)) {
    if (!OPEN_RE.test(htmlToText(p[0]))) continue;
    const href = p[0].match(/<a\s[^>]*href="([^"]+)"/i)?.[1];
    if (href) {
      try {
        const u = new URL(decodeUntilStable(href), c.config.url);
        if (u.protocol === "https:" || u.protocol === "http:") applyUrl = u.toString();
      } catch { /* keep the page address */ }
    }
    break;
  }

  // The roles. A configured role wins: the page is then ONE recruitment and its headings are just sections. Otherwise
  // each h2/h3 that NAMES a role becomes a posting. Headings that read as a section or a call to action ("Application
  // Process", "Student Leaders Wanted!") are never roles — the real Orientation page has exactly those, and taking
  // them would invent openings. A page with more than eight candidate headings is not a list of roles at all.
  const heads = [...main.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ title: htmlToText(m[2]).replace(/\s+/g, " ").trim(), end: (m.index ?? 0) + m[0].length }))
    .filter((h) => h.title && h.title.length <= 80 && !GENERIC_HEAD.test(h.title) && ROLE_WORD.test(h.title) && !NOT_A_ROLE.test(h.title));
  const blurb = (from: number) => {
    const rest = main.slice(from);
    const stop = rest.search(/<h[1-4][\s>]/i);
    return htmlToText(stop === -1 ? rest : rest.slice(0, stop)).replace(/\s+/g, " ").trim().slice(0, 700);
  };
  const roles = c.config.role ? [{ title: c.config.role, blurb: "" }] : heads.length && heads.length <= 8 ? heads.map((h) => ({ title: h.title, blurb: blurb(h.end) })) : [];

  return roles.map((r) => ({
    source: "sjsu_page",
    sourceName: c.name,
    externalId: `${c.slug}:${r.title}#${due}`, // a new cycle (a new due date) is a new posting
    title: r.title,
    applyUrl,
    sourceUrl: c.config.url,
    locationText: "San Jose, CA (SJSU Campus)",
    department: c.config.department ?? c.name,
    description: [r.blurb, `Applications are open until ${dueText}. Apply through the link on the official ${c.name} page.`].filter(Boolean).join("\n\n"),
    postedAt: null,
    deadline: due,
    commitment: null,
    payText: null,
    isRemoteHint: false,
    onCampus: true,
  }));
}

// ── ADP Workforce Now career centers ───────────────────────────────────────────────────────────────
// Associated Students links each opening to its ADP career center (workforcenow.adp.com …recruitment.html?cid=…&jobId=…).
// That career center serves its own public JSON (verified live 2026-10-24): a list of requisitions, then one detail per
// requisition with the full posting HTML ("Full/Part-Time: Part-Time, Student", "Compensation: $18.45 per hour", duties).
// It is the source of truth: an opening the AS page still links but ADP no longer lists (Office Assistant, 2026-10-24) is
// closed. Only student postings are kept: the posting says "Student" in its Full/Part-Time line, or the title is a
// student-level title. Staff roles (Head Teacher, Program Coordinator) are not.
type AdpReq = {
  itemID: string; requisitionTitle: string; postDate?: string; requisitionDescription?: string;
  customFieldGroup?: { stringFields?: { nameCode?: { codeValue?: string }; stringValue?: string }[] };
};
const ADP = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";

export function adpStudentPosting(title: string, description: string): boolean {
  const kind = /Full\/Part-Time:\s*([^\n]{0,60})/i.exec(description)?.[1] ?? "";
  return /\bstudent\b/i.test(kind) || isCampusTitle(title);
}

export function mapAdpRequisition(r: AdpReq, c: CompanyFeed): RawPosting | null {
  const description = decodeUntilStable(htmlToText(decodeUntilStable(r.requisitionDescription ?? ""))).replace(/\n{3,}/g, "\n\n").trim();
  if (!has(r.requisitionTitle) || !description || !adpStudentPosting(r.requisitionTitle, description)) return null;
  const jobId = r.customFieldGroup?.stringFields?.find((f) => f.nameCode?.codeValue === "ExternalJobID")?.stringValue ?? null;
  const applyUrl = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${encodeURIComponent(c.config.adpCid)}&ccId=${encodeURIComponent(c.config.adpCcId ?? "19000101_000001")}&type=JS&lang=en_US${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`;
  const comp = /Compensation:\s*(\$[\d.,]+(?:\s*[–-]\s*\$?[\d.,]+)?\s*(?:per hour|\/\s*hr|an hour|hourly))/i.exec(description)?.[1] ?? null;
  const dept = /Department:\s*([^\n]{2,80}?)\s*(?:\n|FLSA|Full\/Part)/i.exec(description)?.[1]?.trim() ?? null;
  const posted = r.postDate && /^\d{4}-\d{2}-\d{2}/.test(r.postDate) ? new Date(`${r.postDate.slice(0, 19)}Z`).toISOString() : null;
  return {
    source: "sjsu_page",
    sourceName: `${c.name} (ADP)`,
    externalId: `adp:${r.itemID}`,
    title: r.requisitionTitle.trim(),
    applyUrl,
    sourceUrl: c.config.url,
    locationText: "San Jose, CA (SJSU Campus)",
    department: dept ?? c.config.department ?? c.name,
    description: description.slice(0, 20_000),
    postedAt: posted,
    commitment: "Part-time",
    payText: comp ?? payFromText(description),
    isRemoteHint: false,
    onCampus: true,
  };
}

async function adpCareerCenter(c: CompanyFeed): Promise<RawPosting[]> {
  const cid = c.config.adpCid ?? "";
  const ccId = c.config.adpCcId ?? "19000101_000001";
  if (!/^[0-9a-f-]{36}$/i.test(cid) || !/^[0-9_]{6,30}$/.test(ccId)) throw new SourceError("invalid ADP career center id", "workforcenow.adp.com");
  const q = `cid=${cid}&timeStamp=${Date.now()}&lang=en_US&ccId=${ccId}&locale=en_US`;
  const list = await getJSON<{ jobRequisitions?: AdpReq[] }>(`${ADP}?${q}&$top=100`);
  const reqs = usable<AdpReq>(list?.jobRequisitions, (r) => has(r.itemID) && has(r.requisitionTitle), "jobRequisitions", ADP);
  const out: RawPosting[] = [];
  let incomplete = reqs.length >= 100; // a full page may be truncated: what it leaves out is unknown, not closed
  // Every listed requisition is read: the student filter needs the detail, so a cap before it could hide student jobs.
  for (const r of reqs) {
    if (!/^[0-9_]{5,30}$/.test(r.itemID)) continue;
    if (c.known?.has(`adp:${r.itemID}`)) continue; // fast tick: already held, nothing to read
    const detail = await getJSON<AdpReq>(`${ADP}/${r.itemID}?${q}`).catch(() => null);
    if (!detail) { incomplete = true; continue; }
    const p = mapAdpRequisition({ ...r, ...detail }, c);
    if (p) out.push(p);
    await new Promise((res) => setTimeout(res, 250));
  }
  return withFeed(out, { total: reqs.length, incomplete });
}

// ── Application-window pages ──────────────────────────────────────────────────────────────────
// University Housing Services (/housing/about-us/employment-opportunities.php) names its student roles in plain paragraphs
// and states the cycle as "Applications open: November 2, 2026 / Applications close: January 25, 2027" (verified live
// 2026-10-24). The roles are configured (config.roles, "|"-separated) because the page has no per-role headings; a posting
// is produced for each role ONLY while today is inside the stated window. Before it opens or after it closes: nothing.
const WINDOW_RE = (word: "open" | "close") =>
  new RegExp(`applications?\\s+${word}s?\\s*:?\\s*(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i");

export function applicationWindow(text: string): { opens: string; closes: string } | null {
  const date = (m: RegExpMatchArray | null) => (m ? isoDate(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2])) : null);
  const opens = date(text.match(WINDOW_RE("open")));
  const closes = date(text.match(WINDOW_RE("close")));
  return opens && closes && opens <= closes ? { opens, closes } : null;
}

export function parseWindowPage(html: string, c: CompanyFeed, now: number): RawPosting[] {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = htmlToText(main).replace(/\s+/g, " ");
  const win = applicationWindow(text);
  const today = todayISODate(now);
  if (!win || today < win.opens || today > win.closes) return withFeed([], { total: 1 }); // outside the window: closed, not broken
  const roles = (c.config.roles ?? "").split("|").map((r) => r.trim()).filter(Boolean);
  const closeText = `${MONTHS[Number(win.closes.slice(5, 7)) - 1].replace(/^./, (x) => x.toUpperCase())} ${Number(win.closes.slice(8))}, ${win.closes.slice(0, 4)}`;
  // The application link: the first link to the configured application host, else the page itself.
  let applyUrl = c.config.url;
  for (const m of main.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) {
    const href = decodeUntilStable(m[1]);
    if (c.config.applyHost && href.includes(c.config.applyHost)) {
      try { applyUrl = new URL(href, c.config.url).toString(); } catch { /* keep the page address */ }
      break;
    }
  }
  const at = roles.map((r) => ({ r, i: text.indexOf(r) }));
  return at
    .filter(({ i }) => i !== -1) // a configured role the page no longer names is not an opening
    .map(({ r, i }) => {
      const next = at.map((x) => x.i).filter((j) => j > i).sort((a, b) => a - b)[0];
      const blurb = text.slice(i + r.length, next ?? i + r.length + 700).trim().slice(0, 700);
      return {
        source: "sjsu_page" as const,
        sourceName: c.name,
        externalId: `${c.slug}:${r}#${win.closes}`, // a new cycle is a new posting
        title: r,
        applyUrl,
        sourceUrl: c.config.url,
        locationText: "San Jose, CA (SJSU Campus)",
        department: c.config.department ?? c.name,
        description: [blurb, `Applications are open until ${closeText}. Apply through the link on the official ${c.name} page.`].filter(Boolean).join("\n\n"),
        postedAt: null,
        deadline: win.closes,
        commitment: null,
        payText: null,
        isRemoteHint: false,
        onCampus: true,
      };
    });
}

const STAFF_HEAD = /\b(?:full[- ]time|staff|faculty|career|management|administrator)\b/i;
const STUDENT_HEAD = /\b(?:student|assistant|work[- ]study|part[- ]time|peer|tutor|leader|ambassador|lifeguard)/i;
const JOB_WORD = /\b(?:assistant|clerk|aide|tutor|mentor|leader|ambassador|advisor|technician|worker|attendant|lifeguard|coach|intern|associate|coordinator|representative|specialist|facilitator|monitor|instructor|developer|designer|writer|photographer|analyst|operator|host|barista|cashier|teacher)\b/i;
const JOB_HOST = /workforcenow\.adp\.com|icims\.com|applitrack\.com|joinhandshake\.com|dineoncampus\.com|bncollegejobs\.com|governmentjobs\.com|calcareers\.ca\.gov|jobs\.|careers\./i;

async function sjsuPage(c: CompanyFeed): Promise<RawPosting[]> {
  // An employer page whose openings live in an ADP career center: read the career center itself (see adpCareerCenter).
  if (c.config.adpCid) return adpCareerCenter(c);
  const res = await fetch(c.config.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new SourceError(`${res.status} ${res.statusText}`, c.config.url, res.status);
  const html = await res.text();
  if (c.config.mode === "recruitment") return parseRecruitmentPage(html, c, Date.now());
  if (c.config.mode === "window") return parseWindowPage(html, c, Date.now());
  const postings = parseListPage(html, c);
  if (c.config.details === "acrobat") {
    // King Library: each opening links its job description as an Acrobat share. Read it for duties, pay and the real
    // application form. One unreadable PDF keeps that posting's last good copy (detailUnread).
    for (const p of postings) {
      if (c.known?.has(p.externalId)) continue; // fast tick: already held (the caller drops it)
      const read = () => acrobatText(p.applyUrl).catch(() => null);
      const isAcrobat = /^https:\/\/acrobat\.adobe\.com\//i.test(p.applyUrl);
      const got = isAcrobat ? (await read()) ?? (await read()) : null; // one retry
      // Unreadable twice: flagged, so the last good description and form link are kept (agent.ts) instead of this stub.
      if (isAcrobat && !got) p.detailUnread = true;
      const text = got?.text ?? null;
      if (got && text) {
        // The description PDF is not the application: it links the real form (a Google Form behind one.SJSU login,
        // verified 2026-10-25). That form becomes the apply link; the PDF stays reachable from the description.
        const form = applicationLink(text, got.links);
        p.description = `${text.slice(0, 19_500)}${form ? `\n\nJob description: ${p.applyUrl}` : ""}`;
        if (form) p.applyUrl = form;
        // The Library states pay as "Initial Hourly Rate … Undergraduate Students - $18.45" (verified 2026-10-24).
        const rate = /hourly rate[\s\S]{0,120}?\$\s?(\d{2}(?:\.\d{2})?)/i.exec(text)?.[1];
        p.payText = payRateText(text) ?? payFromText(text) ?? (rate ? `$${rate}/hr` : null);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return postings;
  }
  if (c.config.details !== "pdf") return postings;
  // Pages whose openings link to job-description PDFs on sjsu.edu (Parking Services): read each PDF for the duties and the
  // stated pay. One PDF failing leaves that posting with the plain description; it never fails the source.
  const notes = pageNotes(html);
  for (const p of postings) {
    if (c.known?.has(p.externalId)) continue; // fast tick: already held (the caller drops it)
    const text = await pdfText(p.applyUrl).catch(() => null);
    if (text) {
      p.description = [text, notes].filter(Boolean).join("\n\n").slice(0, 20_000);
      p.payText = payRateText(text);
    } else if (notes) p.description = `${p.description}\n\n${notes}`;
    p.applyUrl = c.config.url; // the page says how to apply (an application form by email); the PDF is the description
    await new Promise((r) => setTimeout(r, 400));
  }
  return postings;
}

/** List-style hiring page → one posting per job link. Pure. Links to application FORMS and "[pdf]" labels are not jobs. */
export function parseListPage(html: string, c: CompanyFeed): RawPosting[] {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const out: RawPosting[] = [];
  let heading = "";
  const token = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>((?:\s|<br\s*\/?>)*([^<]{0,90}))?/gi;
  for (const m of main.matchAll(token)) {
    if (m[1] !== undefined) {
      heading = htmlToText(m[1]);
      continue;
    }
    const href = decodeUntilStable(m[2]);
    const title = htmlToText(m[3].replace(/<span[^>]*(?:sr-only|visually-hidden|screen-reader)[^>]*>[\s\S]*?<\/span>/gi, ""))
      .replace(/\s*\(?this link opens in a new (?:window|tab)\)?/gi, "")
      .replace(/\s*[[(]\s*pdf\s*[\])]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const after = htmlToText(m[5] ?? "").trim();
    if (!title || title.length < 4 || title.length > 90) continue;
    if (STAFF_HEAD.test(heading) && !STUDENT_HEAD.test(heading)) continue;
    if (/\b(?:application|form)\b/i.test(title)) continue; // "SJSU Student Assistant Job Application" is a form, not an opening
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

/** The page's own words after its list of openings (how to apply, requirements) — they apply to every opening on it. */
export function pageNotes(html: string): string {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = htmlToText(main).replace(/[ \t]+/g, " ");
  const at = text.search(/\b(?:if interested|to apply|how to apply|applicant requirements|requirements)\b/i);
  return at >= 0 ? text.slice(at).replace(/\n{2,}/g, "\n").trim().slice(0, 2_000) : "";
}

/**
 * "Start Pay Rate: $18.00" → "$18.00 per hour (stated start pay rate)". CSU student-assistant postings state their WAGE as
 * a "pay rate" without a unit; a dollar rate under $100 there is hourly. Anything else (no "pay rate" wording, a larger
 * figure) is left unknown. Pure.
 */
export function payRateText(text: string): string | null {
  const m = text.match(/\b(?:start(?:ing)?\s+)?pay\s+rate\s*:?\s*\$\s?(\d{1,2}(?:\.\d{2})?)\b(?!\s*(?:k|,\d|\d))/i);
  return m && Number(m[1]) > 0 ? `$${m[1]} per hour (stated start pay rate)` : null;
}

const PDF_MAX = 3_000_000;
/** Text of a job-description PDF on www.sjsu.edu only (no other host is fetched), size- and time-limited. */
// Hosts a job-description PDF may come from: SJSU's own site, or the Adobe storage behind an Acrobat share link.
const ADOBE_BLOB = /^acp-aep-cs-blobstore-prod-[a-z0-9]+-data\.adobe\.io$/;

/**
 * An Acrobat share page (acrobat.adobe.com/id/urn:aaid:…, how the King Library links each job description; verified
 * 2026-10-24) embeds a short-lived signed download link for the PDF on Adobe's storage. Pure: the first such link, or null.
 */
export function acrobatPdfUrl(html: string): string | null {
  for (const m of html.matchAll(/https:\/\/[a-z0-9.-]+\.adobe\.io\/[^"'\s<>\\]+/gi)) {
    const raw = m[0].replace(/&amp;/g, "&");
    try {
      const u = new URL(raw);
      if (ADOBE_BLOB.test(u.hostname) && /application%2Fpdf|application\/pdf/i.test(raw)) return u.toString();
    } catch { /* not a URL */ }
  }
  return null;
}

async function acrobatText(url: string): Promise<PdfRead | null> {
  const u = new URL(url);
  if (u.hostname !== "acrobat.adobe.com" || !/^\/id\/urn:aaid:sc:/i.test(u.pathname)) return null;
  const res = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) return null;
  const pdf = acrobatPdfUrl(await res.text());
  return pdf ? pdfRead(pdf) : null;
}

/** A PDF's text and the targets of its clickable links (a link's URL is often not in the text: "Apply here"). */
type PdfRead = { text: string; links: string[] };

async function pdfRead(url: string): Promise<PdfRead | null> {
  const u = new URL(url);
  const sjsu = u.hostname === "www.sjsu.edu" && /\.pdf$/i.test(u.pathname);
  if (!sjsu && !ADOBE_BLOB.test(u.hostname)) return null;
  const res = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > PDF_MAX) return null;
  const { extractLinks, extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(buf);
  const { text } = await extractText(doc, { mergePages: true });
  const links = await extractLinks(doc).then((r) => r.links).catch(() => [] as string[]);
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
  return clean ? { text: clean, links } : null;
}

const pdfText = async (url: string) => (await pdfRead(url))?.text ?? null;

/** Hosts a campus application form lives on. A link elsewhere in a job description (a department page, a map) is not it. */
const FORM_HOST = /^(?:forms\.gle|docs\.google\.com|forms\.office\.com|forms\.microsoft\.com|sjsu\.joinhandshake\.com|app\.joinhandshake\.com)$/i;
/** A campus system on its own sjsu.edu subdomain (e.g. a forms or HR portal). www.sjsu.edu is department pages, never a form. */
const SJSU_APP_HOST = /^(?!www\.)(?:[\w-]+\.)+sjsu\.edu$/i;

/**
 * Where a job description says to apply: the first https link after "to apply" in its text, else the first of its
 * clickable links on an application-form host. Null when it names none, so the description stays the link.
 */
export function applicationLink(text: string, links: string[] = []): string | null {
  const ok = (raw: string, campus = true) => {
    try {
      const u = new URL(raw.replace(/[).,;]+$/, ""));
      if (u.protocol !== "https:" || !(FORM_HOST.test(u.hostname) || (campus && SJSU_APP_HOST.test(u.hostname)))) return null;
      if (u.hostname === "docs.google.com" && !/^\/forms\//.test(u.pathname)) return null;
      return u.toString();
    } catch {
      return null;
    }
  };
  const at = text.search(/\bto apply\b|\bhow to apply\b|\bapply (?:here|online|at|by)\b/i);
  if (at >= 0) for (const m of text.slice(at, at + 700).matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const u = ok(m[0]);
    if (u) return u;
  }
  // Among clickable links a real form host wins over a campus subdomain.
  return links.map((l) => ok(l, false)).find(Boolean) ?? links.map((l) => ok(l)).find(Boolean) ?? null;
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

// Aggregators (adzuna) are not per-company feeds: they run through the provider pipeline in agent.ts.
export const ADAPTERS: Partial<Record<SourceKind, (c: CompanyFeed) => Promise<RawPosting[]>>> = {
  usajobs,
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  pinpoint,
  sjsu_page: sjsuPage,
};
