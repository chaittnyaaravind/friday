/**
 * The tailoring report: a permanent, plain record of what tailoring did for one job — so the student can review it before
 * sending anything, and can see later exactly what a version changed. Everything here is derived deterministically from the
 * resume documents, the confirmed profile and the job; no model writes it.
 *
 * Sections of the report (the ones asked for):
 *   requirements       each job requirement: matched / weak / unclear / missing, with the evidence on the resume
 *   missing            requirements the resume does NOT show — never added to it
 *   unsupported        claims in the tailored resume with no supporting evidence in the profile (empty, or it would not be saved)
 *   changedSections    what changed against the baseline, section by section
 *   terminology        every ATS spelling change: the skill, both spellings, the line before and after
 */
import { matchJob, type MatchStatus } from "./jobmatch";
import type { TailorProposal } from "./tailor";
import type { TermChangeRecord } from "./terminology";
import { undoTerms } from "./terminology";
import type { CandidateItem, DocLine, DocSection, ResumeDoc } from "./types";
import { validateDoc, type Issue } from "./validate";

export type SectionChangeKind = "left out" | "entries removed" | "reordered" | "reworded" | "spelling";
export type SectionChange = { title: string; changes: SectionChangeKind[]; detail: string };

/** required / preferred come from the posting's qualification lists; "mentioned" is a skill the posting names elsewhere (e.g. in the duties). */
export type ReportRequirement = { name: string; kind: "required" | "preferred" | "mentioned"; status: MatchStatus; message: string; evidence: { text: string; where: string }[] };

export type TailoringReport = {
  version: 1;
  job: { id: string; title: string; company: string };
  /** What the changes are measured against: your master resume, or a resume built from your whole profile when none is set. */
  baseline: { source: "master" | "profile"; versionId: string | null };
  requirements: ReportRequirement[];
  counts: Record<MatchStatus, number>;
  missing: string[];
  changedSections: SectionChange[];
  wording: { before: string; after: string }[];
  reordered: string[];
  excluded: { label: string; reason: string }[];
  terminology: TermChangeRecord[];
  unsupported: Issue[];
  verification: { ok: boolean; linesChecked: number };
  notes: string[];
};

// ───────────────────────── comparing two documents ─────────────────────────

/** A line as the student's profile wrote it (ATS spelling changes undone), so a rename is never mistaken for a rewrite. */
const written = (l: DocLine) => (l.origin === "profile" ? undoTerms(l.text, l.terms) : l.text);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: string[], b: string[]) => a.length === b.length && sameList([...a].sort(), [...b].sort());
const tokens = (t: string) => t.replace(/^[^:]{1,40}:\s*/, "").split(/\s*,\s*/).filter(Boolean);
const hasTerms = (s: DocSection) => [...s.lines, ...s.entries.flatMap((e) => e.bullets)].some((l) => l.terms?.length);

function compareSection(base: DocSection, next: DocSection): SectionChange | null {
  const changes: SectionChangeKind[] = [];
  const notes: string[] = [];

  const baseKeys = base.entries.map((e) => `${e.heading} | ${e.subheading}`);
  const nextKeys = next.entries.map((e) => `${e.heading} | ${e.subheading}`);
  const removed = baseKeys.filter((k) => !nextKeys.includes(k));
  if (removed.length) {
    changes.push("entries removed");
    notes.push(`Left out: ${removed.map((k) => k.split(" | ")[0]).join(", ")}.`);
  }
  const common = nextKeys.filter((k) => baseKeys.includes(k));
  if (!sameList(common, baseKeys.filter((k) => common.includes(k)))) {
    changes.push("reordered");
    notes.push("Entries were reordered so the most relevant come first.");
  }
  let reworded = 0;
  let rebulleted = false;
  for (const e of next.entries) {
    const b = base.entries.find((x) => `${x.heading} | ${x.subheading}` === `${e.heading} | ${e.subheading}`);
    if (!b) continue;
    const before = b.bullets.map(written);
    const after = e.bullets.map(written);
    if (sameList(before, after)) continue;
    if (sameSet(before, after)) rebulleted = true;
    else reworded += 1;
  }
  if (rebulleted && !changes.includes("reordered")) changes.push("reordered");
  if (reworded) {
    changes.push("reworded");
    notes.push(`Wording was tidied in ${reworded} entr${reworded === 1 ? "y" : "ies"} (capitalisation, punctuation, spacing only).`);
  }

  const before = base.lines.map(written);
  const after = next.lines.map(written);
  if (!sameList(before, after)) {
    const sameTokens = before.length === after.length && before.every((l, i) => sameSet(tokens(l), tokens(after[i])) && l.split(":")[0] === after[i].split(":")[0]);
    if (sameSet(before, after) || sameTokens) {
      if (!changes.includes("reordered")) changes.push("reordered");
      notes.push("Your most relevant skills are listed first.");
    } else if (!changes.includes("reworded")) {
      changes.push("reworded");
    }
  }
  if (hasTerms(next)) {
    changes.push("spelling");
    notes.push("Some skills use the job's spelling.");
  }
  return changes.length ? { title: next.title, changes, detail: notes.join(" ") } : null;
}

