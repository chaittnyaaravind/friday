import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { assertAiLinesSigned } from "@/lib/ai/sign";
import { DocSchema, TemplateSchema } from "@/lib/resume/doc-schema";
import { loadProfileItems } from "@/lib/resume/profile";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

async function load(db: SupabaseClient, userId: string, id: string) {
  const { data } = await db.from("resume_versions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "Resume version not found");
  return data;
}

/** GET /api/resumes/versions/:id — the document plus its verification result. */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const v = await load(db, user.id, id);
  if (v.kind === "legacy") return ok({ version: v, verification: null });
  const items = await loadProfileItems(db, user.id);
  return ok({ version: v, verification: validateDoc(v.content as ResumeDoc, items) });
});

/**
 * PATCH /api/resumes/versions/:id — autosave edits, rename, or set the template. Returns fresh verification.
 *  - AI-labelled lines must carry the server's signature (see lib/ai/sign) or the save is rejected with 422.
 *  - `baseUpdatedAt` makes a content save compare-and-set: it applies only if the row is still at that version, otherwise
 *    409. That stops a stale save (an older request arriving late, or another tab) from silently overwriting newer edits.
 */
export const PATCH = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, z.object({ content: DocSchema.optional(), label: z.string().trim().min(1).max(120).optional(), template: TemplateSchema.optional(), baseUpdatedAt: z.string().max(64).optional() }));
  const v = await load(db, user.id, id);
  if (v.kind === "legacy") throw new HttpError(409, "Legacy drafts are read-only. Build a new version from your profile instead.");
  const update: Record<string, unknown> = {};
  if (input.content) {
    assertAiLinesSigned(input.content as ResumeDoc, user.id, v.content as ResumeDoc);
    update.content = input.content;
  }
  if (input.label) update.label = input.label;
  if (input.template) update.template = input.template; // presentation only — content is untouched
  let q = db.from("resume_versions").update(update).eq("id", id).eq("user_id", user.id);
  if (input.content && input.baseUpdatedAt) q = q.eq("updated_at", input.baseUpdatedAt);
  const { data, error } = await q.select("id, label, updated_at").maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "This resume was changed somewhere else — another tab, or an older save arriving late. Reload to see the latest version.");
  const items = await loadProfileItems(db, user.id);
  return ok({ version: data, verification: validateDoc((input.content ?? v.content) as ResumeDoc, items) });
});

/** POST /api/resumes/versions/:id — { action: "duplicate" | "restore" } creates a new copy; the source is never overwritten. */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const { action } = await body(req, z.object({ action: z.enum(["duplicate", "restore"]) }));
  const v = await load(db, user.id, id);
  if (v.kind === "legacy") throw new HttpError(409, "Legacy drafts can't be copied.");
  const { data, error } = await db
    .from("resume_versions")
    .insert({ user_id: user.id, label: action === "restore" ? `${v.label} (restored)` : `${v.label} (copy)`, kind: "copy", content: v.content, job_id: v.job_id, source_version_id: v.id, ...(v.template ? { template: v.template } : {}) })
    .select("id, label")
    .single();
  if (error) throw error;
  return ok({ version: data }, { status: 201 });
});

/** DELETE /api/resumes/versions/:id — delete a version (your uploaded original is never touched). */
export const DELETE = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  await load(db, user.id, id);
  const { error } = await db.from("resume_versions").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw error;
  return ok({ deleted: true });
});
