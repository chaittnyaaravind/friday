import { HttpError, ok, withUser } from "@/lib/api";
import { loadActiveJobsForMatching, loadMatchProfile, matchColumns, toFitJob, toMatchJob } from "@/lib/discovery/agent";
import { checkEligibility } from "@/lib/domain/eligibility";
import { explainMatch } from "@/lib/domain/explain";
import { authGuidance, computeMatch } from "@/lib/domain/match";

/** POST /api/jobs/:id/match — recompute your transparent match for one opportunity: score, breakdown, eligibility and the reasons. */
export const POST = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const [profile, jobs, { data: p }] = await Promise.all([
    loadMatchProfile(db, user.id),
    loadActiveJobsForMatching(db, [id]),
    db.from("profiles").select("work_authorization").eq("id", user.id).single(),
  ]);
  if (!profile) throw new HttpError(400, "Complete your profile first");
  const job = jobs[0];
  if (!job) throw new HttpError(404, "Opportunity not found or no longer active");
  const matchJob = toMatchJob(job);
  const m = computeMatch(profile, matchJob);
  const eligibility = checkEligibility(profile, matchJob, m.distanceMiles);
  const { error } = await db.from("job_matches").upsert(
    { user_id: user.id, job_id: id, ...matchColumns(profile, matchJob, toFitJob(job)), computed_at: new Date().toISOString() },
    { onConflict: "user_id,job_id" },
  );
  if (error) throw error;
  return ok({
    ...m,
    eligibility,
    reasons: explainMatch(m, eligibility),
    authorization: authGuidance(p?.work_authorization ?? null, { employmentType: job.employment_type, isOnCampus: job.is_on_campus, description: job.description }),
  });
});
