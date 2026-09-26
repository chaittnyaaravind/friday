"use client";

import { Check, Info, Pencil, ShieldAlert, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { diffLines } from "@/lib/resume/diff";
import { canApply, OP_LABEL, type BlockedSuggestion, type Proposal, type Suggestion } from "@/lib/resume/edits";
import type { Risk } from "@/lib/resume/guard";
import { Button, Input, Textarea, cx } from "../ui";

export type AcceptHow = { attested: boolean; userEdited: boolean };

/** Words the suggestion changed or added, highlighted against the original. */
export function WordDiff({ before, after, mode }: { before: string; after: string; mode: "added" | "removed" }) {
  const parts = useMemo(() => {
    const tok = (s: string) => s.split(/(\s+)/).filter((t) => t !== "");
    const d = diffLines(tok(before), tok(after));
    return d.filter((x) => (mode === "added" ? x.kind !== "removed" : x.kind !== "added"));
  }, [before, after, mode]);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((p, i) => (p.kind === "same" || !p.text.trim()
        ? <span key={i}>{p.text}</span>
        : <mark key={i} className={cx("rounded-[3px] px-[1px]", mode === "added" ? "bg-accent-soft text-text" : "bg-[rgb(var(--ink)/.08)] text-dim line-through decoration-[1px]")}>{p.text}</mark>))}
    </span>
  );
}

const LETTERS = "ABCDEFGH";

const RISK: Record<Risk, { label: string; cls: string; icon: typeof ShieldCheck }> = {
  none: { label: "No new claims", cls: "bg-moss-soft text-moss", icon: ShieldCheck },
  low: { label: "Low risk", cls: "bg-amber-soft text-amber", icon: TriangleAlert },
  medium: { label: "Medium risk", cls: "bg-amber-soft text-amber", icon: TriangleAlert },
  high: { label: "High risk — blocked", cls: "bg-accent-soft text-accent", icon: ShieldAlert },
};

export function RiskBadge({ risk }: { risk: Risk }) {
  const r = RISK[risk];
  const Icon = r.icon;
  return <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium", r.cls)}><Icon size={12} />{r.label}</span>;
}

/** A labelled block of the before/after layout. */
function Field({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "danger" | "ok" }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={cx("label", tone === "danger" && "!text-accent", tone === "ok" && "!text-moss")}>{label}</span>
      {children}
    </div>
  );
}

function Evidence({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-[12.5px] text-dim">Nothing on your resume supports this yet.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((e) => (
        <li key={e} className={cx("rounded-lg bg-[rgb(var(--ink)/.05)] px-2.5 py-1.5 text-[12.5px] leading-snug text-muted", e.startsWith("You provided:") && "text-text")}>{e}</li>
      ))}
    </ul>
  );
}

/**
 * One AI proposal, laid out as BEFORE / AFTER / WHY / EVIDENCE / NEW CLAIMS with Accept / Edit / Reject. Nothing is
 * written until the user presses Accept. A suggestion that asserts something the resume doesn't support is shown
 * flagged and blocked — it can only be edited (and then it is the user's own statement). A suggestion with a softer
 * new claim needs the user to confirm it's true.
 */
