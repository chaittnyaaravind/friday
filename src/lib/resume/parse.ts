/**
 * Deterministic resume parser — no AI. Turns resume text into facts, each with the
 * exact source line it came from. Rules:
 *  - Only text that is literally present becomes a fact.
 *  - A field assignment we're unsure about (e.g. which part is the title) is marked
 *    `requires_confirmation`; it never enters a resume until the user confirms it.
 *  - Text in a section we can't identify goes to `other` (Uncategorized), never guessed.
 */
import { SKILLS } from "@/lib/domain/skills";
import type { EducationData, ExperienceData, ParsedFact, ProjectData, Section } from "./types";

// ───────────────────────── line model ─────────────────────────

const BULLET_RE = /^\s*(?:[•·▪‣◦●■►▶➢✓\-*–—]|\d+[.)])\s+/;
export type Line = { text: string; bullet: boolean };

/** Normalize raw extracted text into trimmed lines, joining wrapped bullet continuations. */
export function toLines(raw: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of raw.replace(/\r/g, "").split("\n")) {
    const t = rawLine.replace(/\t+/g, "  ").replace(/[  ]{2,}/g, "  ").trim();
    if (!t) continue;
    const bullet = BULLET_RE.test(t);
    const text = bullet ? t.replace(BULLET_RE, "").trim() : t;
    const prev = out[out.length - 1];
    // A wrapped line of a bullet starts lowercase and isn't a heading/bullet itself.
    if (prev?.bullet && !bullet && /^[a-z(]/.test(text)) {
      prev.text = `${prev.text} ${text}`;
      continue;
    }
    if (text) out.push({ text, bullet });
  }
  return out;
}

// ───────────────────────── headings ─────────────────────────

const HEADINGS: [Section, RegExp][] = [
  ["summary", /^(?:professional\s+)?(?:summary|profile|objective|about(?:\s+me)?)$/],
  ["education", /^(?:education|academic background|academics|education\s*(?:&|and)\s*coursework)$/],
  ["experience", /^(?:(?:work|professional|relevant|employment|industry|technical|internship)\s+)?(?:experience|employment|work history|internships?)$/],
  ["project", /^(?:(?:technical|personal|academic|selected|software|relevant|course|side)\s+)?projects?$/],
  ["skill", /^(?:(?:technical|core|relevant|key|computer|programming)\s+)?(?:skills|technologies|technical proficiencies|tools)(?:\s*(?:&|and)\s*(?:tools|technologies|interests|languages))?$/],
  ["certification", /^(?:certifications?|licenses?(?:\s*(?:&|and)\s*certifications?)?|certificates?)$/],
  ["award", /^(?:awards?|honors?|awards?\s*(?:&|and)\s*honors?|honors?\s*(?:&|and)\s*awards?|achievements|scholarships?)$/],
  ["coursework", /^(?:relevant\s+)?coursework$/],
  ["activity", /^(?:activities|leadership|involvement|extracurriculars?|campus involvement|volunteer(?:ing)?(?:\s+experience)?|leadership\s*(?:&|and)\s*(?:activities|involvement)|activities\s*(?:&|and)\s*leadership)$/],
  ["link", /^(?:links|profiles|online presence)$/],
];

