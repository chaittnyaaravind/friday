import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";

/** GET /api/notifications — latest alerts and the unread count. */
export const GET = withUser(async ({ db, user }) => {
  const [{ data, error }, { count }] = await Promise.all([
    db.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);
  if (error) throw error;
  return ok({ notifications: data, unread: count ?? 0 });
});

/** PATCH /api/notifications — mark some ({ ids }) or all ({ all: true }) as read. */
export const PATCH = withUser(async ({ db, user, req }) => {
  const { ids, all } = await body(req, z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() }));
  let q = db.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if (!all) q = q.in("id", ids?.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { error } = await q;
  if (error) throw error;
  return ok({ ok: true });
});
