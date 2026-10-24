/**
 * Candidate Profile persistence. The profile (candidate_items) is the single source of
 * truth for resume generation; job matching reads its eligible skills.
 */
import { excludedMessage } from "@/lib/domain/exclusions";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/api";
import { rematchAll } from "@/lib/discovery/agent";
import { resolveSkill } from "@/lib/domain/skills";
import { isEligible, type CandidateItem, type ParsedFact, type Section } from "./types";

const ORDER: Section[] = ["personal", "link", "summary", "education", "coursework", "experience", "project", "skill", "certification", "award", "activity", "other"];

export async function loadProfileItems(db: SupabaseClient, userId: string): Promise<CandidateItem[]> {
  const { data, error } = await db.from("candidate_items").select("*").eq("user_id", userId).order("position");
  if (error) throw error;
  return ((data ?? []) as CandidateItem[]).sort((a, b) => ORDER.indexOf(a.section) - ORDER.indexOf(b.section) || a.position - b.position);
}

/** A stable identity for a fact so re-uploading the same resume doesn't duplicate it. */
export function factKey(section: Section, data: unknown): string {
  const d = data as Record<string, unknown>;
  const n = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
  switch (section) {
    case "personal": return `personal:${n(d.field)}`;
    case "link": return `link:${n(d.url)}`;
    case "skill": return `skill:${n(d.name)}`;
    case "education": return `education:${n(d.school)}:${n(d.degree)}`;
    case "experience": case "activity": return `${section}:${n(d.title)}:${n(d.organization)}:${n(d.start)}`;
    case "project": return `project:${n(d.name)}`;
    default: return `${section}:${n(d.text)}:${n(d.group)}`;
  }
}

/** Store newly parsed facts, skipping anything already in the profile. Returns counts. */
export async function storeParsedFacts(db: SupabaseClient, userId: string, resumeId: string, facts: ParsedFact[]) {
  const existing = await loadProfileItems(db, userId);
  const have = new Set(existing.map((i) => factKey(i.section, i.data)));
  const nextPos = new Map<Section, number>();
  for (const i of existing) nextPos.set(i.section, Math.max(nextPos.get(i.section) ?? 0, i.position + 1));
  const rows = [];
  let skipped = 0;
  for (const f of facts) {
    const key = factKey(f.section, f.data);
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    const pos = nextPos.get(f.section) ?? 0;
    nextPos.set(f.section, pos + 1);
    rows.push({ user_id: userId, section: f.section, position: pos, data: f.data, source: "uploaded_resume", source_text: f.sourceText, source_resume_id: resumeId, status: f.status, note: f.note ?? null });
  }
  if (rows.length) {
    const { error } = await db.from("candidate_items").insert(rows);
    if (error) throw error;
  }
  return { added: rows.length, skipped, needsConfirmation: rows.filter((r) => r.status === "requires_confirmation").length };
}

/**
 * Job matching uses only skills the user has on record (explicit, added or confirmed).
 * Resume-sourced profile_skills are replaced; skills the user added in Settings are kept.
 */
export async function syncMatchingSkills(db: SupabaseClient, userId: string) {
  const items = (await loadProfileItems(db, userId)).filter((i) => i.section === "skill" && isEligible(i));
  const slugs = [...new Set(items.map((i) => resolveSkill((i.data as { name: string }).name)).filter(Boolean) as string[])];
  const { data: rows } = slugs.length ? await db.from("skills").select("id").in("slug", slugs) : { data: [] as { id: number }[] };
  const ids = new Set((rows ?? []).map((r) => r.id));
  const { data: current } = await db.from("profile_skills").select("skill_id, source").eq("user_id", userId);
  const staleResume = (current ?? []).filter((c) => c.source === "resume" && !ids.has(c.skill_id)).map((c) => c.skill_id);
  if (staleResume.length) await db.from("profile_skills").delete().eq("user_id", userId).eq("source", "resume").in("skill_id", staleResume);
  const have = new Set((current ?? []).map((c) => c.skill_id));
  const add = [...ids].filter((id) => !have.has(id)).map((skill_id) => ({ user_id: userId, skill_id, source: "resume" }));
  if (add.length) await db.from("profile_skills").insert(add);
  await rematchAll(db, { userId });
}

/** The job fields tailoring needs (title, company, description, parsed requirements). */
export async function loadTailorJob(db: SupabaseClient, jobId: string) {
  const { data: job } = await db.from("jobs").select("id, title, description, excluded_reason, companies(name), job_requirements(label)").eq("id", jobId).maybeSingle();
  if (!job) throw new HttpError(404, "Opportunity not found");
  // Excluded work (exclusions.ts) is refused here, so every tailoring path — page, API, chat — refuses it.
  if (job.excluded_reason) throw new HttpError(409, excludedMessage(job.excluded_reason as string));
  return {
    id: job.id as string,
    title: job.title as string,
    company: (job.companies as unknown as { name: string } | null)?.name ?? "",
    description: (job.description as string | null) ?? "",
    requirements: ((job.job_requirements as { label: string }[]) ?? []).map((r) => r.label),
  };
}

export type ResumeStatus = {
  uploaded: boolean;
  extracted: number;
  needsConfirmation: number;
  reviewed: boolean;
  latestVersion: { id: string; label: string } | null;
};

/** Pipeline status for the dashboard and resume hub: upload → extract → review → ready. */
export async function resumeStatus(db: SupabaseClient, userId: string): Promise<ResumeStatus> {
  const [{ count: uploads }, items, { data: profile }, { data: latest }] = await Promise.all([
    db.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    loadProfileItems(db, userId),
    db.from("profiles").select("resume_reviewed_at").eq("id", userId).single(),
    db.from("resume_versions").select("id, label").eq("user_id", userId).neq("kind", "legacy").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    uploaded: (uploads ?? 0) > 0,
    extracted: items.length,
    needsConfirmation: items.filter((i) => i.status === "requires_confirmation").length,
    reviewed: Boolean(profile?.resume_reviewed_at),
    latestVersion: latest ?? null,
  };
}
