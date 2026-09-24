import { ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

/** GET /api/jobs/on-campus — SJSU on-campus jobs, newest first. */
export const GET = withUser(async ({ db, req }) => {
  const f = parseFilters(new URL(req.url).searchParams);
  return ok(await searchJobs(db, { ...f, onCampus: true, sort: f.sort ?? "new" }));
});
