import { HttpError, ok, withUser } from "@/lib/api";
import { loadProfileItems } from "@/lib/resume/profile";
import type { TailoringReport } from "@/lib/resume/report";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

/**
 * GET /api/resumes/versions/:id/report — the permanent record of what tailoring did for this version, plus a FRESH
 * verification of the version as it is now (you may have edited it since): claims without evidence in your profile are listed.
 */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const [{ data: row }, { data: version }, items] = await Promise.all([
    db.from("tailoring_reports").select("id, version_id, job_id, master_version_id, job_title, company_name, report, created_at").eq("version_id", id).eq("user_id", user.id).maybeSingle(),
    db.from("resume_versions").select("id, content, is_master, kind").eq("id", id).eq("user_id", user.id).maybeSingle(),
    loadProfileItems(db, user.id),
  ]);
  if (!version) throw new HttpError(404, "Resume not found");
  if (!row) throw new HttpError(404, "This resume has no tailoring report");
  const now = validateDoc(version.content as ResumeDoc, items);
  return ok({
    report: row.report as TailoringReport,
    createdAt: row.created_at,
    jobId: row.job_id,
    masterVersionId: row.master_version_id,
    verifiedNow: { ok: now.ok, issues: now.issues },
  });
});
