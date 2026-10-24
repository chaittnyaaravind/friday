/**
 * Physical demand and schedule burden, read from a posting's DUTIES — never from its title. "Office Assistant" is not
 * labelled easy because it sounds easy: a low rating needs the description itself to describe desk or computer work, and
 * a posting with too little text is "unknown". Every flag carries the phrase it was read from. Pure and deterministic.
 */

export type PhysicalLevel = "low" | "moderate" | "high" | "unknown";
export type BurdenKind = "lifting" | "standing" | "moving" | "outdoor" | "cleaning" | "schedule";
export type PhysicalFlag = { kind: BurdenKind; text: string; heavy?: boolean; hedged?: boolean };
export type PhysicalAssessment = { level: PhysicalLevel; flags: PhysicalFlag[]; desk: string[] };

export const BURDEN_LABEL: Record<BurdenKind, string> = {
  lifting: "Lifting", standing: "Long standing / walking", moving: "Moving equipment", outdoor: "Outdoor work", cleaning: "Cleaning / custodial", schedule: "Difficult schedule",
};
export const LEVEL_LABEL: Record<PhysicalLevel, string> = { low: "Desk-based", moderate: "Some physical work", high: "Physically demanding", unknown: "Physical demand not stated" };
export const isPhysicalLevel = (v: unknown): v is PhysicalLevel => v === "low" || v === "moderate" || v === "high" || v === "unknown";

const RULES: { kind: BurdenKind; re: RegExp }[] = [
  { kind: "lifting", re: /\b(?:lift(?:ing)?|carry(?:ing)?|push(?:ing)?|pull(?:ing)?)\b[^.;\n]{0,40}?\b(\d{2,3})\s*(?:lbs?|pounds)\b|\bheavy lifting\b|\blift(?:ing)? (?:and|or|&) carry(?:ing)?\b|\b(?:lift|carry) (?:heavy|boxes)\b/i },
  { kind: "standing", re: /\bstand(?:ing)? for (?:long|extended|prolonged)\b|\bon (?:your|their) feet\b|\bstand(?:ing)? for (?:up to )?\d+ hours?\b|\bprolonged standing\b|\bextended periods of (?:standing|walking)\b/i },
  { kind: "moving", re: /\b(?:move|moving|set(?:ting)? up|tear(?:ing)? down|break(?:ing)? down)\b[^.;\n]{0,30}?\b(?:furniture|tables|chairs|equipment|staging|boxes|carts|barricades|cones|signage)\b|\b(?:loading|unloading) (?:trucks|deliveries|equipment)\b/i },
  { kind: "outdoor", re: /\b(?:outdoors|all weather conditions|inclement weather|in the heat|groundskeeping|grounds keeping|landscaping|patrol(?:s|ling)?|parking (?:lots|garages)|direct(?:s|ing)? (?:vehicular |pedestrian )?traffic|directs vehicles)\b/i },
  { kind: "cleaning", re: /\b(?:custodial|janitorial|mopping|sweeping|scrubbing|clean(?:ing)? (?:restrooms|bathrooms|equipment|facilities|floors))\b/i },
  { kind: "schedule", re: /\b(?:overnight|graveyard|night shifts?|late[- ]night|early[- ]morning shifts?|on[- ]call|weekends? (?:are )?required|must (?:be able to )?work (?:weekends|holidays|nights))\b/i },
];
const DESK = /\b(?:data entry|computers?|spreadsheets?|excel|microsoft office|google (?:docs|sheets|workspace)|answer(?:ing)? (?:phones?|calls|emails?|questions)|front desk|reception|check[- ]in|greet(?:ing)? (?:visitors|students|guests|patrons)|filing|scheduling|appointments|clerical|office (?:tasks|duties|support)|email correspondence|records|scanning|help ?desk|troubleshoot(?:ing)?|circulation desk)\b/gi;
/**
 * "May (also) be required to …" — the boilerplate CSU job descriptions append to every posting, desk jobs included. A burden
 * stated only this way is real but occasional: it can make a posting "moderate", never "high".
 */
const HEDGE = /\bmay (?:also )?(?:be required to|be asked to|have to|need to)\b/i;
/** The clause a match sits in: back to the previous sentence or bullet boundary. */
function clauseBefore(text: string, at: number): string {
  const head = text.slice(Math.max(0, at - 160), at);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf(";"), head.lastIndexOf("•"), head.lastIndexOf("\uf0b7"));
  return cut >= 0 ? head.slice(cut + 1) : head;
}
/** Lifting MORE than this is heavy. "Up to 25 lbs" is the common light-to-medium line in campus postings; 45–50 lbs is not. */
const HEAVY_LBS = 25;

/** Read physical burdens and desk-work evidence from a posting's description. */
export function assessPhysical(description: string | null | undefined): PhysicalAssessment {
  const text = (description ?? "").replace(/\s+/g, " ");
  const flags: PhysicalFlag[] = [];
  for (const { kind, re } of RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const lbs = kind === "lifting" && m[1] ? Number(m[1]) : null;
    const hedged = HEDGE.test(clauseBefore(text, m.index));
    flags.push({
      kind,
      text: m[0].trim().slice(0, 120),
      ...(kind === "lifting" ? { heavy: lbs == null ? /heavy/i.test(m[0]) : lbs > HEAVY_LBS } : {}),
      ...(hedged ? { hedged: true } : {}),
    });
  }
  const desk = [...new Set([...text.matchAll(DESK)].map((m) => m[0].toLowerCase()))].slice(0, 6);
  const physical = flags.filter((f) => f.kind !== "schedule");
  const firm = physical.filter((f) => !f.hedged);
  let level: PhysicalLevel;
  if (firm.some((f) => f.heavy) || firm.filter((f) => f.kind !== "standing").length >= 2 || firm.length >= 3) level = "high";
  else if (physical.length) level = "moderate";
  // "Low" needs the posting to describe the work: enough text, and at least two desk/computer duties.
  else if (text.length >= 120 && desk.length >= 2) level = "low";
  else level = "unknown";
  return { level, flags, desk };
}
