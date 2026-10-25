/**
 * The AI pass of job tailoring. After the deterministic tailor has chosen and ordered what goes on the resume, this rewrites
 * the few lines that matter most for THIS job so they read in the posting's own terms:
 *
 *   - bullets whose own evidence already supports a job keyword the bullet does not yet say ("ats" rewrite toward it),
 *   - weak bullets that start with a duty or no verb ("improve"),
 *   - a two-sentence summary for the role, written only from the resume's facts.
 *
 * A rewrite is applied ONLY when the fact guard found nothing new in it (risk "none": no number, tool, name, scope or result
 * the evidence lacks) and the writing lint finds no AI tell. Anything else is left as the student wrote it. Every applied
 * line is origin "ai", carries its evidence basis, and is server-signed, so validateDoc and the save path re-check it.
 * With no AI provider or signing secret, the document is returned unchanged.
 */
import "server-only";
import { allLines, applySuggestion, basisOf, evidenceLines, findWeakBullets, lineContext, type Proposal, type Target } from "@/lib/resume/edits";
import { dutyTargets, jobRelevance, supportedDuties } from "@/lib/resume/campus-screens";
import { docToText } from "@/lib/resume/generate";
import { hasTerm } from "@/lib/resume/guard";
import type { CandidateItem, ResumeDoc } from "@/lib/resume/types";
import { lintWriting, type WritingKind } from "@/lib/writing/style";
import { isAiConfigured } from "./client";
import { generateResumeEdit, generateSummary } from "./resume";
import { signAiText, signingAvailable } from "./sign";

export type AiTailorChange = { where: string; before: string; after: string; reason: string };
export type AiTailorResult = { doc: ResumeDoc; changes: AiTailorChange[]; note: string | null };

const WORK = new Set(["experience", "projects", "activities"]);
const evidenceOfItem = (item: CandidateItem) => [...evidenceLines(item.data), item.source_text ?? ""].filter(Boolean).join("\n");

/** A rewrite is clean when the lint finds no AI tell, dash, duty phrasing, cliché or blocking issue. */
export const cleanRewrite = (text: string, kind: WritingKind, evidence: string) =>
  !lintWriting(text, kind, evidence).some((i) => i.severity === "error" || ["ai_tell", "dash", "duty", "cliche", "first_person", "exclamation"].includes(i.code));

