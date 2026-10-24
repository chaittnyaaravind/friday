/**
 * Exclusion rules: kinds of work FRIDAY never shows, ranks, recommends or prepares an application for.
 *
 * Applied in the BACKEND, at ingestion (the job row records `excluded_reason`), in the search RPC (excluded rows are never
 * returned), in matching (no score, no alert) and in tailoring / application packets (refused). The UI only reports counts.
 *
 * The rule list is data: edit EXCLUSION_RULES to change what is excluded. Each rule reads the normalized title, the duties
 * (description), the department / category and the employer, and records WHY it fired so the decision can be audited.
 *
 * Department alone is weak evidence. An "Administrative Assistant" in a dining-adjacent office is NOT excluded unless its
 * own duties are food-service work; a "Line Cook" is excluded whatever department posted it.
 */

export type ExclusionRule = {
  id: string;
  label: string;
  /** Title words that ARE the excluded work ("cook", "dishwasher"). A title hit excludes on its own. */
  workTitles: string[];
  /** Organisation names / settings ("dining commons", "Spartan Eats"). Exclude unless the title is clearly office/IT work. */
  orgTerms: string[];
  /** Duty phrases. Two or more distinct hits in the description mean the job IS this work, whatever its title. */
  duties: string[];
};

export const EXCLUSION_RULES: ExclusionRule[] = [
  {
    id: "dining",
    label: "Dining and food service",
    workTitles: [
      "cook", "line cook", "prep cook", "chef", "sous chef", "kitchen", "dishwasher", "dish washer", "dishroom", "dish room",
      "barista", "busser", "food service", "food services", "foodservice", "food prep", "food preparation", "food runner",
      "food server", "banquet server", "catering", "caterer", "cafeteria", "concessions", "concession stand", "dining",
      "dining service", "dining services", "dining attendant", "dining cashier", "food cashier", "food delivery", "meal delivery",
      "deli", "grill", "pizza", "bakery", "baker", "smoothie", "juice bar", "snack bar", "food court", "food handler",
    ],
    orgTerms: [
      "dining commons", "dining hall", "dining services", "dining service", "campus dining", "spartan eats", "dine on campus",
      "dineoncampus", "chartwells", "aramark", "sodexo", "bon appetit", "food services", "university dining",
    ],
    duties: [
      "prepare food", "preparing food", "food preparation", "food prep", "cook", "cooking", "wash dishes", "washing dishes",
      "dishwashing", "serve food", "serving food", "serve meals", "serving meals", "meal service", "food service", "kitchen",
      "catering", "food safety", "food handler", "servsafe", "bus tables", "busing tables", "clear tables", "food line",
      "deliver food", "food delivery", "operate the grill", "sanitize food", "stock food", "restock food",
    ],
  },
];

/** Titles that are plainly office, front-desk or computer work. They override a department/organisation-only signal. */
const OFFICE_TITLE = /\b(?:administrative|admin|office|front desk|receptionist|reception|clerical|clerk|records|data entry|marketing|communications|graphic|designer|social media|help ?desk|technology|technical support|computer|accounting|payroll|human resources|analyst|program assistant|operations assistant)\b/i;
const OFFICE_ABBR = /\b(?:IT|HR)\b/; // case-sensitive, so "it" in a sentence never counts

export type ExclusionResult =
  | { excluded: false }
  | { excluded: true; ruleId: string; label: string; reason: string; evidence: string[] };

export type ExclusionInput = {
  title: string;
  description?: string | null;
  department?: string | null;
  category?: string | null;
  employer?: string | null;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive, plural-tolerant, spacing/hyphen-tolerant term matcher (longest term first). */
const termRe = (terms: string[]) =>
  new RegExp(`(?<![a-z])(?:${[...terms].sort((a, b) => b.length - a.length).map((t) => esc(t.toLowerCase()).replace(/ /g, "[\\s-]+")).join("|")})(?:e?s)?(?![a-z])`, "gi");
const normalize = (s: string | null | undefined) => (s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

const compiled = new WeakMap<ExclusionRule, { work: RegExp; org: RegExp; duties: RegExp }>();
function rx(rule: ExclusionRule) {
  let c = compiled.get(rule);
  if (!c) {
    c = { work: termRe(rule.workTitles), org: termRe(rule.orgTerms), duties: termRe(rule.duties) };
    compiled.set(rule, c);
  }
  return c;
}
const hits = (re: RegExp, text: string) => [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase().replace(/[\s-]+/g, " ")))];

