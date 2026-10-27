import { z } from "zod";
import { analyzeATS, analyzeResume, generateResumeEdit, generateSummary, matchResumeToJob, optimizeSkills, runResumeAssistant } from "@/lib/ai/resume";
import { aiProviders, isAiConfigured } from "@/lib/ai/client";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { requireAiQuota } from "@/lib/ai/quota";
import { basisOf, evidenceLines, findLine, lineContext, type LineRef, type Proposal } from "@/lib/resume/edits";
import { signAiText, signingAvailable } from "@/lib/ai/sign";
import { DocSchema, KindSchema } from "@/lib/resume/doc-schema";
import { isEligible, type CandidateItem, type ResumeDoc } from "@/lib/resume/types";
import { loadProfileItems } from "@/lib/resume/profile";

export const maxDuration = 60;

const Ref = z.object({ sectionId: z.string().max(40), entryId: z.string().max(40).nullable(), lineId: z.string().max(40) });
const Ctx = z.object({
  section: z.string().max(80), sectionKind: KindSchema, heading: z.string().max(300), subheading: z.string().max(400), meta: z.string().max(120),
  siblings: z.array(z.string().max(600)).max(8), text: z.string().min(1).max(2000),
});
const Jd = z.string().max(20_000).optional();
const Keywords = z.array(z.string().max(60)).max(20).optional();

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("edit"), kind: z.enum(["improve", "shorten", "clearer", "technical", "impactful", "grammar", "ats", "alternatives", "quantify", "humanize"]), target: Ref, ctx: Ctx, sourceItemId: z.string().max(60).nullable().optional(), keywords: Keywords, userFacts: z.string().trim().max(200).optional() }),
  z.object({ op: z.literal("summary"), doc: DocSchema, keywords: Keywords }),
  z.object({ op: z.literal("skills"), doc: DocSchema, sectionId: z.string().max(40), keywords: Keywords }),
  z.object({ op: z.literal("analyze"), doc: DocSchema, jd: Jd }),
  z.object({ op: z.literal("match"), doc: DocSchema, jd: z.string().min(20).max(20_000), explain: z.boolean().optional() }),
  z.object({ op: z.literal("ats"), doc: DocSchema, jd: Jd, explain: z.boolean().optional() }),
  z.object({ op: z.literal("assistant"), message: z.string().trim().min(2).max(500), doc: DocSchema, jd: Jd, selection: Ref.nullable().optional() }),
]);

// Per-user guard against runaway clicking (per server instance): 40 model-backed requests / 5 min.
const HITS = new Map<string, number[]>();
function throttle(userId: string) {
  const now = Date.now();
  const recent = (HITS.get(userId) ?? []).filter((t) => now - t < 5 * 60_000);
  if (recent.length >= 40) throw new HttpError(429, "You're going fast — wait a minute and try again.");
  HITS.set(userId, [...recent, now]);
}

/**
 * Sign every suggestion the guard approved outright (no new claims). An accepted AI line must carry this signature to be
 * saved, so a client can't label its own text "AI-written and verified". Riskier suggestions are not signed: they can only
 * be applied after the user confirms them, which makes the text the user's own (origin "user").
 */
function signProposal(userId: string, p: Proposal): Proposal {
  if (p.via !== "ai" || !p.suggestions.length) return p;
  if (!signingAvailable()) throw new HttpError(503, "AI editing isn't available: the server has no signing secret (set AI_SIGNING_SECRET).");
  const basis = p.basis.slice(0, 6000); // exactly what applySuggestion stores on the line
  return {
    ...p,
    suggestions: p.suggestions.map((s) => {
      if (s.requiresConfirmation || s.riskLevel !== "none") return s;
      if (p.target.kind === "skills") return { ...s, rowSigs: s.text.split("\n").map((r) => r.trim()).filter(Boolean).map((row) => signAiText(userId, row, basis)) };
      return { ...s, sig: signAiText(userId, s.text, basis) };
    }),
  };
}

