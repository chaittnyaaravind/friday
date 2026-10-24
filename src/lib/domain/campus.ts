/**
 * SJSU campus jobs, described the way a student thinks about them: what the ROLE is, and which campus EMPLOYER posted it.
 *
 * Roles are multi-label: "IT Helpdesk Student Assistant" is both a tech role and a student-assistant role, and a
 * student filtering on either should find it. Classification reads the title only (plus the source it came from):
 * it never invents a role, and anything unrecognised is "other". Pure and deterministic.
 */
export const CAMPUS_ROLES = [
  "research_assistant", "lab_assistant", "teaching_assistant", "tutor_mentor", "resident_advisor", "orientation_leader",
  "fitness_recreation", "dining_retail", "it_support", "library_assistant", "technical_media", "front_desk_admin", "student_assistant", "other",
] as const;
export type CampusRole = (typeof CAMPUS_ROLES)[number];

export const CAMPUS_ROLE_LABEL: Record<CampusRole, string> = {
  research_assistant: "Research assistant",
  lab_assistant: "Lab assistant",
  teaching_assistant: "Teaching assistant",
  tutor_mentor: "Tutor & peer mentor",
  resident_advisor: "Resident advisor",
  orientation_leader: "Orientation leader",
  fitness_recreation: "Fitness & recreation",
  dining_retail: "Dining & retail",
  it_support: "IT help desk & computer lab",
  library_assistant: "Library & circulation",
  technical_media: "Tech & media",
  front_desk_admin: "Front desk & admin",
  student_assistant: "Student assistant",
  other: "Other",
};

export const isCampusRole = (v: unknown): v is CampusRole => typeof v === "string" && (CAMPUS_ROLES as readonly string[]).includes(v);

// Titles are often plural on the pages that list several roles at once ("Peer Tutors", "Learning Assistants"), so nouns take an optional "s".
// A role may have several rules: abbreviations ("TA", "IT") are matched case-sensitively so they never fire inside other words.
const RULES: [CampusRole, RegExp][] = [
  ["research_assistant", /\bresearch\s+(?:assistants?|aides?|associates?|interns?|students?|technicians?|fellows?)\b/i],
  ["lab_assistant", /\b(?:lab|laboratory)\s+(?:assistants?|aides?|monitors?|technicians?|attendants?|tutors?)\b/i],
  ["teaching_assistant", /\b(?:teaching|instructional|course)\s+(?:assistants?|associates?|aides?)\b|\bgraders?\b/i],
  ["teaching_assistant", /\bTAs?\b/],
  ["tutor_mentor", /\b(?:tutors?|tutoring|mentors?|mentoring|supplemental instruction|SI leaders?|learning assistants?|peer\s+(?:educators?|advisors?|coach(?:es)?|leaders?)|writing consultants?)\b/i],
  ["resident_advisor", /\bresident\s+(?:advisors?|advisers?|assistants?)\b/i],
  ["orientation_leader", /\borientation\b.*\b(?:leaders?|team|ambassadors?|assistants?)\b|\bOATies?\b/i],
  ["fitness_recreation", /\b(?:fitness|lifeguards?|intramurals?|club sports?|recreation(?:al)?|aquatics?|referees?|sports?\s+(?:officials?|supervisors?))\b/i],
  ["dining_retail", /\b(?:kitchen|cooks?|cashiers?|baristas?|servers?|dining|catering|dishwashers?|bookstore|retail|food service|concessions?)\b/i],
  ["it_support", /\b(?:helpdesk|help desk|service desk|tech(?:nical)? support|technology support|computer (?:lab|labs|support)|desktop support|(?:IT|tech) consultants?)\b/i],
  ["it_support", /\bIT\b/],
  ["library_assistant", /\b(?:library|libraries|circulation|shelvers?|shelving|stacks)\b/i],
  ["technical_media", /\b(?:developers?|programmers?|web|software|data(?! entry)|analysts?|photographers?|videographers?|video|designers?|graphic|social media|content creators?)\b/i],
  ["front_desk_admin", /\b(?:office (?:student )?(?:assistants?|aides?|support|clerks?)|front counter|administrative|admin|front desk|receptionists?|reception|clerks?|clerical|mailroom|records|data entry|document (?:processing|imaging)|scanning|customer service|information desk|welcome desk|check[- ]in|program assistants?|operations assistants?)\b/i],
  ["student_assistant", /\bstudents?\b|\bassistants?\b|\baides?\b/i],
];

/** Every role the title names, most specific first; ["other"] when it names none. */
export function classifyCampusRoles(title: string | null | undefined): CampusRole[] {
  const t = title ?? "";
  const found = new Set(RULES.filter(([, rx]) => rx.test(t)).map(([r]) => r));
  const roles = CAMPUS_ROLES.filter((r) => found.has(r));
  return roles.length ? roles : ["other"];
}

export const CAMPUS_EMPLOYERS = ["library", "associated_students", "peer_connections", "student_union", "research_foundation", "writing_center", "orientation", "department", "other"] as const;
export type CampusEmployer = (typeof CAMPUS_EMPLOYERS)[number];

export const CAMPUS_EMPLOYER_LABEL: Record<CampusEmployer, string> = {
  library: "MLK Library",
  associated_students: "Associated Students",
  peer_connections: "Peer Connections",
  student_union: "Student Union",
  research_foundation: "Research Foundation",
  writing_center: "Writing Center",
  orientation: "Orientation",
  department: "Departments",
  other: "Other campus employers",
};

export const isCampusEmployer = (v: unknown): v is CampusEmployer => typeof v === "string" && (CAMPUS_EMPLOYERS as readonly string[]).includes(v);

const BY_SLUG: Record<string, CampusEmployer> = {
  "sjsu-library": "library",
  "sjsu-associated-students": "associated_students",
  "sjsu-peer-connections": "peer_connections",
  "sjsu-student-union": "student_union",
  "sjsu-research-foundation": "research_foundation",
  "sjsu-writing-center": "writing_center",
  "sjsu-orientation-leaders": "orientation",
};

/** The campus employer behind a source, from the source's registry slug. Unknown slugs are never guessed into a named employer. */
export function campusEmployerOf(slug: string | null | undefined): CampusEmployer {
  if (!slug) return "other";
  return BY_SLUG[slug] ?? (slug.startsWith("sjsu-") ? "department" : "other");
}

/**
 * Campus employers FRIDAY does NOT read, and why. Shown on the SJSU page so a gap is stated, not hidden.
 * Each reason is something observed or a plain statement that no reader exists — never a claim that they have no jobs.
 * Dining employers (Spartan Eats) are deliberately absent: dining work is excluded (see exclusions.ts), not a coverage gap.
 */
export const CAMPUS_NOT_COVERED: { name: string; reason: string; url: string; checkedOn: string }[] = [
  { name: "University Housing (Resident Advisors)", reason: "Its employment page could not be reached from FRIDAY when last checked.", url: "https://www.housing.sjsu.edu/aboutus/employment/", checkedOn: "2026-09-27" },
  { name: "Spartan Bookstore", reason: "Hires through a third-party application site FRIDAY does not read.", url: "http://www.bncollegejobs.com/", checkedOn: "2026-09-27" },
];
