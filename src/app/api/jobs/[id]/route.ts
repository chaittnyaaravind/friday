import { HttpError, ok, withUser } from "@/lib/api";
import { getJob } from "@/lib/data/jobs";

/** GET /api/jobs/:id — full opportunity with sources, requirements, your match and application state. */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const detail = await getJob(db, id, user.id);
  if (!detail) throw new HttpError(404, "Opportunity not found");
  return ok(detail);
});
