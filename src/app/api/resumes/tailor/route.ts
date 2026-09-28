import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { normalizePrefs } from "@/lib/domain/notify-prefs";
import { reportSummary } from "@/lib/resume/report";
import { tailorResume } from "@/lib/resume/tailor-service";

const Input = z.object({
  jobId: z.string().uuid(),
  accept: z.boolean().optional(),
  exclude: z.array(z.string().uuid()).max(50).optional(),
});

/**
 * POST /api/resumes/tailor — deterministic, no AI.
 *   { jobId }                       → proposal: matched / missing skills, relevant items, proposed changes,
 *                                     and the ATS spelling changes that would be made
 *   { jobId, accept: true, exclude } → creates "Resume — Company" from your confirmed profile, as a NEW version, and stores
 *                                     its tailoring report (what changed, what matched, what is missing and was not added)
 * Missing job requirements are never added to your resume. Nothing you already have is modified.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Input);
  const result = await tailorResume(db, user.id, input);
  if (!("version" in result)) return ok(result);

  const { version, report, job } = result;
  // "Resume tailoring completed" — only if the student wants it (a failure here must never fail the tailoring).
  try {
    const { data: pf } = await db.from("profiles").select("notification_prefs").eq("id", user.id).single();
    if (normalizePrefs(pf?.notification_prefs).in_app.resume) {
      await db.from("notifications").upsert({ user_id: user.id, kind: "resume_tailored", title: `Tailored resume ready: ${job.company || job.title}`, body: `Review every change before you export it. ${reportSummary(report)}`, job_id: job.id, dedupe_key: `tailor:${version.id}` }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    }
  } catch { /* the notification is a courtesy */ }
  return ok({ version, report }, { status: 201 });
});
