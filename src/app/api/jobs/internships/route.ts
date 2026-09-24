import { ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

/** GET /api/jobs/internships — internships and co-ops, best match first. */
export const GET = withUser(async ({ db, req }) => {
  const f = parseFilters(new URL(req.url).searchParams);
  return ok(await searchJobs(db, { ...f, types: f.types ?? ["internship", "co_op"], onCampus: false }));
});
