import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { buildResume } from "@/lib/resume/generate";
import { loadProfileItems } from "@/lib/resume/profile";
import { validateDoc } from "@/lib/resume/validate";

/** GET /api/resumes/versions — every resume version (the original upload is kept separately). */
export const GET = withUser(async ({ db, user }) => {
  const { data, error } = await db
    .from("resume_versions")
    .select("id, label, kind, job_id, source_version_id, created_at, updated_at, jobs(title, companies(name))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ok({ versions: data });
});

/**
 * POST /api/resumes/versions — generate a resume from your CONFIRMED profile (no AI).
 * Items that still need confirmation are left out and counted back to you.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const { label } = await body(req, z.object({ label: z.string().trim().min(1).max(120).optional() }));
  const items = await loadProfileItems(db, user.id);
  if (!items.length) throw new HttpError(400, "Upload a resume or add profile details first.");
  const doc = buildResume(items);
  const check = validateDoc(doc, items);
  if (!check.ok) throw new HttpError(422, `Generated resume failed verification: ${check.issues[0].claim}`);
  const { count } = await db.from("resume_versions").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("kind", "legacy");
  const { data: version, error } = await db
    .from("resume_versions")
    .insert({ user_id: user.id, label: label ?? `Resume v${(count ?? 0) + 1}`, kind: "base", content: doc })
    .select("id, label")
    .single();
  if (error) throw error;
  const leftOut = items.filter((i) => i.status === "requires_confirmation").length;
  return ok({ version, leftOut }, { status: 201 });
});
