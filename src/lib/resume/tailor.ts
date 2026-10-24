/**
 * Deterministic job tailoring. Compares a job with the CONFIRMED profile and proposes
 * order/wording changes only. A job requirement is never turned into a claimed skill:
 * missing requirements are shown as "not found in profile" and never added.
 */
import { extractSkills, resolveSkill, skillBySlug } from "@/lib/domain/skills";
import { campusScreens, coveredKeywords, type Screen } from "./campus-screens";
import { evidenceLines } from "./edits";
import { buildResume, normalizeSentence, type BuildOptions } from "./generate";
import { isEligible, SECTION_LABEL, type CandidateItem, type ExperienceData, type ProjectData, type ResumeDoc, type SkillData, type TextData } from "./types";

export type TailorJob = { id: string; title: string; company: string; description: string; requirements: string[] };

export type TailorProposal = {
  job: { id: string; title: string; company: string };
  skills: { name: string; status: "confirmed" | "not_in_profile"; yours?: string; mentionedIn?: string }[];
  relevant: { experience: Ranked[]; projects: Ranked[]; coursework: string[] };
  changes: {
    keep: { id: string; label: string }[];
    reorder: string[];
    wording: { before: string; after: string }[];
    notIncluded: { id: string; label: string; reason: string }[];
    needsConfirmation: string[];
  };
  options: { prioritySkills: string[]; rank: [string, number][]; exclude: string[] };
  /** What the posting screens for (customer service, software, GPA, availability…) and whether the profile shows it. */
  screens: Screen[];
  /** Job terms the profile supports: the confirmed matching skills plus covered screens. The only words a rewrite may target. */
  keywords: string[];
};
type Ranked = { id: string; label: string; score: number; matches: string[] };

