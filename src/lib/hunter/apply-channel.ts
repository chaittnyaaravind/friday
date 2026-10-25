/**
 * How a posting is applied to, read from its own words. Pure.
 *
 * "email": the posting says to email the application to a named sjsu.edu address and asks for nothing FRIDAY cannot
 *          attach (only a resume / cover letter). Then the student's Gmail bridge can send it once they approve.
 * "site":  everything else — an online portal, Handshake, or a posting that wants a filled form, transcript or
 *          availability sheet. FRIDAY hands over the resume and the official link; the student submits there.
 *
 * Only sjsu.edu addresses are ever used: an address from anywhere else in a posting is not trusted as the employer's.
 */
export type ApplyChannel =
  | { kind: "email"; to: string }
  | { kind: "site"; reason: string; needs: string[] };

const EMAIL = /[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)*sjsu\.edu\b/i;
/** "email it to x@sjsu.edu", "send your resume to x@sjsu.edu", "submit … via email to …", or a mailto: link. */
const EMAIL_INSTRUCTION = /\b(?:e-?mail(?:ed)?|send|submit)\b[^.\n]{0,120}?\b(?:to|at)\s*:?\s*(?:mailto:)?([A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)*sjsu\.edu)\b/i;
const MAILTO = /mailto:([A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)*sjsu\.edu)\b/i;

/** Things a posting may ask for that FRIDAY cannot honestly produce or sign for the student. */
const NEEDS: { label: string; re: RegExp }[] = [
  { label: "the SJSU Student Assistant job application form", re: /\b(?:student assistant )?(?:job )?application form\b|\bcomplete (?:a|the) [^.\n]{0,60}\bapplication\b/i },
  { label: "a transcript", re: /\btranscripts?\b/i },
  { label: "an availability / class schedule sheet", re: /\b(?:availability|class schedule) (?:form|sheet|grid)\b|\bsubmit (?:your )?(?:availability|class schedule)\b/i },
  { label: "references or recommendation letters", re: /\b(?:letters? of recommendation|recommendation letters?|list of references)\b/i },
  { label: "a writing or work sample", re: /\b(?:writing|work) samples?\b|\bportfolio\b/i },
];

export function applyChannel(description: string | null | undefined, applyUrl: string | null | undefined): ApplyChannel {
  const text = (description ?? "").replace(/\s+/g, " ");
  const needs = NEEDS.filter((n) => n.re.test(text)).map((n) => n.label);
  const to = (EMAIL_INSTRUCTION.exec(text)?.[1] ?? MAILTO.exec(applyUrl ?? "")?.[1] ?? MAILTO.exec(text)?.[1] ?? null)?.toLowerCase() ?? null;
  if (!to) {
    // Campus forms behind SSO ("you must be logged in to your one.SJSU account") can only be submitted by the student.
    const sso = /\bone\.?\s?sjsu\b|\bsjsu (?:sso|single sign-on)\b/i.test(text);
    return { kind: "site", reason: sso ? "The application form needs your one.SJSU login, so only you can submit it: open it, attach this resume, submit." : "The posting does not say to apply by email, so you apply on the official page.", needs };
  }
  if (needs.length) return { kind: "site", reason: `It is applied to by email (${to}), but it also asks for ${needs.join(", ")}, which FRIDAY cannot fill in or sign for you.`, needs };
  return { kind: "email", to };
}

export const isSjsuEmail = (s: string) => EMAIL.test(s) && EMAIL.exec(s)![0].length === s.trim().length;
