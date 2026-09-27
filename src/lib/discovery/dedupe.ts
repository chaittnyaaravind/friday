/**
 * Cross-provider deduplication. The same opening arrives from an employer's own feed, from an aggregator, and from a
 * student's import; they must become ONE listing with several sources. Matching combines the employer, the location
 * and the title — never the title alone — plus canonical URLs.
 */

// ── employers ──────────────────────────────────────────────────────────────────────────────────

const LEGAL_FORMS = /\b(?:incorporated|inc|llc|l l c|ltd|limited|corp|corporation|co|company|gmbh|plc|lp|llp|pbc)\b/g;

/** "NVIDIA Corporation", "Stripe, Inc." and "nvidia" → "nvidia" / "stripe". */
export function normalizeCompany(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A stable slug for an employer, derived from its normalized name. */
export const companySlug = (name: string) => normalizeCompany(name).replace(/\s+/g, "-");

// ── titles ─────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(["a", "an", "the", "and", "for", "of", "to", "in", "at", "with", "on", "or"]);
const SYNONYM: Record<string, string> = { internship: "intern", interns: "intern", internships: "intern", engineering: "engineer", engineers: "engineer", developer: "engineer", developers: "engineer", swe: "software engineer", sde: "software engineer", coop: "intern", "co-op": "intern" };
/** Tokens that make two otherwise-similar titles different jobs (seniority, level, degree). */
const DISTINGUISHING = new Set(["senior", "sr", "staff", "principal", "lead", "manager", "director", "head", "ii", "iii", "iv", "v", "phd", "masters", "junior", "associate"]);

export function titleTokens(title: string, company?: string): string[] {
  const companyWords = new Set(normalizeCompany(company).split(" ").filter(Boolean));
  const t = title
    .toLowerCase()
    .replace(/\((?:[^)]*)\)/g, " ") // "(Summer 2027)", "(Remote)"
    .replace(/\b(?:req|job)\s*#?\s*[\w-]*\d[\w-]*/g, " ")
    .replace(/\b(?:summer|fall|spring|winter)\b|\b20\d\d\b/g, " ") // the same role posted for different seasons is one listing
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9+# ]+/g, " ");
  const out = new Set<string>();
  for (const raw of t.split(/\s+/).filter(Boolean)) {
    for (const w of (SYNONYM[raw] ?? raw).split(" ")) {
      if (!STOP.has(w) && !companyWords.has(w)) out.add(w);
    }
  }
  return [...out];
}

/** Jaccard similarity of two titles' token sets, 0–1. Different seniority/level tokens force 0. */
export function titleSimilarity(a: string, b: string, company?: string): number {
  const A = new Set(titleTokens(a, company));
  const B = new Set(titleTokens(b, company));
  if (!A.size || !B.size) return 0;
  for (const w of DISTINGUISHING) if (A.has(w) !== B.has(w)) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// ── URLs ───────────────────────────────────────────────────────────────────────────────────────

const TRACKING = /^(?:utm_.*|ref|refid|ref_src|trk|trackingid|tracking_id|src|source|fbclid|gclid|msclkid|mc_.*|lever-source|lever-origin|gh_src|adref|sid)$/i;

/** A comparison form of a job address: no tracking parameters, fragment, "www." or trailing slash. */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${q}`;
  } catch {
    return null;
  }
}

// ── the decision ───────────────────────────────────────────────────────────────────────────────

export type JobKey = { company: string; title: string; city: string | null; remote: boolean; url?: string | null };

const cityKey = (c: string | null) => (c ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** Is this the same opening? URL equality, or same employer + compatible location + near-identical title. */
export function isSameJob(a: JobKey, b: JobKey, threshold = 0.8): boolean {
  const ua = canonicalUrl(a.url);
  const ub = canonicalUrl(b.url);
  if (ua && ub && ua === ub) return true;

  if (normalizeCompany(a.company) !== normalizeCompany(b.company) || !normalizeCompany(a.company)) return false;
  const ca = cityKey(a.city);
  const cb = cityKey(b.city);
  const sameWhere = (ca && cb && ca === cb) || (a.remote && b.remote);
  if (!sameWhere) return false; // never merge on the title alone, or when a location is unknown
  return titleSimilarity(a.title, b.title, a.company) >= threshold;
}

/** The best already-known job that `candidate` duplicates, if any. */
export function findDuplicate<T extends JobKey>(candidate: JobKey, known: T[], threshold = 0.8): T | null {
  let best: { job: T; score: number } | null = null;
  for (const k of known) {
    if (!isSameJob(candidate, k, threshold)) continue;
    const score = canonicalUrl(candidate.url) && canonicalUrl(candidate.url) === canonicalUrl(k.url) ? 2 : titleSimilarity(candidate.title, k.title, candidate.company);
    if (!best || score > best.score) best = { job: k, score };
  }
  return best?.job ?? null;
}
