/**
 * Job queries shared by server pages and /api/jobs/* route handlers.
 * All reads go through the signed-in user's client, so RLS scopes matches/saves.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gap, Reason } from "@/lib/domain/match";

export type JobListItem = {
  id: string;
  title: string;
  department: string | null;
  employment_type: "internship" | "on_campus" | "part_time" | "full_time" | "research" | "co_op";
  category: string | null;
  is_on_campus: boolean;
  location_text: string | null;
  city: string | null;
  is_remote: boolean;
  is_hybrid: boolean;
  pay_text: string | null;
  hours_text: string | null;
  work_study: "required" | "eligible" | "not_required" | "unknown";
  deadline: string | null;
  posted_at: string | null;
  discovered_at: string;
  last_verified_at: string;
  apply_url: string;
  auth_restricted: boolean;
  company_slug: string;
  company_name: string;
  company_domain: string | null;
  company_industry: string | null;
  score: number | null;
  strong: Reason[] | null;
  missing: Gap[] | null;
  difficulty: "low" | "medium" | "high" | null;
  distance_miles: number | null;
  saved: boolean;
  sources: { source: string; name: string; url: string; official: boolean }[];
  total_count: number;
};

export type JobFilters = {
  q?: string;
  types?: JobListItem["employment_type"][];
  categories?: string[];
  onCampus?: boolean;
  maxMiles?: number;
  includeRemote?: boolean;
  remoteOnly?: boolean;
  hybridOnly?: boolean;
  companies?: string[];
  industries?: string[];
  sources?: string[];
  postedWithinDays?: number;
  deadlineWithinDays?: number;
  skills?: string[];
  hideAuthRestricted?: boolean;
  savedOnly?: boolean;
  sort?: "match" | "new" | "distance" | "deadline" | "relevance";
  limit?: number;
  offset?: number;
};

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const bool = (v: string | null) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : undefined);
const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);

/** Parse URL search params (page URLs and /api/jobs query strings share one format). */
export function parseFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): JobFilters {
  const get = (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k);
    const v = sp[k];
    return Array.isArray(v) ? v.join(",") : v ?? null;
  };
  return {
    q: get("q") ?? undefined,
    types: list(get("type")) as JobFilters["types"],
    categories: list(get("category")),
    onCampus: bool(get("campus")),
    maxMiles: num(get("miles")),
    includeRemote: bool(get("includeRemote")) ?? true,
    remoteOnly: bool(get("remote")),
    hybridOnly: bool(get("hybrid")),
    companies: list(get("company")),
    industries: list(get("industry")),
    sources: list(get("source")),
    postedWithinDays: num(get("posted")),
    deadlineWithinDays: num(get("deadline")),
    skills: list(get("skills")),
    hideAuthRestricted: bool(get("hideRestricted")),
    savedOnly: bool(get("saved")),
    sort: (get("sort") as JobFilters["sort"]) ?? undefined,
    limit: num(get("limit")),
    offset: num(get("offset")),
  };
}

export async function searchJobs(db: SupabaseClient, f: JobFilters) {
  const days = (d?: number) => (d ? new Date(Date.now() - d * 86_400_000).toISOString() : null);
  const until = (d?: number) => (d ? new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10) : null);
  const { data, error } = await db.rpc("search_jobs", {
    p_q: f.q || null,
    p_types: f.types?.length ? f.types : null,
    p_categories: f.categories?.length ? f.categories : null,
    p_on_campus: f.onCampus ?? null,
    p_max_miles: f.maxMiles ?? null,
    p_include_remote: f.includeRemote ?? true,
    p_remote_only: f.remoteOnly ?? false,
    p_hybrid_only: f.hybridOnly ?? false,
    p_company_slugs: f.companies?.length ? f.companies : null,
    p_industries: f.industries?.length ? f.industries : null,
    p_sources: f.sources?.length ? f.sources : null,
    p_posted_after: days(f.postedWithinDays),
    p_deadline_before: until(f.deadlineWithinDays),
    p_skills: f.skills?.length ? f.skills : null,
    p_hide_auth_restricted: f.hideAuthRestricted ?? false,
    p_saved_only: f.savedOnly ?? false,
    p_sort: f.sort === "new" ? "new" : f.sort ?? (f.q ? "relevance" : "match"),
    p_limit: f.limit ?? 30,
    p_offset: f.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as JobListItem[];
  return { jobs: rows, total: rows[0]?.total_count ?? 0 };
}

export type JobDetail = Awaited<ReturnType<typeof getJob>>;

export async function getJob(db: SupabaseClient, id: string, userId: string) {
  const { data: job, error } = await db
    .from("jobs")
    .select(
      "*, companies(id, slug, name, domain, industry, hq_city, careers_url, is_sjsu), job_sources(source, source_name, url, is_official, first_seen_at, last_seen_at), job_requirements(label, kind, skills(slug, name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const [{ data: match }, { data: saved }, { data: application }] = await Promise.all([
    db.from("job_matches").select("score, strong, missing, difficulty, distance_miles, computed_at").eq("job_id", id).eq("user_id", userId).maybeSingle(),
    db.from("saved_jobs").select("job_id").eq("job_id", id).eq("user_id", userId).maybeSingle(),
    db.from("applications").select("id, status").eq("job_id", id).eq("user_id", userId).maybeSingle(),
  ]);
  return { job, match, saved: Boolean(saved), application };
}
