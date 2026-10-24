/**
 * Handshake job-alert emails → listings. Pure.
 *
 * These are emails Handshake sent to the student, delivered by the student's own Gmail bridge. FRIDAY never visits
 * Handshake: it keeps the job's title, employer and link exactly as the email states them, and the student opens the
 * link to read and apply. Only links to a Handshake job (an id in the path) count; profile, event and settings links
 * do not. Tracking redirects that hide the job id are skipped rather than followed.
 */
import { htmlToText } from "@/lib/domain/normalize";

export type HandshakeJob = { handshakeId: string; url: string; title: string; employer: string | null; onCampus: boolean };

const JOB_LINK = /^https?:\/\/(?:[a-z0-9-]+\.)*joinhandshake\.com\/(?:stu\/|e\/\d+\/)?(?:jobs|job-search|postings)\/(\d{4,12})\b/i;
const GENERIC = /^(?:view(?: (?:job|details|posting|all))?|apply(?: now)?|see (?:job|more|details)|learn more|details|open|here|click here)$/i;
const ANCHOR = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

const clean = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim();

export function isHandshakeSender(from: string): boolean {
  return /@(?:[a-z0-9-]+\.)*joinhandshake\.com>?\s*$/i.test(from.trim());
}

export function parseHandshakeAlert(html: string): HandshakeJob[] {
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
      const before = clean(html.slice(Math.max(0, (anchors[i - 1]?.index ?? 0) + (anchors[i - 1]?.[0].length ?? 0)), m.index)).split(/ {2,}|\n/).filter(Boolean);
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
    });
  });
  return [...found.values()].slice(0, 25);
}