/** What differs between a baseline resume and a tailored one, by section content (never by the random ids of a fresh build). */
export function compareDocs(base: ResumeDoc, next: ResumeDoc): SectionChange[] {
  const out: SectionChange[] = [];
  const baseByKind = new Map(base.sections.map((s) => [s.kind, s]));
  for (const s of next.sections) {
    const b = baseByKind.get(s.kind);
    const c = b ? compareSection(b, s) : { title: s.title, changes: ["reworded" as const], detail: "This section is not on the baseline." };
    if (c) out.push(c);
  }
  for (const b of base.sections) if (!next.sections.some((s) => s.kind === b.kind)) out.push({ title: b.title, changes: ["left out"], detail: `The whole ${b.title} section is not on this version.` });
  const shared = next.sections.map((s) => s.kind).filter((k) => baseByKind.has(k));
  if (!sameList(shared, base.sections.map((s) => s.kind).filter((k) => shared.includes(k)))) out.push({ title: "Section order", changes: ["reordered"], detail: "Sections were reordered to lead with what fits this job." });
  return out;
}

// ───────────────────────── the report ─────────────────────────

export type ReportInput = {
  job: { id: string; title: string; company: string; description: string; requirements: string[] };
  baseline: { doc: ResumeDoc; source: "master" | "profile"; versionId: string | null };
  tailored: ResumeDoc;
  items: CandidateItem[];
  proposal: TailorProposal;
  terminology: TermChangeRecord[];
};

const countLines = (d: ResumeDoc) => d.sections.reduce((n, s) => n + [...s.lines, ...s.entries.flatMap((e) => e.bullets)].filter((l) => l.origin !== "user").length, 0);

export function buildTailoringReport(i: ReportInput): TailoringReport {
  const jobText = [i.job.title, i.job.description, i.job.requirements.join("\n")].filter(Boolean).join("\n");
  const m = matchJob(i.tailored, jobText);
  const check = validateDoc(i.tailored, i.items);
  const toReq = (s: (typeof m.skills)[number], kind: ReportRequirement["kind"]): ReportRequirement => ({ name: s.name, kind, status: s.status, message: s.message, evidence: s.evidence.slice(0, 3).map((e) => ({ text: e.text, where: e.where })) });
  const requirements: ReportRequirement[] = m.skills.map((s) => toReq(s, s.kind));

  // The tailor screen lists EVERY skill the posting names. The section-aware extraction above only sees qualification lists,
  // so a skill named in prose ("you will write Python") would be in the preview but not here. Add those — checked against the
  // resume by the same code — so the two never disagree. They are labelled "mentioned", not "required".
  const known = new Set(requirements.map((r) => r.name.toLowerCase()));
  const extra = i.proposal.skills.map((s) => s.name).filter((n) => !known.has(n.toLowerCase()));
  if (extra.length) {
    for (const s of matchJob(i.tailored, `Minimum qualifications\n${extra.map((n) => `• ${n}`).join("\n")}`).skills) {
      if (!known.has(s.name.toLowerCase())) { known.add(s.name.toLowerCase()); requirements.push(toReq(s, "mentioned")); }
    }
  }
  const counts = { matched: 0, weak: 0, unclear: 0, missing: 0 } satisfies Record<MatchStatus, number>;
  for (const r of requirements) counts[r.status] += 1;
  const missing = requirements.filter((r) => r.status === "missing").map((r) => r.name);

  const notes: string[] = [];
  if (i.baseline.source === "profile") notes.push("You have not set a master resume, so changes are compared with a resume built from your whole confirmed profile. Set one in Resume Lab to compare against it.");
  if (missing.length) notes.push(`${missing.length} skill${missing.length === 1 ? "" : "s"} the job asks for ${missing.length === 1 ? "is" : "are"} not on your profile and ${missing.length === 1 ? "was" : "were"} NOT added: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "…" : ""}.`);
  if (i.terminology.length) notes.push("Spelling changes only rewrite a skill you already list into the spelling the job uses. None adds a skill, and your original wording is kept in the version history.");
  if (!check.ok) notes.push("Verification found claims without supporting evidence in your profile. Review them before using this resume.");

  return {
    version: 1,
    job: { id: i.job.id, title: i.job.title, company: i.job.company },
    baseline: { source: i.baseline.source, versionId: i.baseline.versionId },
    requirements,
    counts,
    missing,
    changedSections: compareDocs(i.baseline.doc, i.tailored),
    wording: i.proposal.changes.wording,
    reordered: i.proposal.changes.reorder,
    excluded: i.proposal.changes.notIncluded.map((n) => ({ label: n.label, reason: n.reason })),
    terminology: i.terminology,
    unsupported: check.issues,
    verification: { ok: check.ok, linesChecked: countLines(i.tailored) },
    notes,
  };
}

/** Plain text of a report's headline numbers, for notifications and logs. */
export const reportSummary = (r: TailoringReport) =>
  `${r.counts.matched} matched, ${r.counts.weak + r.counts.unclear} to strengthen, ${r.counts.missing} missing; ${r.changedSections.length} section${r.changedSections.length === 1 ? "" : "s"} changed; ${r.terminology.length} spelling change${r.terminology.length === 1 ? "" : "s"}; ${r.unsupported.length} unsupported claim${r.unsupported.length === 1 ? "" : "s"}.`;
