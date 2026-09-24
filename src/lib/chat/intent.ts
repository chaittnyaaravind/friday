/**
 * Local (no-AI) understanding of a chat message: what the student wants and which
 * search filters they mean. Pure and deterministic, so it can be unit-tested.
 */
import type { JobFilters } from "@/lib/data/jobs";
import { extractSkills } from "@/lib/domain/skills";

export type IntentKind =
  | "greeting" | "help" | "tailor" | "resume" | "follow_ups" | "applications" | "work_auth"
  | "skill_gap" | "profile" | "deadlines" | "companies" | "job_detail" | "search";

export type Intent = { kind: IntentKind; filters: JobFilters; jobId?: string; companyNames: string[] };
export type CompanyRef = { slug: string; name: string };

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(ai|ml|machine learning|deep learning|llm|artificial intelligence)\b/i, "AI/ML"],
  [/\bfull[\s-]?stack\b/i, "Full Stack"],
  [/\bback[\s-]?end\b/i, "Backend"],
  [/\bfront[\s-]?end\b/i, "Frontend"],
  [/\bdata scien(ce|tist)\b/i, "Data Science"],
  [/\bdata engineer/i, "Data Engineering"],
  [/\b(cyber\s?security|security)\b/i, "Cybersecurity"],
  [/\bcloud\b/i, "Cloud"],
  [/\b(devops|sre|site reliability)\b/i, "DevOps"],
  [/\b(mobile|ios|android)\b/i, "Mobile"],
  [/\b(qa|sdet|quality assurance|test engineer)\b/i, "QA/SDET"],
  [/\b(embedded|firmware|hardware)\b/i, "Embedded"],
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Companies named in the text (whole word; names of 3 letters or fewer must match case). */
export function companiesIn(text: string, companies: CompanyRef[]): CompanyRef[] {
  return companies.filter((c) => {
    if (c.name.length < 2) return false;
    const re = new RegExp(`(?<![\\w])${escape(c.name)}(?![\\w])`, c.name.length <= 3 ? "" : "i");
    return re.test(text);
  });
}

export function parseFilters(text: string, companies: CompanyRef[] = []): { filters: JobFilters; companyNames: string[] } {
  const t = text.toLowerCase();
  const f: JobFilters = { limit: 8 };

  // Where
  const nearSjsu = /\b(near|around|of|from|by|close to)\s+(sjsu|campus|san jos[eé] state)\b/.test(t);
  if (!nearSjsu && /\b(sjsu|on[\s-]?campus|campus (jobs?|work|positions?))\b/.test(t)) f.onCampus = true;
  const miles = t.match(/(\d{1,3})\s*(?:mi\b|miles?)/);
  if (miles) f.maxMiles = Number(miles[1]);
  else if (/\b(near me|nearby|close by|close to (home|me)|commut\w*|around (san jos[eé]|here)|near sjsu|around sjsu|local)\b/.test(t)) f.maxMiles = 15;
  if (f.maxMiles) f.includeRemote = false;
  if (/\bremote\b/.test(t)) f.remoteOnly = true;
  if (/\bhybrid\b/.test(t)) f.hybridOnly = true;

  // What
  const types: NonNullable<JobFilters["types"]> = [];
  if (/\bintern(ship)?s?\b/.test(t)) types.push("internship", "co_op");
  if (/\bco[\s-]?ops?\b/.test(t) && !types.includes("co_op")) types.push("co_op");
  if (/\bpart[\s-]?time\b/.test(t)) types.push("part_time");
  if (/\b(full[\s-]?time|new[\s-]?grad)\b/.test(t)) types.push("full_time");
  if (/\bresearch\b/.test(t)) types.push("research");
  if (types.length) f.types = types;
  const cats = CATEGORY_WORDS.filter(([re]) => re.test(text)).map(([, c]) => c);
  if (cats.length) f.categories = cats;
  const skills = extractSkills(text);
  if (skills.length) f.skills = skills;

  // Who
  const named = companiesIn(text, companies);
  if (named.length) f.companies = named.map((c) => c.slug);

  // When
  if (/\b(today|last 24 hours|past day)\b/.test(t)) f.postedWithinDays = 1;
  else if (/\b(this week|past week|last week|last 7 days)\b/.test(t)) f.postedWithinDays = 7;
  else if (/\b(this month|past month|last 30 days)\b/.test(t)) f.postedWithinDays = 30;
  else {
    const d = t.match(/(?:last|past)\s+(\d{1,3})\s+days?/);
    if (d) f.postedWithinDays = Number(d[1]);
    else if (/\b(new|newest|latest|recent|fresh|just posted)\b/.test(t)) f.postedWithinDays = 7;
  }

  // Order
  if (/\b(closest|nearest|nearby|near me|shortest commute)\b/.test(t)) f.sort = "distance";
  else if (/\b(deadlines?|closing soon|due soon)\b/.test(t)) f.sort = "deadline";
  else if (/\b(newest|latest|most recent|just posted)\b/.test(t)) f.sort = "new";
  else f.sort = "match";

  return { filters: f, companyNames: named.map((c) => c.name) };
}

