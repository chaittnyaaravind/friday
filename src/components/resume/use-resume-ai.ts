"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantResult, ResumeAnalysis } from "@/lib/ai/resume";
import { applySuggestion, basisOf, currentText, describeTarget, findLine, lineContext, localProposal, localSkillsProposal, OP_LABEL, quantifyProposal, type EditOp, type Finding, type LineRef, type Proposal, type Repeat, type Suggestion, type Target } from "@/lib/resume/edits";
import type { RevisionTrace } from "@/lib/resume/history";
import { randomId } from "@/lib/resume/ids";
import { analyzeJd, type JobMatch } from "@/lib/resume/jobmatch";
import type { AtsReport } from "@/lib/resume/ats";
import type { ResumeDoc } from "@/lib/resume/types";
import { api } from "../actions";
import type { AcceptHow } from "./suggestion-card";

export type EditKind = Exclude<EditOp, "summary" | "skills" | "assistant">;
export type AiError = { message: string; notConfigured: boolean };
export type ChatMsg = { id: string; role: "user" | "assistant"; text: string; proposalIds?: string[]; findings?: Finding[]; repeats?: Repeat[]; match?: JobMatch | null; ats?: AtsReport | null; aiUsed?: boolean };
export type RevisionInput = { label: string; source: "ai" | "user"; trace?: RevisionTrace };
export type ResumeAi = ReturnType<typeof useResumeAi>;

const NOT_CONFIGURED = "AI features need a free API key — add GROQ_API_KEY or GEMINI_API_KEY on the server. Everything else here works without one.";
const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);

/**
 * All AI interaction for the editor. The browser only ever calls /api/resumes/ai — never a
 * provider — and nothing reaches the document except through `accept`, which re-checks that the
 * text the suggestion was made for is still there and records who wrote what.
 */
