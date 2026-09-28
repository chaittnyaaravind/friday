/**
 * Truth layer. Any resume text not written by the user (origin "profile" or "ai") must be
 * backed by an eligible Candidate Profile fact. Checkable claims — numbers/metrics, years,
 * technologies, and entry headings (employer, school, project) — are compared against the
 * source fact. Anything unsupported is reported and blocks export.
 */
import { newFactsIn, skillsLineFacts } from "./guard";
import { skillMentions } from "./parse";
import { isSpellingVariant, sameSkill, undoTerms } from "./terminology";
import { isEligible, type CandidateItem, type DocLine, type ResumeDoc } from "./types";

export type Issue = { where: string; text: string; claim: string; reason: string };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%$+#.]/g, "");
const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|\+|(?:million|billion|thousand|k|m|x)\b)?/gi;
const numbersIn = (text: string) => (text.match(NUM_RE) ?? []).map((n) => n.replace(/\s+/g, "").replace(/,/g, "").toLowerCase());
const isNumber = (claim: string) => /^\$?\d/.test(claim);

/** Claims a reviewer could check: metrics/numbers/years and named technologies. */
export function claimsIn(text: string): string[] {
  const nums = numbersIn(text);
  const tech = skillMentions(text);
  return [...new Set([...nums, ...tech])];
}

/** Claims in `text` with no support in `evidence` (used for any AI draft before saving). */
export function unsupportedClaims(text: string, evidence: string): string[] {
  // Numbers must appear as the same whole number ("2" is not backed by "2025");
  // technologies may appear anywhere in the evidence text.
  const evNums = new Set(numbersIn(evidence));
  const ev = norm(evidence.replace(/,/g, ""));
  return claimsIn(text).filter((c) => (isNumber(c) ? !evNums.has(c.toLowerCase()) : !ev.includes(norm(c))));
}

function evidenceOf(item: CandidateItem) {
  return `${JSON.stringify(item.data)}\n${item.source_text ?? ""}`;
}

export function validateDoc(doc: ResumeDoc, items: CandidateItem[]): { ok: boolean; issues: Issue[] } {
  const issues: Issue[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const eligible = items.filter(isEligible);
  const allEvidence = eligible.map(evidenceOf).join("\n");
  const skillNames = new Set(eligible.filter((i) => i.section === "skill").map((i) => norm((i.data as { name: string }).name)));

  const check = (where: string, text: string, sourceItemId: string | null) => {
    if (!text.trim()) return;
    let evidence = allEvidence;
    if (sourceItemId) {
      const item = byId.get(sourceItemId);
      if (!item) return issues.push({ where, text, claim: text, reason: "Not found in your profile." });
      if (!isEligible(item)) return issues.push({ where, text, claim: text, reason: "Still needs your confirmation." });
      evidence = evidenceOf(item);
    }
    for (const c of unsupportedClaims(text, evidence)) issues.push({ where, text, claim: c, reason: "No supporting evidence found in your profile." });
  };

  // An accepted AI rewrite is checked against the text it was allowed to draw on (its recorded
  // basis + the profile item behind it). Any fact it adds that neither supports is an issue.
  const checkAi = (where: string, l: DocLine, entrySourceId: string | null, skills: boolean) => {
    if (!l.text.trim()) return;
    const sourceId = l.sourceItemId ?? entrySourceId;
    const item = sourceId ? byId.get(sourceId) : undefined;
    const evidence = `${l.ai?.basis ?? ""}\n${item && isEligible(item) ? evidenceOf(item) : ""}`;
    if (!l.ai?.basis && !(item && isEligible(item))) return issues.push({ where, text: l.text, claim: l.text, reason: "AI-written line has no recorded source." });
    const facts = skills ? skillsLineFacts(evidence, l.text) : newFactsIn(l.text, evidence);
    for (const f of facts) issues.push({ where, text: l.text, claim: f.claim, reason: f.reason });
  };

  // ATS terminology changes (see terminology.ts): a profile line may carry recorded renames of a skill's SPELLING. Each must be
  // the same skill in the taxonomy, and the line is then checked as the student's profile wrote it — the rename is undone
  // first, so it can never smuggle in a skill the evidence does not support. Only profile-origin lines are honoured.
  const termsOk = (where: string, l: DocLine): boolean => {
    if (l.origin !== "profile") return true;
    for (const t of l.terms ?? []) {
      if (!isSpellingVariant(t.from, t.to) || !sameSkill(t.from, t.to)) {
        issues.push({ where, text: l.text, claim: `${t.from} → ${t.to}`, reason: "A terminology change may only rewrite a skill as another spelling of itself." });
        return false;
      }
    }
    return true;
  };
  const asWritten = (l: DocLine) => (l.origin === "profile" ? undoTerms(l.text, l.terms) : l.text);

  if (doc.header.origin !== "user") {
    const ev = norm(allEvidence);
    for (const c of doc.header.contact) if (!ev.includes(norm(c.replace(/^https?:\/\/(www\.)?/, "")))) issues.push({ where: "Header", text: c, claim: c, reason: "Not found in your profile." });
  }

  for (const s of doc.sections) {
    for (const e of s.entries) {
      if (e.origin !== "user") {
        const item = e.sourceItemId ? byId.get(e.sourceItemId) : null;
        if (!item) issues.push({ where: s.title, text: e.heading, claim: e.heading, reason: "Entry isn't linked to anything in your profile." });
        else if (!isEligible(item)) issues.push({ where: s.title, text: e.heading, claim: e.heading, reason: "Still needs your confirmation." });
        else {
          const ev = norm(evidenceOf(item));
          for (const part of [e.heading, e.subheading]) {
            for (const piece of part.split(/\s*(?:·|,|—)\s*/)) {
              const p = piece.replace(/^GPA:\s*/i, "");
              if (p && !ev.includes(norm(p))) issues.push({ where: s.title, text: part, claim: p, reason: "Doesn't match the source in your profile." });
            }
          }
          check(s.title, e.meta, e.sourceItemId);
        }
      }
      for (const b of e.bullets) {
        if (b.origin === "ai") checkAi(`${s.title} · ${e.heading}`, b, e.sourceItemId, false);
        else if (b.origin !== "user" && termsOk(`${s.title} · ${e.heading}`, b)) check(`${s.title} · ${e.heading}`, asWritten(b), b.sourceItemId ?? e.sourceItemId);
      }
    }
    for (const l of s.lines) {
      if (l.origin === "user") continue;
      if (l.origin === "ai") {
        checkAi(s.title, l, null, s.kind === "skills");
        continue;
      }
      if (!termsOk(s.title, l)) continue;
      const written = asWritten(l);
      if (s.kind === "skills") {
        for (const token of written.replace(/^[^:]{1,40}:\s*/, "").split(/\s*,\s*/)) {
          if (token && !skillNames.has(norm(token))) issues.push({ where: "Skills", text: l.text, claim: token, reason: "Not a confirmed skill in your profile." });
        }
      } else check(s.title, written, l.sourceItemId);
    }
  }
  return { ok: issues.length === 0, issues };
}
