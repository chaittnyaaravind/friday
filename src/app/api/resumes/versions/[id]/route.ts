import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { loadProfileItems } from "@/lib/resume/profile";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

const origin = z.enum(["profile", "user", "ai"]);
const line = z.object({ id: z.string().max(40), text: z.string().max(2000), origin, sourceItemId: z.string().max(60).nullable() });
const DocSchema = z.object({
  version: z.literal(1),
  header: z.object({ name: z.string().max(200), contact: z.array(z.string().max(300)).max(12), origin }),
  sections: z.array(z.object({
    id: z.string().max(40),
    kind: z.enum(["summary", "education", "experience", "projects", "skills", "certifications", "awards", "coursework", "activities"]),
    title: z.string().max(80),
    entries: z.array(z.object({ id: z.string().max(40), sourceItemId: z.string().max(60).nullable(), heading: z.string().max(300), subheading: z.string().max(400), meta: z.string().max(120), origin, bullets: z.array(line).max(30) })).max(40),
    lines: z.array(line).max(60),
  })).max(20),
});

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

/** PATCH /api/resumes/versions/:id — autosave edits or rename. Returns fresh verification. */
export const PATCH = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, z.object({ content: DocSchema.optional(), label: z.string().trim().min(1).max(120).optional() }));
  const v = await load(db, user.id, id);
  if (v.kind === "legacy") throw new HttpError(409, "Legacy drafts are read-only. Build a new version from your profile instead.");
  const update: Record<string, unknown> = {};
  if (input.content) update.content = input.content;
  if (input.label) update.label = input.label;
  const { data, error } = await db.from("resume_versions").update(update).eq("id", id).eq("user_id", user.id).select("id, label, updated_at").single();
  if (error) throw error;
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
    .insert({ user_id: user.id, label: action === "restore" ? `${v.label} (restored)` : `${v.label} (copy)`, kind: "copy", content: v.content, job_id: v.job_id, source_version_id: v.id })
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