/** A suggestion that adds nothing, reads clean and passes `keep`, preferring one that uses a target term; or null. */
export function pickRewrite(p: Proposal, kind: WritingKind, prefer: string[] = [], keep: (text: string) => boolean = () => true): string | null {
  const ok = p.suggestions.filter((s) => s.riskLevel === "none" && !s.requiresConfirmation && cleanRewrite(s.text, kind, p.basis) && keep(s.text)).map((s) => s.text);
  return ok.find((t) => prefer.some((k) => hasTerm(t, k))) ?? ok[0] ?? null;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type LineCandidate = { target: Extract<Target, { kind: "line" }>; where: string; before: string; evidence: string; op: "ats" | "improve"; keywords: string[]; score: number; entryId: string };

/** Which lines to rewrite, best first: supported-but-unsaid job keywords count double, a weak opening counts once. Three per entry at most. */
export function chooseLines(doc: ResumeDoc, keywords: string[], items: Map<string, CandidateItem>, max: number, jobText = ""): LineCandidate[] {
  const weak = new Set(findWeakBullets(doc).filter((f) => f.severity === "weak").map((f) => f.ref.lineId));
  const out: LineCandidate[] = [];
  for (const { ref, line, section, entry } of allLines(doc)) {
    if (!entry || !WORK.has(section.kind) || !line.text.trim() || line.origin === "user") continue;
    const ctx = lineContext(doc, ref);
    if (!ctx) continue;
    const item = items.get(line.sourceItemId ?? entry.sourceItemId ?? "");
    const evidence = [basisOf(ctx), item ? evidenceOfItem(item) : ""].filter(Boolean).join("\n");
    // A keyword is a target only when this line's own evidence supports it and the line does not already say it.
    // A posting duty is a target only when THIS line's own words describe that work (campus-screens.ts dutyTargets).
    const supported = [...new Set([...keywords.filter((k) => hasTerm(evidence, k) && !hasTerm(line.text, k)), ...dutyTargets(jobText, line.text)])];
    const score = supported.length * 2 + (weak.has(line.id) ? 1 : 0);
    if (!score) continue;
    out.push({ target: { kind: "line", ...ref }, where: `${section.title} · ${entry.heading || "entry"}`, before: line.text, evidence, op: supported.length ? "ats" : "improve", keywords: supported.length ? supported : keywords, score, entryId: entry.id });
  }
  out.sort((a, b) => b.score - a.score);
  const perEntry = new Map<string, number>();
  return out.filter((c) => {
    const n = perEntry.get(c.entryId) ?? 0;
    if (n >= 3) return false;
    perEntry.set(c.entryId, n + 1);
    return true;
  }).slice(0, max);
}

export async function aiTailor(doc: ResumeDoc, o: { userId: string; keywords: string[]; items: CandidateItem[]; maxLines?: number; timeoutMs?: number; job?: { title: string; text: string } }): Promise<AiTailorResult> {
  if (!isAiConfigured()) return { doc, changes: [], note: "AI isn't configured, so the tailored resume uses your own wording." };
  if (!signingAvailable()) return { doc, changes: [], note: "AI rewriting is off: the server has no signing secret." };
  const items = new Map(o.items.map((i) => [i.id, i]));
  const keywords = o.keywords.slice(0, 15);
  const timeout = o.timeoutMs ?? 20_000;
  const jobText = o.job?.text ?? "";
  const picks = chooseLines(doc, keywords, items, o.maxLines ?? 6, jobText);
  // Fact-checked but off-target is still worse: a rewrite may not speak to this job less than the line it replaces.
  const noLessRelevant = (before: string) => (text: string) => !jobText || jobRelevance(text, jobText, keywords) >= jobRelevance(before, jobText, keywords);
  const summaryBefore = doc.sections.find((s) => s.kind === "summary")?.lines[0]?.text ?? "";
  const duties = [...new Set([...supportedDuties(jobText, docToText(doc)), ...picks.flatMap((p) => p.keywords)])];

  // At most three model calls at a time; each is bounded, and a slow or failed call just leaves that line as it was.
  const results: (Proposal | null)[] = new Array(picks.length).fill(null);
  let next = 0;
  const lines = Promise.all(Array.from({ length: Math.min(3, picks.length) }, async () => {
    while (next < picks.length) {
      const i = next++;
      const c = picks[i];
      const ctx = lineContext(doc, c.target);
      if (ctx) results[i] = await withTimeout(generateResumeEdit({ op: c.op, target: c.target, ctx, evidence: c.evidence, keywords: c.keywords }), timeout);
    }
  }));
  const [, summaryP] = await Promise.all([lines, withTimeout(generateSummary({ doc, keywords, role: o.job ? { title: o.job.title, duties } : undefined }), timeout)]);

  let out = doc;
  const changes: AiTailorChange[] = [];
  picks.forEach((c, i) => {
    const p = results[i];
    const text = p ? pickRewrite(p, "bullet", c.op === "ats" ? c.keywords : [], noLessRelevant(c.before)) : null;
    if (!p || !text) return;
    const basis = p.basis.slice(0, 6000);
    out = applySuggestion(out, c.target, text, { op: c.op, basis, sig: signAiText(o.userId, text, basis) });
    changes.push({ where: c.where, before: c.before, after: text, reason: c.op === "ats" ? `Uses the posting's terms your experience supports: ${c.keywords.join(", ")}.` : "Clearer, stronger opening with the same facts." });
  });
  const summary = summaryP ? pickRewrite(summaryP, "summary", duties, noLessRelevant(summaryBefore)) : null;
  if (summaryP && summary) {
    const basis = summaryP.basis.slice(0, 6000);
    const before = summaryBefore;
    out = applySuggestion(out, { kind: "summary" }, summary, { op: "summary", basis, sig: signAiText(o.userId, summary, basis) });
    changes.unshift({ where: "Summary", before, after: summary, reason: "Written for this role from facts already on your resume." });
  }
  return { doc: out, changes, note: changes.length ? null : "No rewrite passed the fact check, so your own wording was kept." };
}
