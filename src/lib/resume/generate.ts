/**
 * Deterministic resume generator. Input: the Candidate Profile. Output: a ResumeDoc.
 * Uses ONLY eligible facts (explicit / user_added / user_confirmed). Allowed changes are
 * cosmetic and meaning-preserving: whitespace, capitalization, date format, bullet
 * punctuation, and ordering. It never adds words, numbers, technologies or claims.
 */
import { randomId } from "./ids";
import { isEligible, type CandidateItem, type DocEntry, type DocLine, type DocSection, type DocSectionKind, type EducationData, type ExperienceData, type LinkData, type PersonalData, type ProjectData, type ResumeDoc, type SkillData, type TextData } from "./types";

// ───────────────────────── meaning-preserving normalization ─────────────────────────

const MONTHS: Record<string, string> = { jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun", jul: "Jul", aug: "Aug", sep: "Sep", sept: "Sep", oct: "Oct", nov: "Nov", dec: "Dec" };

/** "september 2025" → "Sep 2025", "present" → "Present"; anything else unchanged. */
export function normalizeDate(d: string | null | undefined): string {
  if (!d) return "";
  const t = d.trim();
  const m = t.match(/^(expected\s+)?([a-z]+)\.?\s+(\d{4})$/i);
  if (m) {
    const key = m[2].toLowerCase();
    const mon = MONTHS[key.startsWith("sept") ? "sept" : key.slice(0, 3)];
    const word = mon ?? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return `${m[1] ? "Expected " : ""}${word} ${m[3]}`;
  }
  if (/^(present|current|now|ongoing)$/i.test(t)) return "Present";
  return t;
}

export function dateRange(start: string | null, end: string | null): string {
  const s = normalizeDate(start);
  const e = normalizeDate(end);
  return s && e ? `${s} – ${e}` : s || e;
}

/**
 * Cosmetic cleanup of a sentence the user wrote: collapse whitespace, capitalize the first
 * letter, drop a trailing period (consistent bullet style), fix " ," spacing.
 * Words, numbers and names are never added, removed or replaced.
 */
export function normalizeSentence(s: string): string {
  let t = s.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  t = t.replace(/^[a-z]/, (c) => c.toUpperCase());
  t = t.replace(/\.$/, "");
  return t;
}

// ───────────────────────── build ─────────────────────────

const line = (text: string, sourceItemId: string | null): DocLine => ({ id: randomId(), text, origin: "profile", sourceItemId });

export type BuildOptions = {
  /** Section order override (tailoring). */
  order?: DocSectionKind[];
  /** Per-section item order by item id (tailoring relevance). */
  rank?: Map<string, number>;
  /** Skill names to list first (tailoring). */
  prioritySkills?: string[];
  /** Item ids to leave out (user-approved exclusions only). */
  exclude?: Set<string>;
};

const DEFAULT_ORDER: DocSectionKind[] = ["summary", "education", "experience", "projects", "skills", "coursework", "certifications", "awards", "activities"];
const TITLE: Record<DocSectionKind, string> = {
  summary: "Summary", education: "Education", experience: "Experience", projects: "Projects", skills: "Skills",
  coursework: "Relevant Coursework", certifications: "Certifications", awards: "Awards", activities: "Leadership & Activities",
};

export function buildResume(allItems: CandidateItem[], opts: BuildOptions = {}): ResumeDoc {
  const items = allItems.filter((i) => isEligible(i) && !opts.exclude?.has(i.id));
  const of = <T,>(section: CandidateItem["section"]) => {
    const list = items.filter((i) => i.section === section) as CandidateItem[];
    if (opts.rank) list.sort((a, b) => (opts.rank!.get(b.id) ?? 0) - (opts.rank!.get(a.id) ?? 0) || a.position - b.position);
    return list as unknown as (CandidateItem & { data: T })[];
  };

  const personal = of<PersonalData>("personal");
  const get = (f: PersonalData["field"]) => personal.find((p) => p.data.field === f)?.data.value ?? "";
  const links = of<LinkData>("link").map((l) => l.data.url.replace(/^https?:\/\/(www\.)?/, ""));
  const header = { name: get("name"), contact: [get("location"), get("email"), get("phone"), ...links].filter(Boolean), origin: "profile" as const };

  const sections = {} as Record<DocSectionKind, DocSection>;
  const mk = (kind: DocSectionKind): DocSection => ({ id: randomId(), kind, title: TITLE[kind], entries: [], lines: [] });

  const summary = of<TextData>("summary");
  if (summary.length) sections.summary = { ...mk("summary"), lines: summary.map((s) => line(normalizeSentence(s.data.text), s.id)) };

  const edu = of<EducationData>("education");
  if (edu.length) {
    sections.education = {
      ...mk("education"),
      entries: edu.map((e) => ({
        id: randomId(), sourceItemId: e.id, origin: "profile",
        heading: e.data.school, subheading: [e.data.degree, e.data.gpa ? `GPA: ${e.data.gpa}` : ""].filter(Boolean).join(" · "),
        meta: dateRange(e.data.start, e.data.end),
        bullets: e.data.details.map((d) => line(normalizeSentence(d), e.id)),
      })),
    };
  }

  const entries = (list: (CandidateItem & { data: ExperienceData })[]): DocEntry[] =>
    list.map((x) => ({
      id: randomId(), sourceItemId: x.id, origin: "profile",
      heading: x.data.title || x.data.organization, subheading: x.data.title ? x.data.organization : "",
      meta: [x.data.location, dateRange(x.data.start, x.data.end)].filter(Boolean).join(" · "),
      bullets: x.data.bullets.map((b) => line(normalizeSentence(b), x.id)),
    }));
  const exp = of<ExperienceData>("experience");
  if (exp.length) sections.experience = { ...mk("experience"), entries: entries(exp) };
  const act = of<ExperienceData>("activity");
  if (act.length) sections.activities = { ...mk("activities"), entries: entries(act) };

  const proj = of<ProjectData>("project");
  if (proj.length) {
    sections.projects = {
      ...mk("projects"),
      entries: proj.map((p) => ({
        id: randomId(), sourceItemId: p.id, origin: "profile",
        heading: p.data.name, subheading: p.data.technologies.join(", "), meta: normalizeDate(p.data.date),
        bullets: p.data.bullets.map((b) => line(normalizeSentence(b), p.id)),
      })),
    };
  }

  const skills = of<SkillData>("skill");
  if (skills.length) {
    const prio = new Map((opts.prioritySkills ?? []).map((s, i) => [s.toLowerCase(), i]));
    const byGroup = new Map<string, (CandidateItem & { data: SkillData })[]>();
    for (const s of skills) byGroup.set(s.data.group ?? "", [...(byGroup.get(s.data.group ?? "") ?? []), s]);
    const lines: DocLine[] = [];
    for (const [group, list] of byGroup) {
      list.sort((a, b) => (prio.get(a.data.name.toLowerCase()) ?? 999) - (prio.get(b.data.name.toLowerCase()) ?? 999));
      const names = list.map((s) => s.data.name).join(", ");
      lines.push({ id: randomId(), text: group ? `${group}: ${names}` : names, origin: "profile", sourceItemId: null });
    }
    if (prio.size) lines.sort((a, b) => minPrio(a.text, prio) - minPrio(b.text, prio));
    sections.skills = { ...mk("skills"), lines };
  }

  const cw = of<TextData>("coursework");
  if (cw.length) sections.coursework = { ...mk("coursework"), lines: [line(cw.map((c) => c.data.text.trim()).join(", "), null)] };
  for (const [section, kind] of [["certification", "certifications"], ["award", "awards"]] as const) {
    const list = of<TextData>(section);
    if (list.length) sections[kind] = { ...mk(kind), lines: list.map((t) => line(t.data.text.trim(), t.id)) };
  }

  const order = opts.order ?? DEFAULT_ORDER;
  return { version: 1, header, sections: order.filter((k) => sections[k]).map((k) => sections[k]) };
}

function minPrio(text: string, prio: Map<string, number>) {
  let best = 999;
  for (const t of text.replace(/^[^:]*:\s*/, "").split(/,\s*/)) best = Math.min(best, prio.get(t.toLowerCase()) ?? 999);
  return best;
}

/** Plain text rendering — used by compare, validation and the .txt export. */
export function docToText(doc: ResumeDoc): string {
  const out: string[] = [doc.header.name, doc.header.contact.join(" | "), ""];
  for (const s of doc.sections) {
    out.push(s.title.toUpperCase());
    for (const e of s.entries) {
      out.push([e.heading, e.subheading].filter(Boolean).join(" — ") + (e.meta ? `  (${e.meta})` : ""));
      for (const b of e.bullets) out.push(`• ${b.text}`);
    }
    for (const l of s.lines) out.push(l.text);
    out.push("");
  }
  return out.join("\n").trim();
}
