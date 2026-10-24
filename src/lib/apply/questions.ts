/**
 * Application questions FRIDAY must never answer for the student: legal status, work authorization, sponsorship,
 * availability, employment history, disability, demographics, criminal history, veteran status, signatures and
 * certifications, references, and pay expectations. These are personal declarations with real consequences, so the
 * student writes the answer and ticks that they did. Everything else may get a DRAFT built only from approved profile
 * facts, which the student reviews. Pure and deterministic.
 */

export type DeclarationKind =
  | "work_authorization" | "sponsorship" | "legal_status" | "availability" | "employment_history" | "disability"
  | "demographic" | "criminal_history" | "veteran" | "certification" | "references" | "compensation";

export type QuestionClass = { sensitive: true; kind: DeclarationKind; reason: string } | { sensitive: false };

// Order matters: the first rule that matches names the kind ("Will you require sponsorship for work authorization?" is sponsorship).
const RULES: { kind: DeclarationKind; re: RegExp; reason: string }[] = [
  { kind: "sponsorship", re: /\bsponsor(?:ship|ed)?\b|\bh-?1b\b|\bvisa\b/i, reason: "Visa sponsorship is a legal declaration only you can make." },
  { kind: "work_authorization", re: /\b(?:authori[sz]ed|authori[sz]ation|eligible|eligibility|permitted|legally able)\b[^?]{0,40}\bwork\b|\bwork (?:permit|authori[sz]ation)\b|\bi-?9\b|\bright to work\b|\bf-?1\b|\bcpt\b|\bopt\b|\bwork-?study (?:award|eligib)/i, reason: "Work authorization is a legal declaration only you can make." },
  { kind: "legal_status", re: /\b(?:citizen(?:ship)?|permanent resident|green card|immigration|resident status|social security|ssn)\b/i, reason: "Citizenship, immigration status and identity numbers are declarations only you can make." },
  { kind: "criminal_history", re: /\b(?:convicted|conviction|criminal|felony|misdemeanor|background check|arrest(?:ed)?)\b/i, reason: "Criminal-history questions are legal declarations only you can answer." },
  { kind: "disability", re: /\b(?:disabilit(?:y|ies)|accommodations?|impairment|medical condition)\b/i, reason: "Disability and accommodation questions are private and voluntary — only you decide what to disclose." },
  { kind: "veteran", re: /\b(?:veteran|military service|armed forces)\b/i, reason: "Veteran status is a voluntary self-identification only you can make." },
  { kind: "demographic", re: /\b(?:gender|sex|race|ethnicity|ethnic|hispanic|latino|latina|latinx|pronouns?|sexual orientation|date of birth|how old)\b|\bage\b/i, reason: "Demographic questions are voluntary self-identification — only you decide whether and how to answer." },
  { kind: "certification", re: /\b(?:certify|attest|i agree|signature|sign(?:ed)? (?:below|here)|true and (?:correct|complete)|acknowledge)\b/i, reason: "Certifying statements are signed by you; FRIDAY never agrees or signs on your behalf." },
  { kind: "compensation", re: /\b(?:salary|pay|wage|compensation)\s+(?:expectations?|requirements?|desired)\b|\bdesired (?:pay|salary|wage)\b|\bexpected (?:pay|salary)\b/i, reason: "Pay expectations are your decision." },
  { kind: "availability", re: /\b(?:availab(?:le|ility)|start date|when can you start|hours (?:per|a|each) week|how many hours|weekly hours|schedule|shifts?|weekends?|evenings?|mornings?|summer|winter break)\b/i, reason: "Your availability is a commitment only you can state." },
  { kind: "employment_history", re: /\b(?:previously (?:worked|employed)|former employee|ever been (?:employed|terminated|fired)|terminated|dismissed|reason for leaving|current(?:ly)? employ(?:ed|er)|work history|employment history|years of experience)\b/i, reason: "Employment-history declarations must come from you." },
  { kind: "references", re: /\breferences?\b|\breferee\b|\bsupervisor'?s? (?:name|contact|phone|email)\b/i, reason: "References are other people's contact details; only you can provide them, with their permission." },
];

export const DECLARATION_LABEL: Record<DeclarationKind, string> = {
  work_authorization: "Work authorization", sponsorship: "Visa sponsorship", legal_status: "Citizenship / identity", availability: "Availability",
  employment_history: "Employment history", disability: "Disability / accommodation", demographic: "Demographic", criminal_history: "Criminal history",
  veteran: "Veteran status", certification: "Certification / signature", references: "References", compensation: "Pay expectations",
};

/** Whether a question asks for a personal declaration FRIDAY must not answer, and which kind. */
export function classifyQuestion(question: string): QuestionClass {
  const q = question.replace(/\s+/g, " ").trim();
  for (const r of RULES) if (r.re.test(q)) return { sensitive: true, kind: r.kind, reason: r.reason };
  return { sensitive: false };
}

/** Title prefix of the application_documents row that records an AI-drafted answer (so the packet can tell drafts from the student's words). */
export const ANSWER_DRAFT_TITLE = "Answer draft — ";
