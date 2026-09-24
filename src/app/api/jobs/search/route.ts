import { ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

/** GET /api/jobs/search?q=… — keyword search, ranked by text relevance unless `sort` is given. */
export const GET = withUser(async ({ db, req }) => {
  const f = parseFilters(new URL(req.url).searchParams);
  return ok(await searchJobs(db, { ...f, sort: f.sort ?? (f.q ? "relevance" : "match") }));
});
