import { ok, withUser } from "@/lib/api";

/** POST /api/candidate/review — you've reviewed what FRIDAY extracted. Unconfirmed items stay excluded. */
export const POST = withUser(async ({ db, user }) => {
  const { count } = await db.from("candidate_items").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "requires_confirmation");
  const { error } = await db.from("profiles").update({ resume_reviewed_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw error;
  return ok({ reviewed: true, stillUnconfirmed: count ?? 0 });
});
