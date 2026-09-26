import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { normalizePrefs } from "@/lib/domain/notify-prefs";
import { loadProfileItems, loadTailorJob as loadJob } from "@/lib/resume/profile";
import { buildTailored, tailorProposal } from "@/lib/resume/tailor";
import { validateDoc } from "@/lib/resume/validate";

const Input = z.object({
  jobId: z.string().uuid(),
  accept: z.boolean().optional(),
  exclude: z.array(z.string().uuid()).max(50).optional(),
});

/**
 * POST /api/resumes/tailor — deterministic, no AI.
 *   { jobId }                       → proposal: matched / missing skills, relevant items, proposed changes
 *   { jobId, accept: true, exclude } → creates "Resume — Company" from your confirmed profile
 * Missing job requirements are never added to your resume.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Input);
  const [items, job] = await Promise.all([loadProfileItems(db, user.id), loadJob(db, input.jobId)]);
  if (!items.some((i) => i.status !== "requires_confirmation")) throw new HttpError(400, "Upload and review your resume first.");
  const proposal = tailorProposal(items, job);
  if (!input.accept) return ok({ proposal });

  // Only exclusions of items that exist in the profile are honoured.
  const exclude = (input.exclude ?? []).filter((id) => items.some((i) => i.id === id));
  const doc = buildTailored(items, proposal, exclude);
  const check = validateDoc(doc, items);
  if (!check.ok) throw new HttpError(422, `Tailored resume failed verification: ${check.issues[0].claim}`);
  const { data: version, error } = await db
    .from("resume_versions")
    .insert({ user_id: user.id, job_id: job.id, label: `Resume — ${job.company || job.title}`.slice(0, 120), kind: "tailored", content: doc })
    .select("id, label")
    .single();
  if (error) throw error;
  // "Resume tailoring completed" — only if the student wants it (a failure here must never fail the tailoring).
  try {
    const { data: pf } = await db.from("profiles").select("notification_prefs").eq("id", user.id).single();
    if (normalizePrefs(pf?.notification_prefs).in_app.resume) {
      await db.from("notifications").upsert({ user_id: user.id, kind: "resume_tailored", title: `Tailored resume ready: ${job.company || job.title}`, body: "Review every change before you export it.", job_id: job.id, dedupe_key: `tailor:${version.id}` }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
    }
  } catch { /* the notification is a courtesy */ }
  return ok({ version }, { status: 201 });
});
