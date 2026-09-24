import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { analyzeJob } from "@/lib/ai/tasks";
import { rematchAll, skillIdMap } from "@/lib/discovery/agent";
import { resolveSkill, skillBySlug } from "@/lib/domain/skills";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/agent/analyze-job — Claude reads the full posting and refines its
 * requirements (required vs preferred), replacing the keyword-based extraction.
 * Requirements that don't map to a known skill are kept as plain labels.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const { jobId } = await body(req, z.object({ jobId: z.string().uuid() }));
  const { data: job } = await db.from("jobs").select("id, title, description, companies(name)").eq("id", jobId).maybeSingle();
  if (!job) throw new HttpError(404, "Opportunity not found");
  if (!job.description || job.description.length < 120) throw new HttpError(422, "This listing has no full description to analyze.");

  const analysis = await analyzeJob(job.title, (job.companies as unknown as { name: string } | null)?.name ?? "", job.description);

  const admin = createSupabaseAdmin();
  const ids = await skillIdMap(admin);
  const rows = new Map<string, { job_id: string; skill_id: number | null; label: string; kind: "required" | "preferred" }>();
  for (const [kind, list] of [["required", analysis.required], ["preferred", analysis.preferred]] as const) {
    for (const raw of list) {
      const slug = resolveSkill(raw);
      const label = slug ? skillBySlug(slug)!.name : raw.trim().slice(0, 80);
      if (!label || rows.has(label)) continue;
      rows.set(label, { job_id: job.id, skill_id: slug ? ids.get(slug) ?? null : null, label, kind });
    }
  }
  await admin.from("job_requirements").delete().eq("job_id", job.id);
  if (rows.size) {
    const { error } = await admin.from("job_requirements").insert([...rows.values()]);
    if (error) throw error;
  }
  await admin.from("jobs").update({ requirements_extracted_at: new Date().toISOString() }).eq("id", job.id);
  await rematchAll(db, { userId: user.id });
  return ok({ analysis, requirements: [...rows.values()].map(({ label, kind }) => ({ label, kind })) });
});
