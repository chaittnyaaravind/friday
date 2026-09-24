import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { STATUS_ORDER } from "@/lib/format";

const Patch = z.object({
  status: z.enum(STATUS_ORDER).optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  applied_at: z.string().datetime({ offset: true }).nullish(),
  application_url: z.string().url().nullish(),
  resume_version_id: z.string().uuid().nullish(),
  cover_letter: z.string().max(20_000).nullish(),
  contact_name: z.string().max(120).nullish(),
  contact_email: z.string().email().max(200).nullish().or(z.literal("").transform(() => null)),
  interview_at: z.string().datetime({ offset: true }).nullish(),
  follow_up_at: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().max(20_000).nullish(),
  location: z.string().max(200).nullish(),
});

/** GET /api/applications/:id — one application with its timeline, follow-ups and interviews. */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { data, error } = await db
    .from("applications")
    .select("*, application_events(*), follow_ups(*), interviews(*), resume_versions(id, label, created_at), jobs(id, title, deadline, status, apply_url)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Application not found");
  return ok({ application: data });
});

/**
 * PATCH /api/applications/:id — update fields or move between columns. Every status
 * change is recorded. Marking "applied" is always the user's action — FRIDAY never
 * marks an application submitted on its own.
 */
export const PATCH = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const patch = await body(req, Patch);
  const { data: current } = await db.from("applications").select("id, status, applied_at, follow_up_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!current) throw new HttpError(404, "Application not found");

  const update: Record<string, unknown> = { ...patch };
  const moving = patch.status && patch.status !== current.status;
  if (moving && patch.status === "applied" && !current.applied_at && patch.applied_at === undefined) update.applied_at = new Date().toISOString();

  const { data: app, error } = await db.from("applications").update(update).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) throw error;

  if (moving) {
    await db.from("application_events").insert({ application_id: id, user_id: user.id, kind: "status", from_status: current.status, to_status: patch.status });
    // First time it's marked applied, suggest a follow-up a week out (editable, dismissible).
    if (patch.status === "applied" && !current.follow_up_at) {
      const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await db.from("follow_ups").insert({ application_id: id, user_id: user.id, due_at: due, note: "Check in on your application" });
      await db.from("applications").update({ follow_up_at: due }).eq("id", id);
    }
  } else if (Object.keys(patch).some((k) => k !== "position")) {
    await db.from("application_events").insert({ application_id: id, user_id: user.id, kind: "updated", note: Object.keys(patch).join(", ") });
  }
  return ok({ application: app });
});

/** DELETE /api/applications/:id — stop tracking (the job itself stays in the catalog). */
export const DELETE = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { error } = await db.from("applications").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  return ok({ deleted: true });
});
