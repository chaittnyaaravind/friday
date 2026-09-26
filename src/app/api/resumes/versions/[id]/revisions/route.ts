import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { assertAiLinesSigned } from "@/lib/ai/sign";
import { DocSchema, TraceSchema } from "@/lib/resume/doc-schema";
import { hasChanged, type Revision } from "@/lib/resume/history";
import { loadProfileItems } from "@/lib/resume/profile";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

const COLUMNS = "id, version_id, label, source, content, trace, created_at";
const LIMIT = 60;

async function loadVersion(db: SupabaseClient, userId: string, id: string) {
  const { data } = await db.from("resume_versions").select("id, kind, content, label, job_id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "Resume version not found");
  if (data.kind === "legacy") throw new HttpError(409, "Legacy drafts have no history.");
  return data as { id: string; kind: string; content: ResumeDoc; label: string; job_id: string | null };
}

async function list(db: SupabaseClient, userId: string, id: string) {
  const { data, error } = await db.from("resume_revisions").select(COLUMNS).eq("version_id", id).eq("user_id", userId).order("created_at", { ascending: false }).limit(LIMIT);
  if (error) throw error;
  return (data ?? []) as Revision[];
}

async function insert(db: SupabaseClient, userId: string, id: string, row: { label: string; source: Revision["source"]; content: ResumeDoc; trace?: unknown }) {
  const { data, error } = await db.from("resume_revisions").insert({ version_id: id, user_id: userId, label: row.label, source: row.source, content: row.content, trace: row.trace ?? null }).select(COLUMNS).single();
  if (error) throw error;
  return data as Revision;
}

/** GET — the version's history, newest first. The first read of an older version records its "Original" state. */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const version = await loadVersion(db, user.id, id);
  let revisions = await list(db, user.id, id);
  if (!revisions.length) {
    await insert(db, user.id, id, { label: "Original resume", source: "original", content: version.content });
    revisions = await list(db, user.id, id);
  }
  return ok({ revisions });
});

const Add = z.object({
  action: z.literal("add").optional(),
  label: z.string().trim().min(1).max(120),
  source: z.enum(["ai", "user", "checkpoint"]),
  content: DocSchema,
  trace: TraceSchema.optional(),
});
const Restore = z.object({ action: z.literal("restore"), revisionId: z.string().uuid() });
const Duplicate = z.object({ action: z.literal("duplicate"), revisionId: z.string().uuid() });

/**
 * POST — append a revision, or restore an earlier one.
 *   add      records the given document (skipped if it equals the latest revision)
 *   restore  saves the current state first if it isn't already recorded, then writes the old
 *            content back as a NEW revision and makes it current — nothing is ever overwritten
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  const input = await body(req, z.union([Restore, Duplicate, Add]));
  const version = await loadVersion(db, user.id, id);
  const latest = (await list(db, user.id, id))[0];

  if (input.action === "duplicate") {
    const { data: source } = await db.from("resume_revisions").select(COLUMNS).eq("id", input.revisionId).eq("version_id", id).eq("user_id", user.id).maybeSingle();
    if (!source) throw new HttpError(404, "That revision no longer exists.");
    const rev = source as Revision;
    const { data: copy, error } = await db
      .from("resume_versions")
      .insert({ user_id: user.id, label: `${version.label} — from “${rev.label}”`.slice(0, 120), kind: "copy", content: rev.content, job_id: version.job_id, source_version_id: id })
      .select("id, label")
      .single();
    if (error) throw error;
    return ok({ version: copy }, { status: 201 });
  }

  if (input.action === "restore") {
    const { data: target } = await db.from("resume_revisions").select(COLUMNS).eq("id", input.revisionId).eq("version_id", id).eq("user_id", user.id).maybeSingle();
    if (!target) throw new HttpError(404, "That revision no longer exists.");
    const rev = target as Revision;
    if (hasChanged(latest?.content ?? null, version.content)) await insert(db, user.id, id, { label: "Before restore", source: "checkpoint", content: version.content });
    const created = await insert(db, user.id, id, { label: `Restored “${rev.label}”`, source: "restore", content: rev.content, trace: { op: "restore", where: "Whole resume", before: "", after: rev.label } });
    const { data: updated, error } = await db.from("resume_versions").update({ content: rev.content }).eq("id", id).eq("user_id", user.id).select("updated_at").single();
    if (error) throw error;
    const items = await loadProfileItems(db, user.id);
    return ok({ revision: created, content: rev.content, updatedAt: updated.updated_at, verification: validateDoc(rev.content, items) }, { status: 201 });
  }

  // A revision may not smuggle in text labelled AI-written that this server never produced (same rule as saving the document).
  assertAiLinesSigned(input.content as ResumeDoc, user.id, version.content);
  if (latest && !hasChanged(latest.content, input.content as ResumeDoc)) return ok({ revision: latest, unchanged: true });
  // A version that predates history gets its earlier state recorded before the first new revision.
  if (!latest) await insert(db, user.id, id, { label: "Original resume", source: "original", content: version.content });
  const created = await insert(db, user.id, id, { label: input.label, source: input.source, content: input.content as ResumeDoc, trace: input.trace });
  return ok({ revision: created }, { status: 201 });
});
