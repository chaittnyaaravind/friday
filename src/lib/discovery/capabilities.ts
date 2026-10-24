/**
 * What FRIDAY can honestly say about each source — one record per source, in code, so it is reviewed and tested.
 * It is mirrored to the `source_capabilities` table by syncCatalog so the UI can read it.
 *
 * Rules this file enforces (see capabilities.test.ts):
 *  - Real-time is a MEASURED property. `realtimeVerifiedAt` stays null until someone measures a source's latency;
 *    nothing in the UI may say "real-time" for a source whose value is null.
 *  - `verifiedOn` is the date a person or script last saw the live source behave as described. null = never
 *    exercised live (e.g. a keyed API with no key configured) — the notes say so.
 *  - A field whose meaning is unverified is not used as a business rule. Workday's `startDate` is the example.
 */
import type { SourceKind } from "./sources";

export type CapabilitySource = SourceKind | "handshake_import" | "linkedin_import" | "indeed_import" | "manual";

export type Provided = "yes" | "no" | "unverified";

export type SourceCapability = {
  source: CapabilitySource;
  access: "public_api" | "public_page" | "keyed_api" | "user_import";
  /** "public_feed": FRIDAY reads the same public data the employer's careers page renders. "import_only": the student brings the listing. */
  automation: "public_feed" | "import_only";
  postedAt: { provided: Provided; field: string | null; note: string };
  /** Minutes between FRIDAY's scheduled checks, as configured (best effort, not a guarantee). null for user imports. */
  configuredPollMinutes: number | null;
  /** When someone measured this source end to end and found its latency low enough to call it real-time. null = never. */
  realtimeVerifiedAt: string | null;
  /** Date the live source was last observed behaving as described here; null if never observed live. */
  verifiedOn: string | null;
  notes: string[];
};

const CHECKED = "2026-09-27"; // live payloads captured into test/fixtures/sources by capture.mjs
const POLL = 180; // GitHub Actions every 3 hours (best effort) — vercel.json adds one daily run

