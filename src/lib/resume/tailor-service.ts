/**
 * Tailoring a resume to a job. The deterministic tailor chooses, orders and spells; then, when an AI provider is configured,
 * the AI pass (lib/ai/tailor-ai.ts) rewrites the few most relevant lines in the posting's terms. A rewrite is kept only if
 * the fact guard found nothing new in it and it reads clean (no AI tells); every kept line is signed and re-verified here.
 *
 * What this NEVER does — each is tested:
 *   - update or delete anything the student owns: not the uploaded original (`resumes`), not their profile facts
 *     (`candidate_items`), not their master resume, not an earlier tailored version. It only INSERTS a new version and its report.
 *   - add a skill, number or claim the profile does not support. Missing job requirements are reported, never written.
 *   - save a resume that fails verification, or leave a tailored version without its report.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { aiTailor, type AiTailorChange } from "@/lib/ai/tailor-ai";
import type { Screen } from "./campus-screens";
import { buildResume } from "./generate";
import { loadProfileItems, loadTailorJob } from "./profile";
import { buildTailoringReport, type TailoringReport } from "./report";
import { buildTailored, tailorProposal, type TailorProposal } from "./tailor";
import { applyTerminology, type TermChangeRecord } from "./terminology";
import type { ResumeDoc } from "./types";
import { validateDoc } from "./validate";

export type TailorInput = { jobId: string; accept?: boolean; exclude?: string[]; ai?: boolean };
export type TailorPreview = { proposal: TailorProposal; terminology: TermChangeRecord[]; ai: AiTailorChange[]; aiNote: string | null };
export type TailorCreated = { version: { id: string; label: string }; report: TailoringReport; job: { id: string; title: string; company: string }; ai: AiTailorChange[]; screens: Screen[] };

/** The student's chosen master resume, if they set one. Read-only. */
export async function loadMaster(db: SupabaseClient, userId: string): Promise<{ id: string; content: ResumeDoc } | null> {
  const { data } = await db.from("resume_versions").select("id, content").eq("user_id", userId).eq("is_master", true).maybeSingle();
  return data ? { id: data.id as string, content: data.content as ResumeDoc } : null;
}

export async function tailorResume(db: SupabaseClient, userId: string, input: TailorInput): Promise<TailorPreview | TailorCreated> {
  const [items, job] = await Promise.all([loadProfileItems(db, userId), loadTailorJob(db, input.jobId)]);
  if (!items.some((i) => i.status !== "requires_confirmation")) throw new HttpError(400, "Upload and review your resume first.");
  const proposal = tailorProposal(items, job);
  const jobText = [job.title, job.description, job.requirements.join("\n")].filter(Boolean).join("\n");

  // Preview: exactly what would change, including the spelling changes — nothing is created.
  const rewrite = (doc: ResumeDoc) => (input.ai === false ? Promise.resolve({ doc, changes: [] as AiTailorChange[], note: null }) : aiTailor(doc, { userId, keywords: proposal.keywords, items }));
  if (!input.accept) {
    const { doc, changes } = applyTerminology(buildTailored(items, proposal, proposal.options.exclude), jobText);
    const ai = await rewrite(doc);
    return { proposal, terminology: changes, ai: ai.changes, aiNote: ai.note };
  }

  // Only exclusions of items that exist in the profile are honoured.
  const exclude = (input.exclude ?? []).filter((id) => items.some((i) => i.id === id));
  const { doc: spelled, changes: terminology } = applyTerminology(buildTailored(items, proposal, exclude), jobText);
  let { doc, changes: ai } = await rewrite(spelled);
  // Belt and braces: if the AI version fails verification for any reason, fall back to the verified deterministic one.
  if (ai.length && !validateDoc(doc, items).ok) ({ doc, ai } = { doc: spelled, ai: [] });
  const check = validateDoc(doc, items);
  if (!check.ok) throw new HttpError(422, `Tailored resume failed verification: ${check.issues[0].claim}`);

  const master = await loadMaster(db, userId);
  const report = buildTailoringReport({
    job,
    baseline: master ? { doc: master.content, source: "master", versionId: master.id } : { doc: buildResume(items), source: "profile", versionId: null },
    tailored: doc,
    items,
    proposal,
    terminology,
  });
  if (ai.length) report.aiRewrites = ai;

  // A NEW version every time. Nothing existing is touched.
  const { data: version, error } = await db
    .from("resume_versions")
    .insert({ user_id: userId, job_id: job.id, label: `Resume — ${job.company || job.title}`.slice(0, 120), kind: "tailored", content: doc, source_version_id: master?.id ?? null })
    .select("id, label")
    .single();
  if (error) throw error;

  const { error: reportError } = await db.from("tailoring_reports").insert({
    user_id: userId, version_id: version.id, job_id: job.id, master_version_id: master?.id ?? null, job_title: job.title, company_name: job.company || null, report,
  });
  if (reportError) {
    // A tailored resume with no record of what changed must not exist: remove ONLY the version created a moment ago, then fail.
    await db.from("resume_versions").delete().eq("id", version.id).eq("user_id", userId);
    throw reportError;
  }
  return { version: { id: version.id as string, label: version.label as string }, report, job: { id: job.id, title: job.title, company: job.company }, ai, screens: proposal.screens };
}
