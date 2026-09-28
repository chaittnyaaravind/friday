import { HttpError, ok, withUser } from "@/lib/api";

/**
 * POST   /api/resumes/versions/:id/master — make this resume (built from your profile) your master.
 * DELETE /api/resumes/versions/:id/master — stop using a master.
 * Only a flag changes: no resume's content is edited and nothing is deleted. Runs as one atomic database function.
 */
export const POST = withUser<{ id: string }>(async ({ db }, { id }) => {
  const { error } = await db.rpc("set_master_resume", { p_version: id });
  if (error) {
    if (error.code === "P0002") throw new HttpError(404, "Resume not found");
    if (error.code === "P0001") throw new HttpError(400, error.message);
    throw error;
  }
  return ok({ master: id });
});

export const DELETE = withUser<{ id: string }>(async ({ db }) => {
  const { error } = await db.rpc("clear_master_resume");
  if (error) throw error;
  return ok({ master: null });
});