export function ProposalCard({ proposal, onAccept, onDismiss, onQuantify, busy }: {
  proposal: Proposal;
  onAccept: (text: string, how: AcceptHow, s: Suggestion | null) => void;
  onDismiss: () => void;
  /** Quantify step 2: the student's own fact ("Used by 5,000 students"). */
  onQuantify?: (fact: string) => void;
  busy?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attested, setAttested] = useState<Set<string>>(new Set());
  const [fact, setFact] = useState("");
  const visible = proposal.suggestions.filter((s) => !hidden.has(s.id));
  const blocked = proposal.rejected.filter((r) => r.riskLevel === "high" && r.newClaims.length > 0);
  const minor = proposal.rejected.filter((r) => !blocked.includes(r));
  const label = proposal.op === "assistant" ? "Assistant edit" : OP_LABEL[proposal.op];
  const multiline = proposal.original.includes("\n") || proposal.suggestions.some((s) => s.text.includes("\n"));

  const reject = (id: string) => {
    const next = new Set(hidden).add(id);
    setHidden(next);
    if (proposal.suggestions.every((s) => next.has(s.id)) && !blocked.length && !proposal.questions) onDismiss();
  };

  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles size={12} /></span>
        <span className="text-[13px] font-medium">{label}</span>
        <span className="label">{proposal.via === "ai" ? "AI · Nemotron" : "Built-in"}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" title="Dismiss" className="ml-auto grid size-7 place-items-center rounded-full text-dim hover:bg-surface-2 hover:text-text"><X size={14} /></button>
      </div>

      {proposal.original && (
        <Field label="Before">
          <p className="rounded-xl bg-surface-2 p-3 text-[13.5px] leading-relaxed text-muted whitespace-pre-wrap">{proposal.original}</p>
        </Field>
      )}

      {/* Quantify, step 1: ask for a real number. FRIDAY never supplies one. */}
      {proposal.questions && (
        <div className="flex flex-col gap-3 rounded-xl p-3 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
          <p className="text-[13.5px] font-medium">What&rsquo;s the real number?</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[12.5px] leading-snug text-muted">{proposal.questions.map((q) => <li key={q}>{q}</li>)}</ul>
          <form onSubmit={(e) => { e.preventDefault(); if (fact.trim() && onQuantify) onQuantify(fact.trim()); }} className="flex gap-2">
            <Input value={fact} onChange={(e) => setFact(e.target.value)} maxLength={200} placeholder="e.g. Used by 5,000 students" aria-label="A real metric or fact about this bullet" className="h-9 flex-1 text-[13.5px]" />
            <Button type="submit" size="sm" variant="primary" disabled={busy || !fact.trim() || !onQuantify}>Use this fact</Button>
          </form>
          <p className="text-[12px] leading-snug text-dim">Your fact becomes the evidence for the rewrite. FRIDAY will use it exactly as you wrote it and add nothing else.</p>
        </div>
      )}

      {visible.map((s, i) => {
        const needsConfirm = s.requiresConfirmation;
        const ok = canApply(s, attested.has(s.id));
        return (
          <div key={s.id} className="flex flex-col gap-3 rounded-xl p-3 [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">
            <div className="flex items-center justify-between gap-2">
              <span className="label">Option {LETTERS[i] ?? i + 1}</span>
              <RiskBadge risk={s.riskLevel} />
            </div>
            {editing === s.id ? (
              <>
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={multiline ? 5 : 3} className="min-h-20 text-[13.5px]" aria-label="Edit suggestion" autoFocus />
                <p className="text-[12px] text-dim">Text you edit or write is your own statement — FRIDAY won&rsquo;t machine-check it.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={() => onAccept(draft.trim(), { attested: false, userEdited: true }, s)}><Check size={13} /> Use my edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                <Field label="After"><p className="text-[14px] leading-relaxed"><WordDiff before={proposal.original} after={s.text} mode="added" /></p></Field>
                {s.reason && <Field label="Why"><p className="text-[12.5px] leading-snug text-muted">{s.reason}</p></Field>}
                <Field label="Evidence"><Evidence items={s.evidence} /></Field>
                <Field label="New claims" tone={s.newClaims.length ? "danger" : "ok"}>
                  {s.newClaims.length ? (
                    <div className="flex flex-wrap gap-1.5">{s.newClaims.map((c) => <span key={c} className="inline-flex h-6 items-center rounded-full bg-amber-soft px-2.5 text-[12px] font-medium text-amber">{c}</span>)}</div>
                  ) : <p className="text-[12.5px] text-moss">None — only your existing facts, reworded.</p>}
                </Field>
                {needsConfirm && (
                  <div className="flex flex-col gap-2 rounded-lg bg-amber-soft p-3 text-[12.5px] leading-snug text-amber">
                    <p className="flex items-center gap-1.5 font-medium"><TriangleAlert size={13} /> This adds claims your resume doesn&rsquo;t make:</p>
                    <ul className="flex flex-col gap-0.5">{s.newFacts.map((f) => <li key={f.claim + f.kind}>{f.reason}</li>)}</ul>
                    <label className="mt-1 flex cursor-pointer items-start gap-2 text-text">
                      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={attested.has(s.id)} onChange={(e) => setAttested((a) => { const n = new Set(a); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                      <span>I confirm this is true about my experience.</span>
                    </label>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" disabled={busy || !ok} onClick={() => onAccept(s.text, { attested: needsConfirm, userEdited: false }, s)}><Check size={13} /> {needsConfirm ? "Confirm & accept" : "Accept"}</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setEditing(s.id); setDraft(s.text); }}><Pencil size={13} /> Edit</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => reject(s.id)}><X size={13} /> Reject</Button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Blocked: the AI wrote something the resume doesn't support. Shown, flagged, and not acceptable as-is. */}
      {blocked.map((b, i) => <BlockedOption key={i} b={b} original={proposal.original} busy={busy} multiline={multiline} onUse={(text) => onAccept(text, { attested: false, userEdited: true }, null)} />)}

      {!proposal.suggestions.length && !blocked.length && !proposal.questions && proposal.note && <p className="text-[13px] leading-relaxed text-muted">{proposal.note}</p>}
      {proposal.suggestions.length > 0 && proposal.note && <p className="text-[12px] text-dim">{proposal.note}</p>}

      {proposal.missingEvidence.map((m) => (
        <p key={m} className="flex gap-2 rounded-lg bg-[rgb(var(--ink)/.05)] p-3 text-[12.5px] leading-snug text-muted"><Info size={14} className="mt-px shrink-0 text-dim" /> {m}</p>
      ))}

      {minor.length > 0 && (
        <details className="text-[12px] text-dim">
          <summary className="cursor-pointer select-none hover:text-muted">{minor.length} other suggestion{minor.length === 1 ? "" : "s"} discarded</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {minor.map((r, i) => <li key={i} className="rounded-lg bg-[rgb(var(--ink)/.04)] p-2.5 leading-snug"><span className="line-through decoration-[1px]">{r.text}</span><br />{r.reasons.join(" ")}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function BlockedOption({ b, original, busy, multiline, onUse }: { b: BlockedSuggestion; original: string; busy?: boolean; multiline: boolean; onUse: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.text);
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl bg-accent-soft p-3 [box-shadow:inset_0_0_0_1px_var(--accent)]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent"><ShieldAlert size={14} /> Blocked — not supported by your resume</span>
        <RiskBadge risk={b.riskLevel} />
      </div>
      <Field label="After (blocked)"><p className="text-[14px] leading-relaxed"><WordDiff before={original} after={b.text} mode="added" /></p></Field>
      <Field label="New claims" tone="danger">
        <div className="flex flex-wrap gap-1.5">{b.newClaims.map((c) => <span key={c} className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 text-[12px] font-medium text-accent-ink">{c}</span>)}</div>
      </Field>
      <Field label="Why it was blocked"><p className="text-[12.5px] leading-snug text-muted">{b.reasons.join(" ")}</p></Field>
      <Field label="Evidence found"><Evidence items={b.evidence} /></Field>
      {editing ? (
        <>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={multiline ? 5 : 3} className="min-h-20 text-[13.5px]" aria-label="Edit blocked suggestion" />
          <p className="text-[12px] text-dim">If this is genuinely true, keep it — your edit becomes your own statement. Otherwise remove the unsupported part.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={() => onUse(draft.trim())}><Check size={13} /> Use my edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled title="Blocked suggestions can't be accepted as written">Accept</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}><Pencil size={13} /> Edit</Button>
          <span className="text-[12px] text-dim">Use <b className="font-medium">Quantify</b> to give FRIDAY a real number instead.</span>
        </div>
      )}
    </div>
  );
}
