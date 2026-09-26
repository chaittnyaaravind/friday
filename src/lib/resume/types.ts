/**
 * Resume system types. The Candidate Profile is a list of fact items; each carries
 * where it came from (`source`, `sourceText`) and how trustworthy it is (`status`).
 * Only eligible statuses may appear in a generated resume.
 */

export type FactStatus = "explicit" | "user_added" | "user_confirmed" | "requires_confirmation";
export type FactSource = "uploaded_resume" | "user";

export type Section =
  | "personal" | "link" | "summary" | "education" | "experience" | "project"
  | "skill" | "certification" | "award" | "coursework" | "activity" | "other";

export type PersonalData = { field: "name" | "email" | "phone" | "location"; value: string };
export type LinkData = { label: string; url: string };
export type TextData = { text: string; group?: string };
export type EducationData = { school: string; degree: string | null; start: string | null; end: string | null; gpa: string | null; details: string[] };
export type ExperienceData = { title: string; organization: string; location: string | null; start: string | null; end: string | null; bullets: string[] };
export type ProjectData = { name: string; technologies: string[]; date: string | null; link: string | null; bullets: string[] };
export type SkillData = { name: string; group: string | null };

export type SectionData = {
  personal: PersonalData;
  link: LinkData;
  summary: TextData;
  education: EducationData;
  experience: ExperienceData;
  activity: ExperienceData;
  project: ProjectData;
  skill: SkillData;
  certification: TextData;
  award: TextData;
  coursework: TextData;
  other: TextData;
};

/** A fact produced by the parser, before it is stored. */
export type ParsedFact<S extends Section = Section> = {
  section: S;
  data: SectionData[S];
  sourceText: string;
  status: FactStatus;
  note?: string; // why it needs confirmation
};

/** A stored Candidate Profile item (candidate_items row). */
export type CandidateItem<S extends Section = Section> = {
  id: string;
  section: S;
  position: number;
  data: SectionData[S];
  source: FactSource;
  source_text: string | null;
  source_resume_id: string | null;
  status: FactStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export const ELIGIBLE: FactStatus[] = ["explicit", "user_added", "user_confirmed"];
export const isEligible = (i: { status: FactStatus }) => ELIGIBLE.includes(i.status);

export const SECTION_LABEL: Record<Section, string> = {
  personal: "Personal information",
  link: "Links",
  summary: "Summary",
  education: "Education",
  experience: "Experience",
  project: "Projects",
  skill: "Skills",
  certification: "Certifications",
  award: "Awards",
  coursework: "Coursework",
  activity: "Activities & leadership",
  other: "Other (uncategorized)",
};

// ───────────────────────── Resume document (what the editor edits and export renders) ─────────────────────────

/** Where a line of resume text came from. `profile` text is validated against the profile. */
export type Origin = "profile" | "user" | "ai";

/**
 * Trace of an accepted AI rewrite. `basis` is the text the AI was allowed to draw on (the
 * line it rewrote, its entry, the profile item) — the validator checks the AI line against it.
 */
export type AiTrace = { basis: string; op: string; at: string; /** server signature over (user, text, basis) — see lib/ai/sign.ts */ sig?: string };

export type DocLine = { id: string; text: string; origin: Origin; sourceItemId: string | null; ai?: AiTrace };

export type DocEntry = {
  id: string;
  sourceItemId: string | null;
  heading: string; // e.g. title / school / project name
  subheading: string; // e.g. organization / degree / technologies
  meta: string; // dates / location
  origin: Origin;
  bullets: DocLine[];
};

export type DocSectionKind = "summary" | "education" | "experience" | "projects" | "skills" | "certifications" | "awards" | "coursework" | "activities";

export type DocSection = { id: string; kind: DocSectionKind; title: string; entries: DocEntry[]; lines: DocLine[] };

export type ResumeDoc = {
  version: 1;
  header: { name: string; contact: string[]; origin: Origin };
  sections: DocSection[];
};