export function useResumeAi({ doc, jd, configured, commit, onProposal }: { doc: ResumeDoc; jd: string; configured: boolean; commit: (next: ResumeDoc, rev: RevisionInput) => void; onProposal?: () => void }) {
  const [pending, setPending] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AiError | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const busyRef = useRef<string | null>(null);
  const cache = useRef(new Map<string, Proposal>());
  const notify = useRef(onProposal);
  useEffect(() => { notify.current = onProposal; }, [onProposal]);

  /** Keywords from the pasted job description (used for ATS wording and skills ordering). Cheap and deterministic. */
  const keywords = useMemo(() => {
    if (!jd.trim()) return [] as string[];
    const a = analyzeJd(jd);
    return [...new Set([...a.required, ...a.preferred, ...a.technologies])].slice(0, 15);
  }, [jd]);

  const fail = useCallback((e: unknown) => {
    const raw = e instanceof Error ? e.message : "Something went wrong.";
    // The browser's own wording for a dropped connection ("Failed to fetch", "Load failed"…) is not something to show a student.
    const message = /^(?:Failed to fetch|Load failed|NetworkError|Network request failed)/i.test(raw) ? "Couldn't reach FRIDAY — check your connection and try again. Nothing was changed." : raw;
    setError({ message, notConfigured: /free api key|No free AI provider|GROQ_API_KEY/i.test(message) });
    notify.current?.(); // bring the AI panel forward: an error nobody can see is the same as no feedback
  }, []);

  // One request at a time: ignores clicks while one is in flight, so a user can't spam the provider.
  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = key;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, [fail]);

  const push = useCallback((p: Proposal) => {
    setPending((list) => [p, ...list.filter((x) => !(x.op === p.op && same(x.target, p.target)))]);
    notify.current?.();
  }, []);

  /** `userFacts`: a real fact the student typed in (Quantify's second step, e.g. "Used by 5,000 students"). */
  const edit = useCallback((kind: EditKind, ref: LineRef, userFacts?: string) => run(`edit:${kind}`, async () => {
    const ctx = lineContext(doc, ref);
    const at = findLine(doc, ref);
    if (!ctx || !at) throw new Error("That line no longer exists.");
    const target: Target = { kind: "line", ...ref };
    if (!configured && (kind === "grammar" || kind === "shorten")) return push(localProposal(kind, target, ctx.text, basisOf(ctx))); // instant, free, no network
    if (kind === "quantify" && !userFacts?.trim()) return push(quantifyProposal(target, ctx.text, basisOf(ctx))); // asks for a real number — no network, no AI
    const key = JSON.stringify([kind, ctx, kind === "ats" ? keywords : null, userFacts ?? null]);
    const hit = cache.current.get(key);
    if (hit) return push({ ...hit, id: randomId() });
    const r = await api<{ proposal: Proposal }>("/api/resumes/ai", { method: "POST", json: { op: "edit", kind, target: ref, ctx, sourceItemId: at.line.sourceItemId ?? at.entry?.sourceItemId ?? null, keywords: kind === "ats" ? keywords : undefined, userFacts: userFacts?.trim() || undefined } });
    cache.current.set(key, r.proposal);
    push(r.proposal);
  }), [doc, configured, keywords, run, push]);

  /** Full-resume analysis: recommendations only — nothing is rewritten. */
  const analyze = useCallback(() => run("analyze", async () => {
    const r = await api<{ analysis: ResumeAnalysis }>("/api/resumes/ai", { method: "POST", json: { op: "analyze", doc, jd: jd.trim() || undefined } });
    setAnalysis(r.analysis);
  }), [doc, jd, run]);

  const summary = useCallback(() => run("summary", async () => {
    if (!configured) throw new Error(NOT_CONFIGURED);
    const r = await api<{ proposal: Proposal }>("/api/resumes/ai", { method: "POST", json: { op: "summary", doc, keywords } });
    push(r.proposal);
  }), [doc, configured, keywords, run, push]);

  const skills = useCallback((sectionId: string) => run("skills", async () => {
    if (!configured) return push(localSkillsProposal(doc, sectionId, keywords));
    const r = await api<{ proposal: Proposal }>("/api/resumes/ai", { method: "POST", json: { op: "skills", doc, sectionId, keywords } });
    push(r.proposal);
  }), [doc, configured, keywords, run, push]);

  const ask = useCallback((message: string, selection: LineRef | null) => run("chat", async () => {
    setMessages((m) => [...m, { id: randomId(), role: "user", text: message }]);
    const r = await api<{ result: AssistantResult }>("/api/resumes/ai", { method: "POST", json: { op: "assistant", message, doc, jd: jd.trim() || undefined, selection } });
    const res = r.result;
    const shown = res.proposals.filter((p) => p.suggestions.length || p.rejected.length);
    setPending((list) => [...shown, ...list.filter((x) => !shown.some((p) => p.op === x.op && same(p.target, x.target)))]);
    setMessages((m) => [...m, { id: randomId(), role: "assistant", text: res.reply, proposalIds: shown.map((p) => p.id), findings: res.findings, repeats: res.repeats, match: res.match, ats: res.ats, aiUsed: res.usedAi }]);
    if (shown.length) notify.current?.();
  }), [doc, jd, run]);

  const accept = useCallback((proposalId: string, text: string, how: AcceptHow, s: Suggestion | null) => {
    const p = pending.find((x) => x.id === proposalId);
    if (!p) return;
    try {
      if (currentText(doc, p.target) !== p.original) throw new Error("That text changed since this suggestion was made. Ask for a new one.");
      const next = applySuggestion(doc, p.target, text, { op: p.op, basis: p.basis, attested: how.attested, userEdited: how.userEdited || p.via === "local", sig: s?.sig, rowSigs: s?.rowSigs });
      const where = describeTarget(doc, p.target);
      const what = p.op === "assistant" ? "AI edit" : OP_LABEL[p.op];
      const verb = how.userEdited ? `Edited suggestion (${what})` : how.attested ? `Confirmed AI edit (${what})` : `AI: ${what}`;
      commit(next, {
        label: `${verb} — ${where}`.slice(0, 120),
        source: "ai",
        trace: { op: p.op, where: where.slice(0, 200), before: p.original.slice(0, 2000), after: text.slice(0, 2000), reason: s?.reason?.slice(0, 400) || undefined, via: p.via, attested: how.attested && s ? s.newFacts.map((f) => f.claim).slice(0, 20) : undefined },
      });
      setPending((list) => list.filter((x) => x.id !== proposalId));
    } catch (e) {
      fail(e);
    }
  }, [pending, doc, commit, fail]);

  const dismiss = useCallback((id: string) => setPending((list) => list.filter((x) => x.id !== id)), []);
  const clearError = useCallback(() => setError(null), []);

  return { pending, busy, error, messages, analysis, keywords, configured, edit, summary, skills, analyze, ask, accept, dismiss, clearError };
}
