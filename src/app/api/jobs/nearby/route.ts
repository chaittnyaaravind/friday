import { ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

/**
 * GET /api/jobs/nearby — "Opportunities Around Me". Distance is computed server-side
 * from the user's saved origin (default: SJSU); their location is never sent to employers.
 */
export const GET = withUser(async ({ db, req, user }) => {
  const f = parseFilters(new URL(req.url).searchParams);
  let miles = f.maxMiles;
  if (miles == null) {
    const { data } = await db.from("profiles").select("radius_miles").eq("id", user.id).single();
    miles = data?.radius_miles ?? 25;
  }
  return ok(await searchJobs(db, { ...f, maxMiles: miles, includeRemote: f.includeRemote ?? false, sort: f.sort ?? "distance" }));
});
