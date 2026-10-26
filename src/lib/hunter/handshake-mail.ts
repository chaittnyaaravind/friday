/**
 * Handshake job-alert emails → listings. Pure.
 *
 * These are emails Handshake sent to the student, delivered by the student's own Gmail bridge. FRIDAY never visits
 * Handshake: it keeps the job's title, employer and link exactly as the email states them, and the student opens the
 * link to read and apply.
 *
 * Two shapes are read:
 *   1. Job cards (the REAL format, verified on a saved-search alert from 2026-10-21): each job is one link whose content
 *      is <span class="job-list-employer">, <span class="job-list-title"> and <span class="job-list-meta"> ("$18.45/hr •
 *      On Campus Student Employment • San Jose, CA (Onsite)"). The link is Handshake's click-tracking redirect on
 *      email.*.joinhandshake.com: it is kept as the link the student taps, and never followed by FRIDAY.
 *   2. Direct job links (an id in the path, e.g. app.joinhandshake.com/jobs/123), for older or other templates.
 * Profile, event, settings and unsubscribe links are never jobs.
 */
import { htmlToText } from "@/lib/domain/normalize";

export type HandshakeJob = { handshakeId: string; url: string; title: string; employer: string | null; onCampus: boolean; payText: string | null; meta: string | null };

export const JOB_LINK = /^https?:\/\/(?:[a-z0-9-]+\.)*joinhandshake\.com\/(?:stu\/|e\/\d+\/)?(?:jobs|job-search|postings)\/(\d{4,12})\b/i;
const GENERIC = /^(?:view(?: (?:job|details|posting|all))?|apply(?: now)?|see (?:job|more|details)|learn more|details|open|here|click here)$/i;
const ANCHOR = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const clean = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();

export function isHandshakeSender(from: string): boolean {
  return /@(?:[a-z0-9-]+\.)*joinhandshake\.com>?\s*$/i.test(from.trim());
}

const TRACKING = /^https:\/\/(?:[a-z0-9-]+\.)*joinhandshake\.com\/c\/[A-Za-z0-9_-]{8,}/i;
const span = (inner: string, cls: string) => {
  const m = new RegExp(`<span[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/span>`, "i").exec(inner);
  return m ? clean(m[1]) : "";
};
export const ON_CAMPUS = /\bon[- ]campus\b|\bsan jos[eé] state\b|\bsjsu\b/i;
export const PAY = /^\$[\d.,]+(?:\s*[–-]\s*\$?[\d.,]+)?\s*\/\s*(?:hr|hour|yr|year)\b|^up to \$[\d.,]+\s*\/\s*(?:hr|hour)\b/i;

/** A stable id for a card whose link hides the job id: the same job in two emails gets the same id. */
function cardId(employer: string, title: string, meta: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${employer}|${title}|${meta}`.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `card-${h.toString(36)}`;
}

/** Shape 1: Handshake's job cards. */
function parseCards(html: string): HandshakeJob[] {
  const out = new Map<string, HandshakeJob>();
  for (const m of html.matchAll(ANCHOR)) {
    const inner = m[2];
    const title = span(inner, "job-list-title");
    if (!title || title.length < 3 || title.length > 150) continue;
    const href = m[1].replace(/&amp;/g, "&");
    const direct = JOB_LINK.exec(href)?.[1];
    if (!direct && !TRACKING.test(href)) continue; // only Handshake's own links
    const employer = span(inner, "job-list-employer") || null;
    const meta = span(inner, "job-list-meta") || null;
    const parts = (meta ?? "").split(/\s*[•·]\s*/).map((x) => x.trim()).filter(Boolean);
    const payText = parts.find((x) => PAY.test(x)) ?? null;
    const id = direct ?? cardId(employer ?? "", title, meta ?? "");
    if (out.has(id)) continue;
    out.set(id, {
      handshakeId: id,
      url: direct ? `https://app.joinhandshake.com/jobs/${direct}` : href,
      title,
      employer,
      // "On Campus Student Employment" is Handshake's own label; an SJSU employer counts too.
      onCampus: ON_CAMPUS.test(`${employer ?? ""} ${meta ?? ""}`),
      payText,
      meta,
    });
  }
  return [...out.values()];
}

export function parseHandshakeAlert(html: string): HandshakeJob[] {
  const cards = parseCards(html);
  if (cards.length) return cards.slice(0, 25);
  const found = new Map<string, HandshakeJob>();
  const anchors = [...html.matchAll(ANCHOR)];
  anchors.forEach((m, i) => {
    const href = m[1].replace(/&amp;/g, "&");
    const id = JOB_LINK.exec(href)?.[1];
    if (!id) return;
    if (found.has(id)) return; // the first card for a job (its title link) wins over its "View job" button
    let title = clean(m[2]);
    if (!title || GENERIC.test(title) || title.length < 4 || title.length > 150) {
      // "View job" style buttons: the job's title is the text just before the button.
      // Split on block boundaries BEFORE collapsing whitespace (clean() would turn the line breaks into spaces).
      const before = htmlToText(html.slice(Math.max(0, (anchors[i - 1]?.index ?? 0) + (anchors[i - 1]?.[0].length ?? 0)), m.index)).split(/\n+| {2,}/).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
      title = before.at(-1) ?? "";
    }
    if (!title || GENERIC.test(title) || title.length < 4 || title.length > 150) return;
    // The employer line follows the title in Handshake's cards: the next short text before another link.
    const after = clean(html.slice(m.index! + m[0].length, anchors[i + 1]?.index ?? m.index! + m[0].length + 600)).slice(0, 200);
    const employer = after.split(/ · | \| | - |\n/)[0]?.trim() || null;
    const emp = employer && employer.length <= 100 && !/^(?:apply|view|\$)/i.test(employer) ? employer : null;
    found.set(id, {
      handshakeId: id,
      url: `https://app.joinhandshake.com/jobs/${id}`,
      title,
      employer: emp,
      onCampus: /\bsan jos[eé] state\b|\bsjsu\b/i.test(`${emp ?? ""} ${title}`),
      payText: null,
      meta: null,
    });
  });
  return [...found.values()].slice(0, 25);
}