export function parseIntent(text: string, companies: CompanyRef[] = []): Intent {
  const t = text.toLowerCase().trim();
  const { filters, companyNames } = parseFilters(text, companies);
  const id = text.match(UUID)?.[0];
  const make = (kind: IntentKind): Intent => ({ kind, filters, companyNames, ...(id ? { jobId: id } : {}) });

  if (/^(hi|hey|hello|yo|sup|hola|good (morning|afternoon|evening)|thanks|thank you|ty|ok|okay|cool)( friday)?[!. ]*$/.test(t)) return make("greeting");
  if (/\b(help|what can you do|how do you work|what do you do)\b/.test(t)) return make("help");
  if (/\btailor|customi[sz]e (my )?resume|resume for\b/.test(t)) return make("tailor");
  if (/\b(resume|cv)\b/.test(t)) return make("resume");
  if (/\b(follow[\s-]?ups?|interviews?|remind(er)?s?)\b/.test(t)) return make("follow_ups");
  if (/\b(my applications?|applications? status|applied|tracker|pipeline|where did i apply)\b/.test(t)) return make("applications");
  if (/\b(cpt|opt|f-?1|visa|sponsor(ship)?|work authori[sz]ation|international student|citizenship)\b/.test(t)) return make("work_auth");
  if (/\b(learn|missing|gaps?|qualify|improve|prepare|what should i (study|build))\b/.test(t)) return make("skill_gap");
  if (/\b(my (skills|profile|major)|what do you know about me)\b/.test(t)) return make("profile");
  if (id) return make("job_detail");
  if (/\b(deadlines?|due|closing)\b/.test(t)) return make("deadlines");
  if (/\b(compan(y|ies)|employers|who('?s| is) hiring)\b/.test(t)) return make("companies");
  return make("search");
}

/** Leftover words when no structured filter applies — used as a keyword search. */
export function keywords(text: string): string {
  const STOP = /\b(find|show|me|my|get|list|any|some|all|the|a|an|for|in|at|of|to|with|jobs?|roles?|positions?|openings?|opportunit(y|ies)|please|can|you|i|want|need|looking|search|are|there|what|which|is|hiring|around|near|san jose|bay area|silicon valley)\b/gi;
  return text.replace(STOP, " ").replace(/[^\w+#.\s-]/g, " ").replace(/\s+/g, " ").trim();
}

/** True when the parser found at least one structured filter. */
export function hasStructure(f: JobFilters): boolean {
  return Boolean(f.types || f.categories || f.skills || f.companies || f.onCampus !== undefined || f.maxMiles || f.remoteOnly || f.hybridOnly || f.postedWithinDays || f.deadlineWithinDays);
}

/** Discover-page URL for the same filters, so the student can keep browsing. */
export function discoverHref(f: JobFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.types?.length) p.set("type", f.types.join(","));
  if (f.categories?.length) p.set("category", f.categories.join(","));
  if (f.onCampus !== undefined) p.set("campus", f.onCampus ? "1" : "0");
  if (f.maxMiles) p.set("miles", String(f.maxMiles));
  if (f.includeRemote === false) p.set("includeRemote", "0");
  if (f.remoteOnly) p.set("remote", "1");
  if (f.companies?.length) p.set("company", f.companies.join(","));
  if (f.postedWithinDays) p.set("posted", String(f.postedWithinDays));
  if (f.deadlineWithinDays) p.set("deadline", String(f.deadlineWithinDays));
  if (f.skills?.length) p.set("skills", f.skills.join(","));
  if (f.sort && f.sort !== "match") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `/discover?${s}` : "/discover";
}