/** Whether a posting is excluded, by which rule and on what evidence. Pure and deterministic. */
export function evaluateExclusion(job: ExclusionInput, rules: ExclusionRule[] = EXCLUSION_RULES): ExclusionResult {
  const title = normalize(job.title);
  const duties = normalize(job.description);
  const context = normalize([job.department, job.category, job.employer].filter(Boolean).join(" · "));
  const officeTitle = OFFICE_TITLE.test(title) || OFFICE_ABBR.test(title);

  for (const rule of rules) {
    const r = rx(rule);
    const titleOrg = hits(r.org, title);
    const titleWork = hits(r.work, title);
    const dutyHits = hits(r.duties, duties);
    const contextOrg = [...new Set([...hits(r.org, context), ...hits(r.work, context)])];
    const out = (reason: string, evidence: string[]): ExclusionResult => ({ excluded: true, ruleId: rule.id, label: rule.label, reason, evidence });
    const named = rule.label.toLowerCase();

    // 1. The title names the work itself ("Line Cook", "Barista", "Dining Service Attendant"). Next to an office title,
    //    an organisation name ("Dining Services Office Assistant") is the employer, not the work, so it is weighed in step 3.
    const work = officeTitle ? titleWork.filter((w) => !titleOrg.some((o) => o.includes(w)) && !/^dining(?: services?)?$/.test(w)) : titleWork;
    if (work.length) return out(`The title names ${named} work (“${work[0]}”).`, [`title: ${job.title}`]);
    // 2. The duties ARE the work, whatever the title says. Two distinct duty phrases, or three for an office title, so a
    //    front-desk job that mentions "catering orders" once is not excluded.
    if (dutyHits.length >= (officeTitle ? 3 : 2)) return out(`The duties describe ${named} work (${dutyHits.slice(0, 3).map((d) => `“${d}”`).join(", ")}).`, dutyHits.slice(0, 5).map((d) => `duties: ${d}`));
    // 3. A dining organisation in the title or department/employer, and the title is not office or computer work.
    const org = [...titleOrg, ...titleWork, ...contextOrg];
    if (org.length && !officeTitle) return out(`It is posted by a ${named} operation (“${org[0]}”) and its title is not office or computer work.`, org.map((o) => `employer/department: ${o}`));
  }
  return { excluded: false };
}

/** The value stored in jobs.excluded_reason: "<rule id>: <reason>", or null when nothing excludes the job. */
export function exclusionColumn(job: ExclusionInput, rules: ExclusionRule[] = EXCLUSION_RULES): string | null {
  const r = evaluateExclusion(job, rules);
  return r.excluded ? `${r.ruleId}: ${r.reason}`.slice(0, 300) : null;
}

/**
 * Campus postings that are STAFF jobs, not student employment: a director / manager / faculty title, or pay stated per
 * year. They are kept with a "staff:" reason (so they never look closed) and hidden like any other exclusion. Student
 * titles that merely contain "assistant" or "coordinator" are not staff by this test.
 */
const STAFF_TITLE = /\b(?:director|manager|dean|faculty|professor|lecturer|vice president|chief)\b/i;
export function staffReason(title: string, payUnit: string | null | undefined): string | null {
  const m = STAFF_TITLE.exec(title);
  // "Student Manager" is a student job; "Assistant Director, Student Union Programming" is not.
  const studentRole = /\bstudent\s+(?:manager|director|lead|supervisor|assistant|worker|employee)\b/i.test(title);
  if (m && !studentRole) return `staff: The title names a staff position (“${m[0]}”), not student employment.`;
  if (payUnit === "year" && !studentRole) return "staff: The pay is stated as an annual salary, which marks a staff position, not student employment.";
  return null;
}

/** The rule id from a stored excluded_reason ("dining: …" → "dining"). */
export const exclusionRuleOf = (stored: string | null | undefined) => (stored ? stored.split(":")[0] : null);

/** What the server answers (409) when asked to tailor or prepare an application for an excluded job. */
export const excludedMessage = (stored: string) =>
  `This job is excluded by FRIDAY's job-search rules (${stored.replace(/^[a-z_]+:\s*/, "")}). FRIDAY does not tailor resumes or prepare applications for it.`;