const evidenceOfItem = (item: CandidateItem) => [...evidenceLines(item.data), item.source_text ?? ""].filter(Boolean).join("\n");

/** Text a line may draw on: its entry (bullet, header, siblings) plus the confirmed profile item behind it. */
function evidenceFor(doc: ResumeDoc, ref: LineRef, items: Map<string, CandidateItem>) {
  const ctx = lineContext(doc, ref);
  const at = findLine(doc, ref);
  const sourceId = at?.line.sourceItemId ?? at?.entry?.sourceItemId ?? null;
  const item = sourceId ? items.get(sourceId) : undefined;
  return [ctx ? basisOf(ctx) : "", item && isEligible(item) ? evidenceOfItem(item) : ""].filter(Boolean).join("\n");
}

/**
 * POST /api/resumes/ai — every AI-backed resume operation goes through here. The browser never
 * talks to a provider. Model output is screened by the fact guard before it is returned, so a
 * response never contains a suggestion that adds an unverified number, technology or claim.
 * Deterministic operations (analyze, match, ats) work with no provider configured.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Body);
  const configured = isAiConfigured();
  if (configured) throttle(user.id);
  const providers = aiProviders().map((p) => p.provider);
  const meta = { configured, providers };
  // AI operations draw on the daily allowance; analyze, match and ats are deterministic unless an explanation is asked for.
  if (configured && (["edit", "summary", "skills", "assistant"].includes(input.op) || ("explain" in input && input.explain === true))) await requireAiQuota(user.id, "resume_ai");

  switch (input.op) {
    case "edit": {
      const items = new Map((await loadProfileItems(db, user.id)).map((i) => [i.id, i]));
      const item = input.sourceItemId ? items.get(input.sourceItemId) : undefined;
      const evidence = [basisOf(input.ctx), item && isEligible(item) ? evidenceOfItem(item) : ""].filter(Boolean).join("\n");
      const proposal = await generateResumeEdit({ op: input.kind, target: { kind: "line", ...input.target }, ctx: input.ctx, evidence, keywords: input.keywords, userFacts: input.userFacts });
      return ok({ ...meta, proposal: signProposal(user.id, proposal) });
    }
    case "summary":
      return ok({ ...meta, proposal: signProposal(user.id, await generateSummary({ doc: input.doc as ResumeDoc, keywords: input.keywords })) });
    case "skills":
      return ok({ ...meta, proposal: signProposal(user.id, await optimizeSkills({ doc: input.doc as ResumeDoc, sectionId: input.sectionId, keywords: input.keywords })) });
    case "analyze":
      return ok({ ...meta, analysis: await analyzeResume({ doc: input.doc as ResumeDoc, jd: input.jd }) });
    case "match":
      return ok({ ...meta, match: await matchResumeToJob({ doc: input.doc as ResumeDoc, jd: input.jd, explain: input.explain }) });
    case "ats":
      return ok({ ...meta, ats: await analyzeATS({ doc: input.doc as ResumeDoc, jd: input.jd, explain: input.explain }) });
    case "assistant": {
      const doc = input.doc as ResumeDoc;
      const items = new Map((await loadProfileItems(db, user.id)).map((i) => [i.id, i]));
      const result = await runResumeAssistant({
        message: input.message, doc, jd: input.jd, selection: input.selection ?? null,
        contextFor: (ref) => lineContext(doc, ref), evidenceFor: (ref) => evidenceFor(doc, ref, items),
      });
      return ok({ ...meta, result: { ...result, proposals: result.proposals.map((p) => signProposal(user.id, p)) } });
    }
  }
});

/** GET /api/resumes/ai — which providers are configured (names only, never keys). */
export const GET = withUser(async () => ok({ configured: isAiConfigured(), providers: aiProviders().map((p) => p.provider) }));
