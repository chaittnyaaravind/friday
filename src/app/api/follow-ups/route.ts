import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";

const Create = z.object({ applicationId: z.string().uuid(), dueAt: z.string().datetime({ offset: true }), note: z.string().max(500).nullish() });
const Update = z.object({ id: z.string().uuid(), done: z.boolean().optional(), dueAt: z.string().datetime({ offset: true }).optional(), note: z.string().max(500).nullish() });

/** GET /api/follow-ups — open follow-ups, soonest first (?all=1 includes completed). */
export const GET = withUser(async ({ db, user, req }) => {
  const all = new URL(req.url).searchParams.get("all") === "1";
  let q = db.from("follow_ups").select("*, applications!follow_ups_parent_owner_fk(id, company_name, job_title, status)").eq("user_id", user.id).order("due_at");
  if (!all) q = q.is("done_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return ok({ followUps: data });
});

/** POST /api/follow-ups — schedule a follow-up for an application. */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Create);
  const { data: app } = await db.from("applications").select("id").eq("id", input.applicationId).eq("user_id", user.id).maybeSingle();
  if (!app) throw new HttpError(404, "Application not found");
  const { data, error } = await db
    .from("follow_ups")
    .insert({ application_id: app.id, user_id: user.id, due_at: input.dueAt, note: input.note ?? null })
    .select("*")
    .single();
  if (error) throw error;
  await db.from("applications").update({ follow_up_at: input.dueAt }).eq("id", app.id);
  return ok({ followUp: data }, { status: 201 });
});

/** PATCH /api/follow-ups — complete, reschedule or edit a follow-up. */
export const PATCH = withUser(async ({ db, user, req }) => {
  const { id, done, dueAt, note } = await body(req, Update);
  const update: Record<string, unknown> = {};
  if (done !== undefined) update.done_at = done ? new Date().toISOString() : null;
  if (dueAt) update.due_at = dueAt;
  if (note !== undefined) update.note = note;
  const { data, error } = await db.from("follow_ups").update(update).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) throw error;
  return ok({ followUp: data });
});
