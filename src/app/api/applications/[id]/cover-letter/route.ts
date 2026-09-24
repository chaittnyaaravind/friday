import { body, HttpError, ok, withUser } from "@/lib/api";
import { parseResume, ParsedResume, writeCoverLetter } from "@/lib/ai/tasks";
import { z } from "zod";

/**
 * POST /api/applications/:id/cover-letter — draft a cover letter grounded only in your
 * resume. Saved to the application as a document; you edit before using it.
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  await body(req, z.object({}).passthrough());
  const { data: app } = await db.from("applications").select("id, job_id, company_name, job_title, jobs(description)").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) throw new HttpError(404, "Application not found");
  const description = (app.jobs as unknown as { description: string | null } | null)?.description;
  if (!description) throw new HttpError(422, "This application has no job description to write against.");

  const { data: resume } = await db.from("resumes").select("id, raw_text, parsed").eq("user_id", user.id).eq("is_primary", true).maybeSingle();
  if (!resume) throw new HttpError(400, "Upload a resume first");
  let parsed = resume.parsed ? ParsedResume.parse(resume.parsed) : null;
  if (!parsed) {
    parsed = await parseResume(resume.raw_text);
    await db.from("resumes").update({ parsed }).eq("id", resume.id);
  }
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).single();
  const { letter, grounded_in } = await writeCoverLetter(parsed, { title: app.job_title, company: app.company_name, description }, profile?.full_name ?? parsed.name);

  await db.from("applications").update({ cover_letter: letter }).eq("id", id);
  await db.from("application_documents").insert({ application_id: id, user_id: user.id, kind: "cover_letter", title: `Cover letter — ${app.company_name}`, content: letter });
  await db.from("application_events").insert({ application_id: id, user_id: user.id, kind: "document", note: "Cover letter drafted" });
  return ok({ letter, grounded_in });
});
