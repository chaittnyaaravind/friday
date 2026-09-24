import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { parseResume, ParsedResume, tailorResume } from "@/lib/ai/tasks";
import { extractSkills } from "@/lib/domain/skills";

const Input = z.object({ jobId: z.string().uuid(), resumeId: z.string().uuid().optional() });

/**
 * POST /api/resumes/tailor — draft a resume version for one job. Only reorders and
 * emphasizes what's already in your resume; anything not found there is removed and
 * reported in `changes`. Saved as a new version; your original is never modified.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const { jobId, resumeId } = await body(req, Input);

  const resumeQ = db.from("resumes").select("id, raw_text, parsed").eq("user_id", user.id);
  const { data: resume } = await (resumeId ? resumeQ.eq("id", resumeId) : resumeQ.eq("is_primary", true)).maybeSingle();
  if (!resume) throw new HttpError(400, "Upload a resume first");

  const { data: job } = await db.from("jobs").select("id, title, description, companies(name)").eq("id", jobId).maybeSingle();
  if (!job) throw new HttpError(404, "Opportunity not found");
  const company = (job.companies as unknown as { name: string } | null)?.name ?? "";
  if (!job.description || job.description.length < 120) {
    throw new HttpError(422, "This listing has no full description to tailor against. Open the original posting and import its text first.");
  }

  let parsed = resume.parsed ? ParsedResume.parse(resume.parsed) : null;
  if (!parsed) {
    parsed = await parseResume(resume.raw_text);
    await db.from("resumes").update({ parsed }).eq("id", resume.id);
  }

  const tailored = await tailorResume(parsed, { title: job.title, company, description: job.description });

  // Deterministic keyword view that sits next to the draft (independent of the model).
  const jobSkills = new Set(extractSkills(job.description));
  const resumeSkills = new Set(extractSkills(resume.raw_text));
  const keywords = {
    covered: [...jobSkills].filter((s) => resumeSkills.has(s)),
    missing: [...jobSkills].filter((s) => !resumeSkills.has(s)),
  };

  const { data: version, error } = await db
    .from("resume_versions")
    .insert({ user_id: user.id, resume_id: resume.id, job_id: job.id, label: `${company} — ${job.title}`.slice(0, 160), content: { tailored, keywords } })
    .select("id, label, created_at")
    .single();
  if (error) throw error;
  return ok({ version, tailored, keywords });
});
