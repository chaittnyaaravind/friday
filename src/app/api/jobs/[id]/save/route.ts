import { ok, withUser } from "@/lib/api";

/** POST /api/jobs/:id/save — save an opportunity (idempotent). DELETE removes it. */
export const POST = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { error } = await db.from("saved_jobs").upsert({ user_id: user.id, job_id: id }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
  if (error) throw error;
  return ok({ saved: true });
});

export const DELETE = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { error } = await db.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", id);
  if (error) throw error;
  return ok({ saved: false });
});
