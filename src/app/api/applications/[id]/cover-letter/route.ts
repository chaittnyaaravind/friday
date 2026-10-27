import { body, HttpError, ok, withUser } from "@/lib/api";
import { requireAiQuota } from "@/lib/ai/quota";
import { writeCoverLetter } from "@/lib/ai/tasks";
import { loadProfileItems } from "@/lib/resume/profile";
import { isEligible } from "@/lib/resume/types";
import { unsupportedClaims } from "@/lib/resume/validate";
import { lintWriting } from "@/lib/writing/style";
import { z } from "zod";

/**
 * POST /api/applications/:id/cover-letter — draft a cover letter grounded only in your
 * resume. Saved to the application as a document; you edit before using it.
 */
export const POST = withUser<{ id: string }>(async ({ db, user, req }, { id }) => {
  await body(req, z.object({}).passthrough());
  const { data: app } = await db.from("applications").select("id, job_id, company_name, job_title, jobs(description, excluded_reason)").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) throw new HttpError(404, "Application not found");
  const job = app.jobs as unknown as { description: string | null; excluded_reason: string | null } | null;
  if (job?.excluded_reason) throw new HttpError(409, "This job is excluded by FRIDAY's job-search rules, so FRIDAY does not write a cover letter for it.");
  const description = job?.description;
  if (!description) throw new HttpError(422, "This application has no job description to write against.");

  // Only confirmed profile facts are given to the model.
  const items = (await loadProfileItems(db, user.id)).filter(isEligible);
  const facts = items.map((i) => ({ section: i.section, ...(i.data as object) }));
  if (!facts.length) throw new HttpError(400, "Upload and review your resume first");
  const { data: profile } = await db.from("profiles").select("full_name").eq("id", user.id).single();
  await requireAiQuota(user.id, "cover_letter");
  const { letter, grounded_in } = await writeCoverLetter(facts, { title: app.job_title, company: app.company_name, description }, profile?.full_name ?? null);

  // Checked against the student's facts only: the posting says what the employer needs, never what the student did.
  const evidence = items.map((i) => `${JSON.stringify(i.data)}\n${i.source_text ?? ""}`).join("\n");
  // A claim the profile does not support is discarded, unless the POSTING names it (its pay, a tool it uses): then the letter
  // may be describing the job, not the student, and the student is told to check that sentence.
  const unsupported = unsupportedClaims(letter, `${evidence}\n${app.company_name}\n${app.job_title}`);
  const fromPosting = unsupported.filter((c) => unsupportedClaims(c, description).length === 0);
  const invented = unsupported.filter((c) => !fromPosting.includes(c));
  if (invented.length) throw new HttpError(422, `FRIDAY discarded the draft because it stated ${invented.map((c) => `“${c}”`).join(", ")}, which neither your profile nor the posting supports. Try again, or write the letter yourself.`);
  const issues = lintWriting(letter, "cover_letter", evidence);
  if (issues.some((i) => i.severity === "error")) throw new HttpError(422, `FRIDAY discarded the draft: ${issues.find((i) => i.severity === "error")!.message}`);
  for (const c of fromPosting) issues.push({ code: "posting_term", severity: "warn", message: `The letter mentions “${c}”, which is in the posting but not in your profile. Make sure it does not claim you have it.`, excerpt: c });

  await db.from("applications").update({ cover_letter: letter }).eq("id", id);
  await db.from("application_documents").insert({ application_id: id, user_id: user.id, kind: "cover_letter", title: `Cover letter — ${app.company_name}`, content: letter });
  await db.from("application_events").insert({ application_id: id, user_id: user.id, kind: "document", note: "Cover letter drafted" });
  return ok({ letter, grounded_in, issues });
});
