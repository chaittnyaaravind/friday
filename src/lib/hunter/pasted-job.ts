/**
 * A job the student pasted into the FRIDAY Telegram chat → an import. Pure.
 *
 * Handshake needs the student's own login and forbids automated collection, so FRIDAY never opens Handshake: the
 * student copies the job's text (and, if they like, its link) from Handshake and pastes it here. Everything kept is
 * what they pasted; the title and employer are read from its first lines and shown back so a misread is visible.
 */
import { JOB_LINK, ON_CAMPUS, PAY } from "./handshake-mail";

export type PastedJob = { url: string; title: string; employer: string | null; onCampus: boolean; payText: string | null; description: string };
export type PasteResult = { job: PastedJob } | { error: "link_only" | "no_title" } | null;

/** Long enough to be a job description rather than a chat message. */
export const MIN_PASTE = 200;

const HANDSHAKE_LINK = new RegExp(JOB_LINK.source.slice(1), "gi");
const ANY_LINK = /https?:\/\/[^\s<>"')]+/gi;
const LABEL = (names: string) => new RegExp(`^(?:${names})\\s*[:\\-–]\\s*(.{2,150})$`, "i");
const TITLE_LABEL = LABEL("job title|title|position|role");
const EMPLOYER_LABEL = LABEL("employer|department|company|organization");
// Handshake's own page furniture and metadata lines: never the title or the employer.
const FURNITURE = /^(?:save|saved|apply|apply now|apply externally|share|more|message|report|follow|following|at a glance|job description|about the job|about|details|what they're looking for|job details|paid|unpaid|on[- ]site|onsite|remote|hybrid|in[- ]person|part[- ]time|full[- ]time|internship|job|on campus student employment|work study|federal work study)$/i;
const META = /^(?:posted\b|apply by\b|deadline\b|starts?\b|ends?\b|\d+\s+(?:applicants?|days?|hours?)\b)|\b(?:ago|applicants?)$|^[A-Za-z .'-]+,\s*[A-Z]{2}\b|·|•|\|/i;
const CAMPUS_EMPLOYER = /\bsan jos[eé] state\b|\bsjsu\b|\bassociated students\b|\bspartan shops\b|\bstudent union\b|\buniversity (?:housing|library)\b|\bking library\b|\bspartan recreation\b|\btower foundation\b/i;
const ROLE_WORD = /\b(?:assistant|clerk|technician|tutor|aide|coordinator|associate|intern|worker|desk|attendant|ambassador|lead|specialist)\b/i;

function stableId(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.slice(0, 2000).toLowerCase().replace(/\s+/g, " ")) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(36);
}

export function parsePastedJob(raw: string): PasteResult {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  const handshake = [...text.matchAll(HANDSHAKE_LINK)][0];
  const links = text.match(ANY_LINK) ?? [];
  const withoutLinks = text.replace(ANY_LINK, " ").trim();
  if (withoutLinks.length < MIN_PASTE) return handshake ? { error: "link_only" } : null;

  const lines = withoutLinks.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let title = lines.map((l) => TITLE_LABEL.exec(l)?.[1]).find(Boolean)?.trim() ?? null;
  let employer = lines.map((l) => EMPLOYER_LABEL.exec(l)?.[1]).find(Boolean)?.trim() ?? null;
  // The page's first lines: employer and title, in either order, among furniture and metadata.
  const head = lines.slice(0, 10).filter((l) => l.length >= 3 && l.length <= 120 && !FURNITURE.test(l) && !META.test(l) && !PAY.test(l));
  employer ??= head.find((l) => CAMPUS_EMPLOYER.test(l) && !ROLE_WORD.test(l)) ?? null;
  title ??= head.find((l) => l !== employer) ?? null;
  if (!title) return { error: "no_title" };

  const payText = lines.find((l) => PAY.test(l))?.match(PAY)?.[0] ?? null;
  // A Handshake job link is the link to open; otherwise a pasted application link (e.g. a Google Form); otherwise
  // Handshake's job search, with a fragment so two pasted jobs are never the same source.
  const url = handshake
    ? `https://app.joinhandshake.com/jobs/${handshake[1]}`
    : links.find((l) => !/joinhandshake\.com/i.test(l)) ?? `https://app.joinhandshake.com/job-search#pasted-${stableId(withoutLinks)}`;
  return {
    job: {
      url,
      title: title.slice(0, 200),
      employer: employer?.slice(0, 120) ?? null,
      onCampus: ON_CAMPUS.test(text) || Boolean(employer && CAMPUS_EMPLOYER.test(employer)),
      payText,
      description: withoutLinks.slice(0, 60_000),
    },
  };
}
