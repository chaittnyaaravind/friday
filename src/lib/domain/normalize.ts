/**
 * Normalization shared by every discovery source: classify a posting, decide if it
 * is student-relevant, parse pay, clean HTML, and build the cross-source dedupe key.
 */

export type EmploymentType = "internship" | "on_campus" | "part_time" | "full_time" | "research" | "co_op";

export const CATEGORIES = [
  "Software Engineering", "Full Stack", "Backend", "Frontend", "AI/ML", "Data Science",
  "Data Engineering", "Cybersecurity", "Cloud", "DevOps", "Mobile", "QA/SDET", "Embedded",
  "Research", "Product/Technical",
] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_RULES: [Category, RegExp][] = [
  ["QA/SDET", /\b(?:qa|sdet|quality assurance|test(?:ing)? engineer|software test|validation engineer|verification engineer)\b/i],
  ["Cybersecurity", /\b(?:security|cyber|infosec|appsec|offensive|threat|detection and response|red team)\b/i],
  ["Embedded", /\b(?:embedded|firmware|hardware|asic|fpga|silicon|soc|chip|rtl|circuit|analog|layout|board design|robotics)\b/i],
  ["Mobile", /\b(?:ios|android|mobile)\b/i],
  ["AI/ML", /\b(?:machine learning|ml|ai|artificial intelligence|deep learning|llm|nlp|computer vision|perception|genai|research scientist)\b/i],
  ["Data Engineering", /\bdata (?:engineer|platform|infrastructure|pipeline)/i],
  ["Data Science", /\b(?:data scien|data analy|analytics|business intelligence|quantitative|statistic|decision scien)/i],
  ["DevOps", /\b(?:devops|site reliability|sre|release engineer|build engineer|platform engineer|infrastructure engineer)\b/i],
  ["Cloud", /\b(?:cloud|aws|azure|gcp|solutions architect|kubernetes)\b/i],
  ["Frontend", /\b(?:front[- ]?end|ui engineer|web developer|react)\b/i],
  ["Backend", /\b(?:back[- ]?end|server|api|distributed systems|storage|database)\b/i],
  ["Full Stack", /\bfull[- ]?stack\b/i],
  ["Research", /\b(?:research(?:er)?|phd|scientist|lab assistant|research assistant)\b/i],
  ["Product/Technical", /\b(?:product manager|technical program|program manager|product design|ux|solutions engineer|sales engineer|technical writer|developer advocate|customer engineer)\b/i],
  ["Software Engineering", /\b(?:software|developer|engineer|swe|programmer|computer science|coding)\b/i],
];