const STOP = new Set(["intern", "internship", "summer", "fall", "spring", "winter", "the", "and", "for", "with", "of", "to", "a", "an", "in", "i", "ii", "iii", "united", "states", "new", "grad", "2025", "2026", "2027", "2028"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !STOP.has(w));

export function tailorProposal(allItems: CandidateItem[], job: TailorJob): TailorProposal {
  const items = allItems.filter(isEligible);
  const jobSlugs = new Set<string>([...job.requirements.map((r) => resolveSkill(r)).filter(Boolean) as string[], ...extractSkills(job.description)]);
  const jobWords = new Set([...words(job.title), ...words(job.requirements.join(" "))]);

  // Skills: job requirement vs the user's own confirmed skills. Never the other way round.
  const mine = items.filter((i) => i.section === "skill").map((i) => ({ name: (i.data as SkillData).name, slug: resolveSkill((i.data as SkillData).name) }));
  const skills: TailorProposal["skills"] = [...jobSlugs].map((slug) => {
    const have = mine.find((m) => m.slug === slug);
    return have ? { name: skillBySlug(slug)?.name ?? slug, status: "confirmed" as const, yours: have.name } : { name: skillBySlug(slug)?.name ?? slug, status: "not_in_profile" as const };
  });
  skills.sort((a, b) => (a.status === b.status ? 0 : a.status === "confirmed" ? -1 : 1));
  // A missing skill may still be named elsewhere (e.g. "AWS" in a certification). Say where,
  // but never promote it to a skill — only the user can confirm that.
  for (const sk of skills) {
    if (sk.status !== "not_in_profile") continue;
    const slug = [...jobSlugs].find((j) => (skillBySlug(j)?.name ?? j) === sk.name);
    const where = items.find((i) => i.section !== "skill" && slug && extractSkills(JSON.stringify(i.data)).includes(slug));
    if (where) sk.mentionedIn = SECTION_LABEL[where.section];
  }

  const rankOf = (text: string) => {
    const matches = extractSkills(text).filter((s) => jobSlugs.has(s)).map((s) => skillBySlug(s)?.name ?? s);
    const overlap = words(text).filter((w) => jobWords.has(w));
    return { score: matches.length * 2 + new Set(overlap).size, matches };
  };
  const entryText = (i: CandidateItem) => {
    const d = i.data as ExperienceData & ProjectData;
    return [d.title, d.organization, d.name, ...(d.technologies ?? []), ...(d.bullets ?? [])].filter(Boolean).join(" ");
  };
  const ranked = (section: "experience" | "project" | "activity"): Ranked[] =>
    items.filter((i) => i.section === section).map((i) => {
      const d = i.data as ExperienceData & ProjectData;
      return { id: i.id, label: section === "project" ? d.name : [d.title, d.organization].filter(Boolean).join(" · "), ...rankOf(entryText(i)) };
    });
  const exp = ranked("experience");
  const proj = ranked("project");
  const act = ranked("activity");
  const descLower = job.description.toLowerCase();
  const coursework = items.filter((i) => i.section === "coursework").map((i) => (i.data as TextData).text).filter((t) => descLower.includes(t.toLowerCase()) || extractSkills(t).some((s) => jobSlugs.has(s)));

  // Proposed changes — order and wording only.
  const reorder: string[] = [];
  const confirmed = skills.filter((s) => s.status === "confirmed").map((s) => s.yours!);
  if (confirmed.length) reorder.push(`Move ${confirmed.slice(0, 5).join(", ")} to the front of Skills`);
  for (const [label, list] of [["Experience", exp], ["Projects", proj]] as const) {
    const byScore = [...list].sort((a, b) => b.score - a.score);
    if (list.length > 1 && byScore[0].id !== list[0].id && byScore[0].score > list[0].score) reorder.push(`Move “${byScore[0].label}” to the top of ${label}`);
  }

  const wording: { before: string; after: string }[] = [];
  for (const i of items) {
    for (const b of (i.data as { bullets?: string[] }).bullets ?? []) {
      const after = normalizeSentence(b);
      if (after !== b.trim() && wording.length < 8) wording.push({ before: b, after });
    }
  }

  const notIncluded = act
    .filter((a) => a.score === 0 && /high school/i.test(entryText(items.find((i) => i.id === a.id)!)))
    .map((a) => ({ id: a.id, label: a.label, reason: "High-school activity with no connection to this role" }));

  const keep = [...exp, ...proj].filter((r) => !notIncluded.some((n) => n.id === r.id)).map((r) => ({ id: r.id, label: r.label }));
  const needsConfirmation = skills
    .filter((s) => s.status === "not_in_profile")
    .map((s) => (s.mentionedIn ? `${s.name} is required — it's mentioned in your ${s.mentionedIn}, but isn't a confirmed skill` : `${s.name} appears in the job requirements but is not in your profile`));

  const jobText = [job.title, job.description, ...job.requirements].join("\n");
  const screens = campusScreens(jobText, items.flatMap((i) => evidenceLines(i.data)).join("\n"));
  const keywords = [...new Set([...skills.filter((s) => s.status === "confirmed").map((s) => s.name), ...coveredKeywords(screens)])].slice(0, 15);

  return {
    job: { id: job.id, title: job.title, company: job.company },
    screens,
    keywords,
    skills,
    relevant: { experience: exp.filter((e) => e.score > 0).sort((a, b) => b.score - a.score), projects: proj.filter((p) => p.score > 0).sort((a, b) => b.score - a.score), coursework },
    changes: { keep, reorder, wording, notIncluded, needsConfirmation },
    options: { prioritySkills: confirmed, rank: [...exp, ...proj, ...act].map((r) => [r.id, r.score]), exclude: notIncluded.map((n) => n.id) },
  };
}

/** Build the tailored document the user accepted (exclusions are the user's choice). */
export function buildTailored(items: CandidateItem[], p: TailorProposal, excludeIds: string[]): ResumeDoc {
  const opts: BuildOptions = { prioritySkills: p.options.prioritySkills, rank: new Map(p.options.rank), exclude: new Set(excludeIds) };
  return buildResume(items, opts);
}
