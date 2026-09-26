import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";

const Create = z.object({
  applicationId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }),
  kind: z.enum(["interview", "phone screen", "technical", "onsite", "assessment", "other"]).default("interview"),
  location: z.string().max(300).nullish(),
  notes: z.string().max(5000).nullish(),
});

/** GET /api/interviews — upcoming interviews (?from=ISO&to=ISO for a calendar range). */
export const GET = withUser(async ({ db, user, req }) => {
  const sp = new URL(req.url).searchParams;
  let q = db.from("interviews").select("*, applications!interviews_parent_owner_fk(id, company_name, job_title, status)").eq("user_id", user.id).order("scheduled_at");
  if (sp.get("from")) q = q.gte("scheduled_at", sp.get("from")!);
  if (sp.get("to")) q = q.lte("scheduled_at", sp.get("to")!);
  const { data, error } = await q;
  if (error) throw error;
  return ok({ interviews: data });
});

/** POST /api/interviews — log an interview; moves the application to "interview" if it was earlier in the pipeline. */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Create);
  const { data: app } = await db.from("applications").select("id, status").eq("id", input.applicationId).eq("user_id", user.id).maybeSingle();
  if (!app) throw new HttpError(404, "Application not found");
  const { data, error } = await db
    .from("interviews")
    .insert({ application_id: app.id, user_id: user.id, scheduled_at: input.scheduledAt, kind: input.kind, location: input.location ?? null, notes: input.notes ?? null })
    .select("*")
    .single();
  if (error) throw error;
  const early = ["saved", "preparing", "ready", "applied", "assessment"].includes(app.status);
  await db.from("applications").update({ interview_at: input.scheduledAt, ...(early && input.kind !== "assessment" ? { status: "interview" } : {}) }).eq("id", app.id);
  if (early && input.kind !== "assessment") {
    await db.from("application_events").insert({ application_id: app.id, user_id: user.id, kind: "status", from_status: app.status, to_status: "interview", note: "Interview scheduled" });
  }
  return ok({ interview: data }, { status: 201 });
});

/** DELETE /api/interviews?id=… */
export const DELETE = withUser(async ({ db, user, req }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id is required");
  const { error } = await db.from("interviews").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  return ok({ deleted: true });
});
