/**
 * What an SJSU campus posting screens for, and whether the student's confirmed profile shows it. Pure and deterministic.
 *
 * Campus hiring managers (front desks, offices, labs, the library) read for a short, predictable list: customer-facing
 * experience, named software, languages, availability, GPA / unit minimums, Work-Study, a driver's license, cash handling
 * and confidentiality. This reads the posting for each of those, then looks for evidence in the profile text. It never
 * adds anything to a resume: "no" means the posting asks for it and the profile does not show it, and the tip says what
 * the student could add IF it is true.
 */
import { hasTerm } from "./guard";

export type ScreenId = "customer_service" | "software" | "language" | "availability" | "gpa" | "units" | "work_study" | "license" | "cash" | "confidentiality" | "communication";
export type Screen = { id: ScreenId; label: string; asks: string; covered: "yes" | "no" | "check"; evidence: string | null; tip: string };

const SOFTWARE = ["Microsoft Office", "Excel", "Word", "PowerPoint", "Outlook", "Google Workspace", "Google Docs", "Google Sheets", "Canva", "Adobe Photoshop", "Adobe Premiere", "Photoshop", "Premiere Pro", "Salesforce", "Canvas", "PeopleSoft", "Zoom", "Slack"];
const LANGUAGES = ["Spanish", "Vietnamese", "Mandarin", "Cantonese", "Chinese", "Tagalog", "Korean", "Japanese", "Hindi", "Punjabi", "Arabic", "French", "Portuguese", "American Sign Language", "ASL", "Telugu", "Tamil"];