export const CAPABILITIES: SourceCapability[] = [
  {
    source: "greenhouse",
    access: "public_api",
    automation: "public_feed",
    postedAt: { provided: "yes", field: "first_published", note: "Present on 887 of 887 postings observed. `updated_at` is an edit time and is never used as a posting date." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: [
      "`application_deadline` exists in the payload but was null on every posting observed; its non-null format is unverified, so it is not mapped.",
      "Description arrives as HTML-escaped HTML and is decoded before use.",
    ],
  },
  {
    source: "lever",
    access: "public_api",
    automation: "public_feed",
    postedAt: { provided: "yes", field: "createdAt", note: "Epoch milliseconds; present on every posting observed (321 of 321)." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: ["`salaryRange` was absent on all 321 postings observed, so the salary branch of the adapter has never been exercised against live data."],
  },
  {
    source: "ashby",
    access: "public_api",
    automation: "public_feed",
    postedAt: { provided: "yes", field: "publishedAt", note: "ISO-8601 with offset; present on every posting observed." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: ["`compensation.compensationTierSummary` was present and is used as pay text."],
  },
  {
    source: "smartrecruiters",
    access: "public_api",
    automation: "public_feed",
    postedAt: { provided: "yes", field: "releasedDate", note: "ISO-8601 UTC; present on every posting observed." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: ["The list call returns no description; one detail request per student-titled posting is made."],
  },
  {
    source: "workday",
    access: "public_api",
    automation: "public_feed",
    postedAt: {
      provided: "unverified",
      field: "startDate",
      note: "Workday's `startDate` is NOT treated as a posting date: its meaning is unverified (the observed payload shows startDate 2026-05-06 beside \"Posted 30+ Days Ago\", which fits either reading). It is stored raw in source_fields. The list also carries a relative `postedOn` text (\"Posted 30+ Days Ago\"), stored raw, not parsed.",
    },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: [
      "OBSERVED: the list endpoint returns `total` only on the first page (offset 0); pages 2 and later report total 0 while still returning postings. The adapter bounds paging with the first page's total.",
      "Campus mode (SJSU Research Foundation, sjsurf.wd1.myworkdayjobs.com/SJSURF): feed verified working 2026-09-27, but all 5 open postings were staff roles, so none matched. Student-level matching is verified only against that empty result, not against a live student posting.",
    ],
  },
  {
    source: "pinpoint",
    access: "public_api",
    automation: "public_feed",
    postedAt: { provided: "no", field: null, note: "The feed carries no posting date; FRIDAY's own first-seen time is the only recency signal." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: [
      "Verified against ONE employer only: the SJSU Student Union (5 postings). Other Pinpoint employers are unverified.",
      "Each posting carried structured pay (compensation_minimum / _maximum / _frequency, used as pay text) and deadline_at with a UTC offset (the local date is used).",
      "The Student Union tags every posting with a custom field 'Employment Type: Student'. That field is that employer's own; a posting is dropped only when the field is present and is not 'Student'.",
    ],
  },
  {
    source: "sjsu_page",
    access: "public_page",
    automation: "public_feed",
    postedAt: { provided: "no", field: null, note: "Official SJSU hiring pages carry no posting dates; FRIDAY's own first-seen time is the only recency signal." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: CHECKED,
    notes: [
      "HTML is read with a heading/link heuristic, so a page redesign can change what is found. An empty result never closes existing listings (see close-guard.ts).",
      "Pay, hours and deadlines are not on list-style pages; the description is a fixed sentence pointing to the application link.",
      "Verified 2026-09-27: Associated Students and MLK Library list postings; Writing Center, Student Jobs and Tower Foundation list none (Tower says 'No open positions at this time').",
      "Recruitment mode (Peer Connections, Orientation): a posting is produced only when the page says applications are open AND states an upcoming due date. Verified open on Peer Connections and correctly EMPTY on Orientation, whose banner still says 'now OPEN' after its stated close date.",
      "Parking Services (added 2026-10-22): its openings link to job-description PDFs on www.sjsu.edu, which are read (size- and time-limited) for duties and the stated start pay rate; application is by an emailed form, so the apply link is the page.",
      "Checked 2026-10-22 and NOT added: jobs.sjsu.edu (/cw/en-us/rss/, allowed by robots.txt) is CSU-wide; its 275 San José postings were all staff, faculty or management, with no student-assistant roles. EOP, Student Leadership Ambassadors and the School of Management had no openings or point to Handshake.",
      "Not read: University Housing (unreachable from FRIDAY when checked) and the Bookstore (separate application system). Spartan Eats is dining work, which FRIDAY excludes by rule (exclusions.ts).",
    ],
  },
  {
    source: "usajobs",
    access: "keyed_api",
    automation: "public_feed",
    postedAt: { provided: "unverified", field: "PublicationStartDate", note: "Documented by the USAJOBS API; not exercised live from FRIDAY (no API key configured), so unverified here." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: null,
    notes: ["Skipped, never faked, when USAJOBS_API_KEY / USAJOBS_USER_AGENT are unset."],
  },
  {
    source: "adzuna",
    access: "keyed_api",
    automation: "public_feed",
    postedAt: { provided: "unverified", field: "created", note: "Aggregator date; not exercised live from FRIDAY (no API key configured), so unverified here." },
    configuredPollMinutes: POLL,
    realtimeVerifiedAt: null,
    verifiedOn: null,
    notes: ["Aggregator listings are never the employer's own and never overwrite an employer's listing. Skipped, never faked, when unconfigured."],
  },
  ...(["handshake_import", "linkedin_import", "indeed_import", "manual"] as const).map(
    (source): SourceCapability => ({
      source,
      access: "user_import",
      automation: "import_only",
      postedAt: { provided: "no", field: null, note: "The student brings the listing; FRIDAY records when it was imported, not when the employer posted it." },
      configuredPollMinutes: null,
      realtimeVerifiedAt: null,
      verifiedOn: null,
      notes: ["FRIDAY never signs in to or fetches this site. Imports are private to the student who made them."],
    }),
  ),
];

export const capabilityOf = (source: string) => CAPABILITIES.find((c) => c.source === source) ?? null;

/** Rows for the `source_capabilities` table. */
export const capabilityRows = () =>
  CAPABILITIES.map((c) => ({
    source: c.source,
    access: c.access,
    automation: c.automation,
    posted_at_provided: c.postedAt.provided,
    posted_at_field: c.postedAt.field,
    posted_at_note: c.postedAt.note,
    configured_poll_minutes: c.configuredPollMinutes,
    realtime_verified_at: c.realtimeVerifiedAt,
    verified_on: c.verifiedOn,
    notes: c.notes,
  }));

/** "Checked about every 3h — not real-time": how often FRIDAY looks, without implying a live feed. */
export function cadenceLabel(minutes: number | null): string {
  if (minutes == null) return "Checked on a schedule — not real-time";
  return `Checked about every ${minutes >= 60 ? `${minutes / 60}h` : `${minutes} min`} — not real-time`;
}

/** The only honest way to describe a source's speed in the UI. */
export function pollingLabel(source: string): string {
  const c = capabilityOf(source);
  if (!c || c.configuredPollMinutes == null) return "Added by you";
  return c.realtimeVerifiedAt ? `Real-time (verified ${c.realtimeVerifiedAt.slice(0, 10)})` : cadenceLabel(c.configuredPollMinutes);
}
