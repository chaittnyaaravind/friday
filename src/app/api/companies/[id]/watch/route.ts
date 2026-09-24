import { ok, withUser } from "@/lib/api";

/** POST /api/companies/:id/watch — follow a company (its new roles raise alerts). DELETE unfollows. */
export const POST = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { error } = await db.from("company_watchlists").upsert({ user_id: user.id, company_id: id }, { onConflict: "user_id,company_id", ignoreDuplicates: true });
  if (error) throw error;
  return ok({ following: true });
});

export const DELETE = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { error } = await db.from("company_watchlists").delete().eq("user_id", user.id).eq("company_id", id);
  if (error) throw error;
  return ok({ following: false });
});