export function classifyCategory(title: string, department = ""): Category | null {
  const text = `${title} ${department}`;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

const INTERN_RE = /\b(?:intern(?:ship)?s?|co-?op|summer (?:analyst|associate|engineer)|apprentice(?:ship)?|student (?:researcher|engineer|worker|developer))\b/i;
/** Roles aimed at people who WERE interns ("Former Intern", "(Former Summer 2026 Interns)", "Alumni intern"). */
const FORMER_INTERN_RE = /\b(?:former|ex|past|previous|alumni|alumnus)\W+(?:[\w']+\W+){0,4}?interns?(?:ships?)?\b/i;
const NEW_GRAD_RE = /\b(?:new grad(?:uate)?|university grad(?:uate)?|early career|entry[- ]level|graduate (?:engineer|program))\b/i;
const SENIOR_RE = /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|distinguished|fellow)\b/i;
const NON_TECH_RE = /\b(?:marketing|sales(?! engineer)|legal|paralegal|recruit|talent|finance|accounting|audit|payroll|hr\b|human resources|facilities|communications|public relations|event|culinary|kitchen|nurse|clinical|pharma|tax|treasury|procurement|supply chain|warehouse|driver)\b/i;
const TECH_RE = /\b(?:software|engineer(?:ing|s)?|developer|data|machine learning|deep learning|learning-based|ml\b|ai\b|computer|security|cloud|devops|sre\b|qa\b|sdet|firmware|embedded|hardware|research(?:er)?|scien(?:ce|tist)|data analyst|it\b|technical|web\b|mobile|ios\b|android|systems?|network|product|robotics|autonomous|autonomy|perception|prediction|simulation|circuit|silicon|semiconductor|asic|fpga|physics|quantitative|computer vision|mixed signal|chip|gpu)/i;

export type Relevance = {
  employmentType: EmploymentType;
  isStudentRole: boolean; // internship / co-op / new-grad / on-campus / part-time student
  isTechnical: boolean;
  isSenior: boolean;
};

export function classifyRole(title: string, opts: { onCampus?: boolean; commitment?: string } = {}): Relevance {
  const t = title;
  // "Technical Program Manager - Former Intern" is a job FOR people who used to be interns, not an internship.
  const forFormerInterns = FORMER_INTERN_RE.test(t);
  const isIntern = !forFormerInterns && (INTERN_RE.test(t) || /intern/i.test(opts.commitment ?? ""));
  const isNewGrad = NEW_GRAD_RE.test(t);
  const isSenior = SENIOR_RE.test(t) && !isIntern;
  const isResearch = /\bresearch (?:assistant|intern|aide)\b|\blab assistant\b/i.test(t);
  const partTime = /part[- ]?time/i.test(`${t} ${opts.commitment ?? ""}`);

  let employmentType: EmploymentType = "full_time";
  if (opts.onCampus) employmentType = "on_campus";
  else if (/\bco-?op\b/i.test(t)) employmentType = "co_op";
  else if (isIntern) employmentType = "internship";
  else if (isResearch) employmentType = "research";
  else if (partTime) employmentType = "part_time";

  return {
    employmentType,
    isStudentRole: Boolean(opts.onCampus) || isIntern || isNewGrad || isResearch || (partTime && !isSenior),
    isTechnical: TECH_RE.test(t) && !NON_TECH_RE.test(t),
    isSenior,
  };
}

export type PayUnit = "hour" | "week" | "month" | "year" | "semester";
const PAY_UNITS: [RegExp, PayUnit, string][] = [
  [/^(?:hours?|hrs?\.?|hourly)$/i, "hour", "/hr"],
  [/^(?:weeks?|wk\.?|weekly)$/i, "week", "/wk"],
  [/^(?:months?|mo\.?|monthly)$/i, "month", "/mo"],
  [/^(?:years?|yr\.?|yearly|annually|annual)$/i, "year", "/yr"],
  [/^(?:semesters?|terms?|quarters?)$/i, "semester", "/semester"],
];
/** A word after an amount that makes it a company figure, not pay ("$5 million in funding"). */
const NOT_PAY = /^(?:million|billion|trillion|m|b|bn|mm)$/i;
const PAY_RE = /\$\s?([\d,.]+)\s*(k)?\s*(?:(?:-|–|—|to)\s*\$?\s?([\d,.]+)\s*(k)?)?\s*(?:\/|per\s+|an?\s+|each\s+)?\s*([a-z]+\.?)?/gi;

/**
 * Parse "$45–$55/hr", "$8,000 - $9,500 / month", "$18 an hour", "$1,500 per semester", "$120K–$150K".
 * `unit` is what the text STATES; it is null when the text names none and the label ("/hr", "/mo", "/yr") is only
 * a guess from the size of the number. When a text holds several amounts, the first with a stated unit wins over a
 * bare dollar figure (a bonus, a budget). Amounts are printed exactly: $9,500 is never rounded to $10K.
 */
export function parsePay(text: string | null | undefined): { text: string; min: number | null; max: number | null; unit: PayUnit | null } | null {
  if (!text) return null;
  const num = (v?: string, k?: string) => (v ? parseFloat(v.replace(/,/g, "")) * (k ? 1000 : 1) : null);

  let fallback: { min: number; max: number } | null = null;
  for (const m of text.matchAll(PAY_RE)) {
    const word = (m[5] ?? "").trim().replace(/\.$/, ""); // "per hour." at the end of a sentence
    if (NOT_PAY.test(word)) continue;
    const min = num(m[1], m[2]);
    if (min == null || Number.isNaN(min)) continue;
    const max = num(m[3], m[4] ?? m[2]) ?? min;
    const hit = PAY_UNITS.find(([rx]) => rx.test(word));
    if (hit) return payResult(min, max, hit[1], hit[2]);
    fallback ??= { min, max };
  }
  if (!fallback) return null;
  const { min, max } = fallback;
  return payResult(min, max, null, min < 200 ? "/hr" : min < 20000 ? "/mo" : "/yr");
}

const money = (n: number) => (n >= 1000 ? (n % 1000 === 0 ? `$${n / 1000}K` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`) : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
function payResult(min: number, max: number, unit: PayUnit | null, label: string) {
  return { text: max && max !== min ? `${money(min)}–${money(max)}${label}` : `${money(min)}${label}`, min, max, unit };
}

/** Very small HTML → text for descriptions (discovery never renders remote HTML). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Cross-source dedupe key: the same role at the same company in the same city is one
 * opportunity, whether it came from Greenhouse, LinkedIn import or the company site.
 * Season/year and punctuation are normalized; requisition numbers are dropped.
 */
export function canonicalKey(companySlug: string, title: string, city: string | null, remote = false) {
  const t = title
    .toLowerCase()
    .replace(/\((?:[^)]*\d{4}[^)]*)\)/g, " ") // "(Summer 2027)"
    .replace(/\b(?:req|job)\s*#?\s*[\w-]*\d[\w-]*/g, " ")
    .replace(/\b(?:summer|fall|spring|winter)\b|\b20\d\d\b/g, " ")
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\binternship\b/g, "intern")
    .trim()
    .replace(/\s+/g, "-");
  const place = city ? city.toLowerCase().replace(/\s+/g, "-") : remote ? "remote" : "unknown";
  return `${companySlug}::${t}::${place}`;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Pull a deadline if the posting states one ("Apply by March 3, 2027", "Deadline: 2027-01-15"). */
export function parseDeadline(text: string, now = new Date()): string | null {
  const m =
    text.match(/(?:deadline|apply by|applications? (?:close|due)|closing date|open until)[:\s]*([A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (!m) return null;
  const d = new Date(m[1]);
  if (Number.isNaN(d.getTime()) || d.getTime() < now.getTime() - 86_400_000 * 365) return null;
  return d.toISOString().slice(0, 10);
}
