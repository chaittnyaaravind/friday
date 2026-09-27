import { HttpError, ok, withUser } from "@/lib/api";
import { invalidFilterParams, parseFilters, searchJobs } from "@/lib/data/jobs";

/**
 * GET /api/jobs/search — the one search API for every source FRIDAY indexes (employers, SJSU pages, Adzuna, imports).
 *
 *   q            keyword                          sort        match | new | distance | deadline | relevance
 *   type         internship,co_op,full_time,…     level       new_grad,entry
 *   internshipsOnly=true                          remote=1    hybrid=1    saved=1
 *   miles | radius   distance from your location  posted | postedWithin=24h|3d|7d|30d
 *   source | provider  e.g. adzuna, greenhouse    limit (≤100) + offset | page
 *
 * Your location and radius come from your profile. An unusable value is a 400 naming the parameter.
 */
export const GET = withUser(async ({ db, req }) => {
  const sp = new URL(req.url).searchParams;
  const bad = invalidFilterParams(sp);
  if (bad.length) throw new HttpError(400, `Invalid parameter${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}`);
  const f = parseFilters(sp);
  return ok(await searchJobs(db, { ...f, sort: f.sort ?? (f.q ? "relevance" : "match") }));
});
