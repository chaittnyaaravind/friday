import { ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

/** GET /api/jobs — the ranked opportunity feed. Accepts every search filter as query params. */
export const GET = withUser(async ({ db, req }) => {
  const filters = parseFilters(new URL(req.url).searchParams);
  return ok(await searchJobs(db, filters));
});