const CUSTOMER_JD = /\b(?:customer service|front desk|front counter|reception|greet(?:s|ing)?|answer(?:s|ing)? (?:phones?|calls|questions)|assist(?:s|ing)? (?:students|visitors|patrons|customers|guests)|service desk|help desk|check[- ]in)\b/i;
const CUSTOMER_EV = /\b(?:customer(?:s| service)?|front desk|reception(?:ist)?|greeted|cashier|answered (?:phones?|calls|questions)|assisted (?:students|visitors|patrons|customers|guests|residents)|help desk|service desk|tutored|helped (?:students|customers|visitors))\b/i;
const AVAIL_JD = /\b(?:weekends?|evenings?|nights?|early mornings?|on[- ]call|flexible (?:schedule|hours)|(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*hours?(?:\s*(?:per|a|\/)\s*week)?|availability)\b/i;
const GPA_JD = /\b(\d\.\d{1,2})\s*(?:or (?:higher|above|better)\s*)?(?:minimum\s*)?(?:cumulative\s*|semester\s*)?GPA\b|\bGPA\b[^.\n]{0,30}?\b(\d\.\d{1,2})\b/i;
const UNITS_JD = /\b(?:enrolled in|carry|minimum of|at least)\s*(?:a minimum of\s*)?(\d{1,2})\s*(?:or more\s*)?units\b|\b(\d{1,2})\s*units\b[^.\n]{0,40}\benrolled\b/i;

const firstLine = (text: string, re: RegExp) => {
  for (const l of text.split(/\n+|(?<=[.!?])\s+/)) if (re.test(l)) return l.trim().slice(0, 160);
  return null;
};

/** The screens `jobText` asks for, each with whether `profileText` (the confirmed profile, as text) shows it. */
export function campusScreens(jobText: string, profileText: string): Screen[] {
  const jd = jobText;
  const ev = profileText;
  const out: Screen[] = [];

  if (CUSTOMER_JD.test(jd)) {
    const e = firstLine(ev, CUSTOMER_EV);
    out.push({ id: "customer_service", label: "Customer-facing experience", asks: firstLine(jd, CUSTOMER_JD) ?? "Customer service", covered: e ? "yes" : "no", evidence: e,
      tip: e ? "Lead with this bullet: it is what a desk supervisor reads for first." : "If you have helped customers, students or visitors (retail, tutoring, volunteering, a family business), add that experience to your profile." });
  }

  for (const tool of SOFTWARE) {
    if (!hasTerm(jd, tool)) continue;
    const have = hasTerm(ev, tool) || (/\bMicrosoft Office\b|\bMS Office\b/i.test(ev) && ["Excel", "Word", "PowerPoint", "Outlook"].includes(tool));
    out.push({ id: "software", label: tool, asks: `The posting names ${tool}.`, covered: have ? "yes" : "no", evidence: have ? tool : null,
      tip: have ? `Keep ${tool} in Skills and in the bullet where you used it.` : `Add ${tool} to your skills only if you have used it.` });
  }

  const langs = LANGUAGES.filter((l) => hasTerm(jd, l));
  if (langs.length || /\bbilingual\b/i.test(jd)) {
    const mine = LANGUAGES.filter((l) => hasTerm(ev, l));
    const match = langs.length ? langs.filter((l) => mine.includes(l)) : mine;
    out.push({ id: "language", label: langs.length ? `Language: ${langs.join(", ")}` : "Bilingual", asks: firstLine(jd, /bilingual|language|fluent|speak/i) ?? "Language skills", covered: match.length ? "yes" : "no", evidence: match.join(", ") || null,
      tip: match.length ? `List ${match.join(", ")} under Skills (Languages).` : "If you speak another language, add it under Skills (Languages); campus front desks value it." });
  }

  const avail = AVAIL_JD.exec(jd);
  if (avail) {
    out.push({ id: "availability", label: "Availability", asks: firstLine(jd, AVAIL_JD) ?? avail[0], covered: "check", evidence: null,
      tip: "Campus supervisors schedule around classes. Put your weekly availability (days and hours) in the application or email." });
  }

  const gpa = GPA_JD.exec(jd);
  if (gpa) {
    const need = Number(gpa[1] ?? gpa[2]);
    const mine = /\bGPA[:\s]*([0-4]\.\d{1,2})\b/i.exec(ev);
    const covered = mine ? (Number(mine[1]) >= need ? "yes" : "no") : "check";
    out.push({ id: "gpa", label: `GPA ${need.toFixed(1)}+`, asks: firstLine(jd, /GPA/i) ?? `Minimum GPA ${need}`, covered, evidence: mine ? `GPA ${mine[1]}` : null,
      tip: covered === "yes" ? "Your GPA meets it; keep it on the resume." : covered === "no" ? "Your stated GPA is below the posting's minimum; check before applying." : "The posting has a GPA minimum; add your GPA to Education if it meets it." });
  }

  const units = UNITS_JD.exec(jd);
  if (units) out.push({ id: "units", label: `Enrolled in ${units[1] ?? units[2]}+ units`, asks: firstLine(jd, /units/i) ?? units[0], covered: "check", evidence: null, tip: "An enrollment requirement: confirm your units this semester before applying." });

  if (/\b(?:federal )?work[- ]study\b/i.test(jd)) {
    const only = /\bwork[- ]study (?:only|required|students only)\b|\bmust (?:have|be awarded) (?:federal )?work[- ]study\b/i.test(jd);
    out.push({ id: "work_study", label: only ? "Work-Study required" : "Work-Study mentioned", asks: firstLine(jd, /work[- ]study/i) ?? "Work-Study", covered: "check", evidence: null,
      tip: only ? "Only students with a Federal Work-Study award can take this job; check your financial aid package." : "If you have a Work-Study award, say so: it can make you cheaper to hire." });
  }

  if (/\bdriver'?s licen[cs]e\b/i.test(jd)) {
    const have = /\bdriver'?s licen[cs]e\b/i.test(ev);
    out.push({ id: "license", label: "Driver's license", asks: firstLine(jd, /driver'?s licen/i) ?? "Valid driver's license", covered: have ? "yes" : "check", evidence: have ? "Driver's license" : null, tip: "A valid California driver's license is required; mention it if you have one." });
  }

  if (/\bcash (?:handling|register)|\bhandl(?:e|ing) (?:cash|money|payments)\b/i.test(jd)) {
    const e = firstLine(ev, /\bcash|register|payments?|transactions?\b/i);
    out.push({ id: "cash", label: "Cash handling", asks: firstLine(jd, /cash|payments/i) ?? "Cash handling", covered: e ? "yes" : "no", evidence: e, tip: e ? "Keep the bullet that shows cash or payment handling." : "If you have handled cash or payments, add it to your experience." });
  }

  if (/\b(?:FERPA|confidential(?:ity)?|sensitive (?:information|records))\b/i.test(jd)) {
    const e = firstLine(ev, /\b(?:FERPA|confidential|records|privacy)\b/i);
    out.push({ id: "confidentiality", label: "Confidential records", asks: firstLine(jd, /FERPA|confidential|sensitive/i) ?? "Confidentiality", covered: e ? "yes" : "check", evidence: e, tip: "Desk and office jobs handle student records; show care with confidential information if you have done it." });
  }

  if (/\b(?:communication|interpersonal) skills\b|\bwritten and (?:oral|verbal)\b/i.test(jd)) {
    const e = firstLine(ev, /\b(?:presented|explained|wrote|emailed|communicated|answered|tutored|trained|taught)\b/i);
    out.push({ id: "communication", label: "Communication", asks: firstLine(jd, /communication|interpersonal|written and/i) ?? "Communication skills", covered: e ? "yes" : "check", evidence: e,
      tip: "Show it with a specific bullet (explaining, presenting, answering questions), not the words “strong communication skills”." });
  }
  return out;
}

/** Profile keywords worth surfacing for this job: the screens the profile already covers (never ones it lacks). */
export const coveredKeywords = (screens: Screen[]) =>
  screens.filter((s) => s.covered === "yes").flatMap((s) => (s.id === "software" ? [s.label] : s.id === "language" && s.evidence ? s.evidence.split(", ") : s.id === "customer_service" ? ["customer service"] : []));