function headingOf(line: Line): { section: Section; label: string } | null {
  if (line.bullet) return null;
  const label = line.text.replace(/[:：]\s*$/, "").trim();
  const norm = label.toLowerCase().replace(/\s+/g, " ");
  if (norm.length > 48) return null;
  for (const [section, re] of HEADINGS) if (re.test(norm)) return { section, label };
  // Unknown ALL-CAPS short line with no digits/contact → an unrecognized section.
  const words = label.split(/\s+/);
  if (words.length <= 4 && /^[A-Z][A-Z &/'-]+$/.test(label) && label.length >= 4) return { section: "other", label };
  return null;
}

// ───────────────────────── dates & fields ─────────────────────────

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const DATE = `(?:(?:${MONTH}|${SEASON})\\s+\\d{4}|\\d{1,2}/\\d{4}|\\d{4})`;
const END = `(?:${DATE}|present|current|now|ongoing)`;
const RANGE_RE = new RegExp(`((?:expected|exp\\.?|anticipated)\\s+)?(${DATE})(?:\\s*(?:-|–|—|to)\\s*(${END}))?\\s*$`, "i");

/** Pull a trailing date/range off a header line. */
export function splitDates(text: string): { rest: string; start: string | null; end: string | null } {
  const m = text.match(RANGE_RE);
  if (!m || m.index === undefined) return { rest: text, start: null, end: null };
  const rest = text.slice(0, m.index).replace(/[\s,|–—-]+$/, "").trim();
  if (!rest && !m[3]) return { rest: text, start: null, end: null };
  if (m[1] && !m[3]) return { rest, start: null, end: `Expected ${m[2]}` };
  return { rest, start: m[3] ? m[2] : null, end: m[3] ?? m[2] };
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
// Real domains only — "Node.js" or "ASP.NET" must never become a link.
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:[\w-]+\.)+(?:com|org|net|io|dev|app|me|co|edu|ai|us|xyz|site|tech|page|so|gg|ly|sh|cc)(?![a-z])(?:\/[\w\-./?=&%#~]*)?/i;
const LOCATION_RE = /^[A-Z][A-Za-zÀ-ÿ.' -]+,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)$/;
const TITLE_WORDS = /\b(?:intern(?:ship)?|engineer(?:ing)?|developer|assistant|analyst|tutor|researcher|research|lead|manager|specialist|coordinator|associate|student|teaching|volunteer|president|vice president|officer|member|fellow|scientist|designer|consultant|technician|administrator|mentor|ambassador|representative|director|founder|co-founder|treasurer|secretary|captain|instructor|cashier|clerk|worker|staff|grader|reader)\b/i;
const SCHOOL_WORDS = /\b(?:university|college|institute|school|academy|polytechnic|community college)\b/i;
const DEGREE_RE = /\b(?:B\.?\s?S\.?|B\.?\s?A\.?|M\.?\s?S\.?|M\.?\s?A\.?|Ph\.?\s?D\.?|MBA|A\.?\s?A\.?|A\.?\s?S\.?|B\.?\s?Eng|M\.?\s?Eng|Bachelor(?:'s)?|Master(?:'s)?|Associate(?:'s)?|Doctor(?:ate)?|Minor|Major|High School Diploma)\b/i;
const GPA_RE = /\bGPA\s*[:\-]?\s*(\d\.\d{1,2})(?:\s*\/\s*4\.0{1,2})?/i;

// ───────────────────────── skill mentions (surface forms only) ─────────────────────────

const UNSAFE = new Set(["c", "r", "go", "rest", "ts", "js", "node", "spark", "security", "rails", "embedded", "ml", "unix", "excel", "express", "spring", "containers", "monitoring", "encryption", "probability", "kernel", "iac"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MENTION: { re: RegExp }[] = SKILLS.flatMap((k) =>
  [...new Set(k.aliases)].filter((a) => !UNSAFE.has(a) && a.length > 1).map((a) => ({ re: new RegExp(`(?<![A-Za-z0-9+#])${esc(a)}(?![A-Za-z0-9+#])`, "i") })),
);
/** Technologies literally written in a sentence, returned exactly as written. */
export function skillMentions(text: string): string[] {
  const found = new Map<string, string>();
  for (const { re } of MENTION) {
    const m = text.match(re);
    if (m) found.set(m[0].toLowerCase(), m[0]);
  }
  // Drop a mention contained in a longer one ("React" inside "React Native").
  const all = [...found.values()];
  return all.filter((s) => !all.some((o) => o !== s && o.toLowerCase().includes(s.toLowerCase()) && o.length > s.length));
}

/** Split a comma/semicolon/pipe/bullet list, keeping "C/C++" and "Node.js" intact. */
export function splitList(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\||•|·|\s{2,})\s*/)
    .map((s) => s.replace(/^(?:and|&)\s+/i, "").replace(/[.]+$/, "").trim())
    .filter((s) => s.length > 0 && s.length <= 40);
}

// ───────────────────────── parse ─────────────────────────

export type ParseResult = { facts: ParsedFact[]; unknownHeadings: string[] };

type Block = { section: Section; label: string; lines: Line[] };

export function parseResumeText(raw: string): ParseResult {
  const lines = toLines(raw);
  const blocks: Block[] = [{ section: "personal", label: "Header", lines: [] }];
  for (const line of lines) {
    const h = headingOf(line);
    if (h) blocks.push({ section: h.section, label: h.label, lines: [] });
    else blocks[blocks.length - 1].lines.push(line);
  }

  const facts: ParsedFact[] = [];
  const unknownHeadings: string[] = [];
  for (const b of blocks) {
    switch (b.section) {
      case "personal": facts.push(...parseHeader(b.lines)); break;
      case "summary":
        if (b.lines.length) facts.push({ section: "summary", data: { text: b.lines.map((l) => l.text).join(" ") }, sourceText: b.lines.map((l) => l.text).join("\n"), status: "explicit" });
        break;
      case "education": facts.push(...parseEducation(b.lines)); break;
      case "experience": facts.push(...parseEntries(b.lines, "experience")); break;
      case "activity": facts.push(...parseEntries(b.lines, "activity")); break;
      case "project": facts.push(...parseProjects(b.lines)); break;
      case "skill": facts.push(...parseSkills(b.lines)); break;
      case "coursework": for (const l of b.lines) for (const c of splitList(l.text.replace(/^[^:]*coursework\s*:\s*/i, ""))) facts.push({ section: "coursework", data: { text: c }, sourceText: l.text, status: "explicit" }); break;
      case "certification": case "award":
        for (const l of b.lines) facts.push({ section: b.section, data: { text: l.text }, sourceText: l.text, status: "explicit" });
        break;
      case "link":
        for (const l of b.lines) for (const u of l.text.match(new RegExp(URL_RE, "gi")) ?? []) facts.push({ section: "link", data: linkOf(u), sourceText: l.text, status: "explicit" });
        break;
      default:
        unknownHeadings.push(b.label);
        for (const l of b.lines) facts.push({ section: "other", data: { text: l.text, group: b.label }, sourceText: l.text, status: "requires_confirmation", note: `FRIDAY didn't recognize the “${b.label}” section.` });
    }
  }

  // Technologies mentioned in bullets/projects but not listed under Skills → ask, never assume.
  const listed = new Set(facts.filter((f) => f.section === "skill").map((f) => norm((f.data as { name: string }).name)));
  for (const f of facts) {
    const texts: string[] =
      f.section === "experience" || f.section === "activity" ? (f.data as ExperienceData).bullets
      : f.section === "project" ? [(f.data as ProjectData).technologies.join(", "), ...(f.data as ProjectData).bullets]
      : [];
    for (const t of texts) {
      for (const s of skillMentions(t)) {
        if (listed.has(norm(s))) continue;
        listed.add(norm(s));
        facts.push({ section: "skill", data: { name: s, group: null }, sourceText: t, status: "requires_confirmation", note: "Mentioned in your resume but not listed under Skills." });
      }
    }
  }
  return { facts, unknownHeadings };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

function linkOf(url: string) {
  const u = url.replace(/[),.;]+$/, "");
  const label = /linkedin/i.test(u) ? "LinkedIn" : /github/i.test(u) ? "GitHub" : "Portfolio";
  return { label, url: u };
}

function parseHeader(lines: Line[]): ParsedFact[] {
  const facts: ParsedFact[] = [];
  let named = false;
  for (const l of lines) {
    const tokens = l.text.split(/\s*(?:\||•|·|\s{2,}|\t)\s*/).map((t) => t.trim()).filter(Boolean);
    for (const t of tokens) {
      if (!named && /^[A-Za-zÀ-ÿ'.-]+(?:\s+[A-Za-zÀ-ÿ'.-]+){1,3}$/.test(t) && !/\d|@/.test(t) && !LOCATION_RE.test(t)) {
        facts.push({ section: "personal", data: { field: "name", value: t }, sourceText: l.text, status: "explicit" });
        named = true;
      } else if (EMAIL_RE.test(t)) facts.push({ section: "personal", data: { field: "email", value: t.match(EMAIL_RE)![0] }, sourceText: l.text, status: "explicit" });
      else if (PHONE_RE.test(t) && t.replace(/\D/g, "").length >= 10) facts.push({ section: "personal", data: { field: "phone", value: t.match(PHONE_RE)![0] }, sourceText: l.text, status: "explicit" });
      else if (URL_RE.test(t) && !/\s/.test(t)) facts.push({ section: "link", data: linkOf(t), sourceText: l.text, status: "explicit" });
      else if (LOCATION_RE.test(t)) facts.push({ section: "personal", data: { field: "location", value: t }, sourceText: l.text, status: "explicit" });
      else facts.push({ section: "other", data: { text: t, group: "Header" }, sourceText: l.text, status: "requires_confirmation", note: "Text near your name that FRIDAY couldn't classify." });
    }
  }
  return facts;
}

function parseEducation(lines: Line[]): ParsedFact[] {
  const facts: ParsedFact[] = [];
  let cur: { data: EducationData; src: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    facts.push({ section: "education", data: cur.data, sourceText: cur.src.join("\n"), status: cur.data.school ? "explicit" : "requires_confirmation", note: cur.data.school ? undefined : "FRIDAY couldn't tell which line is the school." });
    cur = null;
  };
  for (const l of lines) {
    const cw = l.text.match(/^(?:relevant\s+)?coursework\s*:\s*(.+)$/i);
    if (cw) {
      for (const c of splitList(cw[1])) facts.push({ section: "coursework", data: { text: c }, sourceText: l.text, status: "explicit" });
      continue;
    }
    if (l.bullet) {
      if (cur) { cur.data.details.push(l.text); cur.src.push(l.text); }
      else facts.push({ section: "other", data: { text: l.text, group: "Education" }, sourceText: l.text, status: "requires_confirmation", note: "Not attached to a school." });
      continue;
    }
    const { rest, start, end } = splitDates(l.text);
    const gpa = rest.match(GPA_RE)?.[1] ?? null;
    const body = rest.replace(GPA_RE, "").replace(/[\s·|,–—-]+$/, "").trim();
    if (SCHOOL_WORDS.test(body) && !(cur && !cur.data.school)) {
      flush();
      cur = { data: { school: body, degree: null, start, end, gpa, details: [] }, src: [l.text] };
    } else if (cur && DEGREE_RE.test(body) && !cur.data.degree) {
      cur.data.degree = body;
      cur.data.gpa ??= gpa;
      cur.data.start ??= start;
      cur.data.end ??= end;
      cur.src.push(l.text);
    } else if (!cur && DEGREE_RE.test(body)) {
      cur = { data: { school: "", degree: body, start, end, gpa, details: [] }, src: [l.text] };
    } else if (cur && !cur.data.school && SCHOOL_WORDS.test(body)) {
      cur.data.school = body;
      cur.src.push(l.text);
    } else if (cur) {
      if (gpa) cur.data.gpa ??= gpa;
      if (body) cur.data.details.push(body);
      cur.src.push(l.text);
    } else {
      facts.push({ section: "other", data: { text: l.text, group: "Education" }, sourceText: l.text, status: "requires_confirmation", note: "FRIDAY couldn't match this to a school." });
    }
  }
  flush();
  return facts;
}

/** Experience/activities: header lines (1–2, non-bullet) followed by bullets. */
function parseEntries(lines: Line[], section: "experience" | "activity"): ParsedFact[] {
  const facts: ParsedFact[] = [];
  type Cur = { header: string[]; bullets: string[] };
  let cur: Cur | null = null;
  const flush = () => {
    if (!cur) return;
    facts.push(buildEntry(cur.header, cur.bullets, section));
    cur = null;
  };
  for (const l of lines) {
    if (l.bullet) {
      if (!cur) cur = { header: [], bullets: [] };
      cur.bullets.push(l.text);
    } else if (cur && cur.bullets.length === 0 && cur.header.length < 2) {
      cur.header.push(l.text);
    } else {
      flush();
      cur = { header: [l.text], bullets: [] };
    }
  }
  flush();
  return facts;
}

function buildEntry(header: string[], bullets: string[], section: "experience" | "activity"): ParsedFact {
  let start: string | null = null;
  let end: string | null = null;
  let location: string | null = null;
  const parts: string[] = [];
  for (const h of header) {
    const d = splitDates(h);
    if (d.start || d.end) ({ start, end } = { start: d.start ?? start, end: d.end ?? end });
    for (const p of d.rest.split(/\s*(?:\||—|–|\s-\s|\s{2,}|,\s(?=[A-Z][a-z]+,\s*[A-Z]{2}$)| at |@)\s*/)) {
      const t = p.trim();
      if (!t) continue;
      if (LOCATION_RE.test(t) || /^(?:remote|hybrid|on-?site)$/i.test(t)) location = t;
      else parts.push(t);
    }
  }
  // "Title, Organization" on one line.
  if (parts.length === 1 && parts[0].includes(", ")) {
    const [a, ...b] = parts[0].split(", ");
    parts.splice(0, 1, a, b.join(", "));
  }
  const titleIdx = parts.findIndex((p) => TITLE_WORDS.test(p));
  let title = "";
  let organization = "";
  let confident = false;
  if (parts.length >= 2 && titleIdx >= 0 && parts.filter((p) => TITLE_WORDS.test(p)).length === 1) {
    title = parts[titleIdx];
    organization = parts.filter((_, i) => i !== titleIdx).join(", ");
    confident = true;
  } else if (parts.length >= 2) {
    [title, organization] = [parts[0], parts.slice(1).join(", ")];
  } else if (parts.length === 1) {
    if (TITLE_WORDS.test(parts[0])) title = parts[0];
    else organization = parts[0];
  }
  const data: ExperienceData = { title, organization, location, start, end, bullets };
  return {
    section,
    data,
    sourceText: [...header, ...bullets.map((b) => `• ${b}`)].join("\n"),
    status: confident ? "explicit" : "requires_confirmation",
    note: confident ? undefined : "Please check which part is the job title and which is the organization.",
  };
}

function parseProjects(lines: Line[]): ParsedFact[] {
  const facts: ParsedFact[] = [];
  let cur: { data: ProjectData; src: string[] } | null = null;
  const flush = () => {
    if (cur) facts.push({ section: "project", data: cur.data, sourceText: cur.src.join("\n"), status: "explicit" });
    cur = null;
  };
  for (const l of lines) {
    const tech = l.text.match(/^(?:tech(?:nologies)?|stack|tools|built with)\s*:\s*(.+)$/i);
    if (tech && cur) {
      cur.data.technologies.push(...splitList(tech[1]));
      cur.src.push(l.text);
      continue;
    }
    if (l.bullet && cur) {
      cur.data.bullets.push(l.text);
      cur.src.push(`• ${l.text}`);
      continue;
    }
    if (l.bullet && !cur) {
      facts.push({ section: "other", data: { text: l.text, group: "Projects" }, sourceText: l.text, status: "requires_confirmation", note: "Not attached to a project name." });
      continue;
    }
    flush();
    const d = splitDates(l.text);
    const url = d.rest.match(URL_RE)?.[0] ?? null;
    const withoutUrl = url ? d.rest.replace(url, "").trim() : d.rest;
    const m = withoutUrl.match(/^(.+?)\s*(?:\||—|–|\s-\s|:)\s*(.+)$/) ?? withoutUrl.match(/^(.+?)\s*\((.+)\)\s*$/);
    cur = {
      data: { name: (m ? m[1] : withoutUrl).trim(), technologies: m ? splitList(m[2]) : [], date: d.end ?? null, link: url, bullets: [] },
      src: [l.text],
    };
  }
  flush();
  return facts;
}

function parseSkills(lines: Line[]): ParsedFact[] {
  const facts: ParsedFact[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const m = l.text.match(/^([A-Za-z &/+-]{2,40})\s*:\s*(.+)$/);
    const group = m ? m[1].trim() : null;
    for (const name of splitList(m ? m[2] : l.text)) {
      if (seen.has(norm(name))) continue;
      seen.add(norm(name));
      facts.push({ section: "skill", data: { name, group }, sourceText: l.text, status: "explicit" });
    }
  }
  return facts;
}
