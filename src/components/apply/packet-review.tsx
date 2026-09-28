"use client";

import { ArrowUpRight, Check, Circle, Loader2, Plus, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { ExtraQuestion } from "@/lib/apply/packet";
import type { PacketState } from "@/lib/apply/packet-service";
import { api } from "../actions";
import { Button, Card, Chip, Input, Label, Notice, Select, Textarea } from "../ui";

type Version = { id: string; label: string; kind: string };

const STAGE: Record<string, { word: string; tone: "accent" | "amber" | "moss" }> = {
  blocked: { word: "Blocked — fix what's listed below", tone: "accent" },
  needs_confirmation: { word: "Needs your confirmation", tone: "amber" },
  ready_for_approval: { word: "Ready for your approval", tone: "moss" },
};

const host = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : "the employer's site"; } catch { return "the employer's site"; } };

/**
 * The application packet, exactly as it would be submitted. FRIDAY prepares; you review, approve THIS content, and submit on
 * the employer's own site. Nothing here is sent anywhere, and changing anything after approving means approving again.
 */
export function PacketReview({ applicationId, state, versions, confirmText, aiConfigured }: {
  applicationId: string;
  state: PacketState | null;
  versions: Version[];
  confirmText: Record<string, string>;
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const p = state?.packet ?? null;
  const [resumeId, setResumeId] = useState<string>(p?.resume?.versionId ?? "");
  const [letter, setLetter] = useState(p?.coverLetter?.text ?? "");
  const [extra, setExtra] = useState<ExtraQuestion[]>(p?.extra ?? []);
  const [ticks, setTicks] = useState<string[]>(state?.acknowledged ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submittedAsk, setSubmittedAsk] = useState(false);

  const dirty = useMemo(() => {
    if (!p) return false;
    const flat = (a: ExtraQuestion[]) => JSON.stringify(a.map((x) => [x.question.trim(), (x.answer ?? "").trim()]));
    return (resumeId || null) !== (p.resume?.versionId ?? null) || letter.trim() !== (p.coverLetter?.text ?? "").trim() || flat(extra.filter((e) => e.question.trim())) !== flat(p.extra);
  }, [p, resumeId, letter, extra]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("save", async () => {
    await api(`/api/applications/${applicationId}/packet`, {
      method: "POST",
      json: { resumeVersionId: resumeId || null, coverLetter: letter.trim() ? letter : null, extra: extra.filter((e) => e.question.trim()).map((e) => ({ question: e.question, answer: e.answer?.trim() ? e.answer : null })) },
    });
    setTicks([]);
  });
  const draft = () => run("draft", async () => {
    const { letter: text } = await api<{ letter: string }>(`/api/applications/${applicationId}/cover-letter`, { method: "POST", json: {} });
    setLetter(text);
    await api(`/api/applications/${applicationId}/packet`, { method: "POST", json: { resumeVersionId: resumeId || null, coverLetter: text } });
    setTicks([]);
  });

  if (!state || !p) {
    return (
      <Card className="flex flex-col items-start gap-4 p-6">
        <p className="max-w-[56ch] text-[14.5px] text-muted">FRIDAY will assemble your resume, your profile answers and a checklist of what the posting mentions — so you can see exactly what you would send, before anything goes anywhere.</p>
        <Button variant="primary" disabled={busy !== null} onClick={() => run("build", async () => { await api(`/api/applications/${applicationId}/packet`, { method: "POST", json: {} }); })}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Prepare packet
        </Button>
        {err && <p className="text-[12.5px] text-accent">{err}</p>}
      </Card>
    );
  }

  const stage = STAGE[state.readiness];
  const approved = state.approval.state === "approved";
  const stale = state.approval.state === "stale";
  const blockers = state.issues.filter((i) => i.severity === "block");
  const confirms = state.issues.filter((i) => i.severity === "confirm");
  const info = state.issues.filter((i) => i.severity === "info");
  const allTicked = state.confirmations.every((c) => ticks.includes(c));
  const canApprove = !dirty && !blockers.length && allTicked && !approved && busy === null;

  return (
    <div className="flex flex-col gap-8 pb-8">
      <div className="flex flex-wrap items-center gap-3">
        {approved ? <Chip tone="moss" icon={<Check size={12} />}>Approved — this exact packet</Chip> : stale ? <Chip tone="amber">Changed since you approved it</Chip> : <Chip tone={stage.tone}>{stage.word}</Chip>}
        <span className="num font-mono text-[12px] text-dim" title="A fingerprint of exactly what would be sent. If anything changes, it changes.">packet {state.contentHash.slice(0, 8)}</span>
      </div>

      {(!!blockers.length || !!confirms.length || !!info.length) && (
        <Card className="flex flex-col gap-3 p-5">
          <Label>Before you can apply</Label>
          <ul className="flex flex-col gap-2.5">
            {blockers.map((i) => <li key={i.code} className="flex gap-2.5 text-[13.5px]"><X size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden /><span>{i.message}</span></li>)}
            {confirms.map((i) => (
              <li key={i.code}>
                <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
                  <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={ticks.includes(i.code)} disabled={approved || dirty}
                    onChange={() => setTicks((t) => (t.includes(i.code) ? t.filter((x) => x !== i.code) : [...t, i.code]))} />
                  <span><span className="text-muted">{i.message}</span><br /><span>{confirmText[i.code] ?? "I have checked this."}</span></span>
                </label>
              </li>
            ))}
            {info.map((i) => <li key={i.code} className="flex gap-2.5 text-[12.5px] text-dim"><Circle size={12} className="mt-1 shrink-0" aria-hidden /><span>{i.message}</span></li>)}
          </ul>
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-[22px]">Exactly what you would <span className="serif-em">submit</span></h2>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Resume</Label>
            {p.resume && <Link href={`/resume/${p.resume.versionId}`} className="text-[12.5px] text-muted hover:text-text">Open in editor</Link>}
          </div>
          <Select value={resumeId} onChange={(e) => setResumeId(e.target.value)} aria-label="Resume to send">
            <option value="">— choose a resume —</option>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}{v.kind === "tailored" ? " · tailored" : v.kind === "base" ? " · from profile" : ""}</option>)}
          </Select>
          {p.resume ? (
            <>
              <p className="text-[12.5px] text-dim">{p.resume.verified.ok ? "Every line is supported by your confirmed profile." : `${p.resume.verified.issues.length} line(s) have no supporting evidence in your profile.`}</p>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-[rgb(var(--ink)/.04)] p-4 font-mono text-[12px] leading-relaxed text-muted">{p.resume.text}</pre>
            </>
          ) : <p className="text-[13.5px] text-muted">No resume chosen.</p>}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Cover letter</Label>
            {p.coverLetter?.origin === "ai_draft" && !dirty && <Chip tone="amber">AI draft — you confirm it</Chip>}
          </div>
          <Textarea rows={8} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder="Optional unless the posting asks for one. Write your own, or have FRIDAY draft one from your confirmed profile." aria-label="Cover letter" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={draft} disabled={busy !== null || !aiConfigured} title={aiConfigured ? undefined : "No AI provider is configured"}>{busy === "draft" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Draft with FRIDAY</Button>
          </div>
          <p className="text-[12px] leading-snug text-dim">A draft uses only your confirmed profile and replaces the text above. FRIDAY doesn&rsquo;t verify it line by line — you read it and confirm it.</p>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <Label>Your details</Label>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[180px_1fr]">
            {p.answers.map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-[13px] text-dim">{a.label}</dt>
                <dd className="text-[13.5px]">{a.value ?? <Chip tone="neutral">not on your profile — you would enter it yourself</Chip>}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[12px] text-dim">These come from your profile. To change one, <Link href="/settings" className="text-accent hover:underline">edit your profile</Link> — FRIDAY never fills in what it doesn&rsquo;t have.</p>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <Label>Questions FRIDAY didn&rsquo;t prepare for</Label>
          <p className="text-[12.5px] leading-snug text-muted">FRIDAY can&rsquo;t read the live application form. If it asks something not covered above, add the question and write your own answer.</p>
          {extra.map((e, i) => (
            <div key={i} className="flex flex-col gap-2 border-t-[0.5px] border-hairline-strong pt-3">
              <div className="flex gap-2">
                <Input value={e.question} onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, question: ev.target.value } : x)))} placeholder="The question, as the form words it" aria-label="Question" />
                <button type="button" aria-label="Remove question" onClick={() => setExtra(extra.filter((_, j) => j !== i))} className="grid size-10 shrink-0 place-items-center rounded-full text-dim hover:bg-surface-2 hover:text-text"><X size={14} /></button>
              </div>
              <Textarea rows={3} value={e.answer ?? ""} onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, answer: ev.target.value } : x)))} placeholder="Your answer, in your own words" aria-label="Your answer" />
            </div>
          ))}
          <div><Button size="sm" onClick={() => setExtra([...extra, { question: "", answer: null }])}><Plus size={13} /> Add a question</Button></div>
        </Card>

        {!!p.documents.length && (
          <Card className="flex flex-col gap-3 p-5">
            <Label>What the posting mentions</Label>
            <ul className="flex flex-col gap-2 text-[13.5px]">
              {p.documents.map((d) => (
                <li key={d.kind} className="flex flex-wrap items-baseline gap-2">
                  <span className="capitalize">{d.kind.replace("_", " ")}</span>
                  <Chip tone={d.state === "in_packet" ? "moss" : d.state === "missing" && d.required ? "accent" : "neutral"}>{d.state === "in_packet" ? "in this packet" : d.state === "you_provide" ? "you attach this yourself" : d.required ? "required — missing" : "optional"}</Chip>
                  <span className="basis-full text-[12px] text-dim">“{d.mention}”</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {dirty && (
          <Notice tone="amber" title="You have unsaved changes">
            The packet above is what was last saved. Save your changes to see exactly what would be submitted — an earlier approval doesn&rsquo;t carry over.
            <span className="mt-3 flex gap-2"><Button variant="primary" size="sm" onClick={save} disabled={busy !== null}>{busy === "save" && <Loader2 size={13} className="animate-spin" />} Save changes</Button></span>
          </Notice>
        )}
      </section>

      {err && <Notice tone="accent" title="That didn't go through">{err}</Notice>}

      <Card className="flex flex-col gap-4 p-5">
        <Label>Approve and apply</Label>
        <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-muted">FRIDAY doesn&rsquo;t submit applications. Approving tells FRIDAY this is the content you intend to send; then you open the official application on <span className="text-text">{host(p.job.applyUrl)}</span> and submit it yourself.</p>
        <div className="flex flex-wrap gap-2">
          {!approved && (
            <Button variant="primary" disabled={!canApprove} onClick={() => run("approve", async () => { await api(`/api/applications/${applicationId}/packet/approve`, { method: "POST", json: { packetId: state.packetId, contentHash: state.contentHash, acknowledged: ticks } }); })}>
              {busy === "approve" && <Loader2 size={14} className="animate-spin" />} Approve this packet
            </Button>
          )}
          <Button variant={approved ? "primary" : "secondary"} disabled={!approved || dirty || busy !== null} onClick={() => run("handoff", async () => {
            const { url } = await api<{ url: string }>(`/api/applications/${applicationId}/packet/handoff`, { method: "POST" });
            window.open(url, "_blank", "noopener,noreferrer");
            setSubmittedAsk(true);
          })}>
            {busy === "handoff" ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpRight size={14} />} Open the official application
          </Button>
        </div>
        {!approved && <p className="text-[12px] text-dim">{blockers.length ? "Resolve the items above first." : dirty ? "Save your changes first." : !allTicked ? "Tick each confirmation to approve." : "Read the packet above, then approve it."}</p>}
        {approved && submittedAsk && (
          <div className="flex flex-col gap-2 border-t-[0.5px] border-hairline-strong pt-4">
            <p className="text-[13.5px]">Submitted it on the employer&rsquo;s site?</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => run("applied", async () => {
                await api(`/api/applications/${applicationId}`, { method: "PATCH", json: { status: "applied", ...(p.resume ? { resume_version_id: p.resume.versionId } : {}), ...(p.coverLetter ? { cover_letter: p.coverLetter.text } : {}) } });
              })}>{busy === "applied" && <Loader2 size={13} className="animate-spin" />} Yes, mark it Applied</Button>
              <Button size="sm" variant="ghost" onClick={() => setSubmittedAsk(false)}>Not yet</Button>
            </div>
            <p className="text-[12px] text-dim">Only mark it Applied if you actually submitted. FRIDAY can&rsquo;t see the employer&rsquo;s site and never marks an application submitted on its own.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
