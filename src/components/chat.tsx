"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { cx } from "./ui";

type Msg = { role: "user" | "assistant"; content: string; mode?: "ai" | "local" };

const PROMPTS = [
  "Find me SJSU jobs posted this week.",
  "Find CS internships within 10 miles.",
  "Which internships match my Java skills?",
  "Show me companies hiring CS interns around San Jose.",
  "What should I learn to qualify for my top match?",
  "Which applications need follow-up?",
];

const TOOL_LABEL: Record<string, string> = {
  search_opportunities: "Searching opportunities",
  get_opportunity: "Reading the posting",
  list_applications: "Checking your applications",
  list_follow_ups: "Checking follow-ups",
  get_profile: "Reading your profile",
  skill_gap: "Comparing requirements",
  tailor_resume: "Tailoring your resume",
};

export function Chat({ claude }: { claude: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, tool]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const append = (t: string) => setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], content: m[m.length - 1].content + t }]);
    const setMode = (mode: Msg["mode"]) => setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], mode }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }) });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        append(e.error ?? "Something went wrong.");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const ev = JSON.parse(p.slice(6)) as { type: string; text?: string; name?: string; error?: string; mode?: Msg["mode"] };
          if (ev.type === "mode") setMode(ev.mode);
          else if (ev.type === "text") { setTool(null); append(ev.text!); }
          else if (ev.type === "tool") setTool(TOOL_LABEL[ev.name!] ?? "Working");
          else if (ev.type === "error") append(`\n\n${ev.error}`);
        }
      }
    } catch {
      append("\n\nConnection lost — try again.");
    } finally {
      setBusy(false);
      setTool(null);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-220px)] flex-col">
      <div className="flex flex-1 flex-col gap-6 pb-40">
        {!msgs.length && (
          <div className="reveal flex flex-col gap-8 pt-4">
            <div className="flex flex-col gap-3">
              <span className="label">FRIDAY AI</span>
              <h1 className="text-[38px] leading-[1.02] md:text-[54px]">What are we <span className="serif-em">hunting</span> for?</h1>
              <p className="max-w-[52ch] text-[15px] text-muted">Ask about jobs, your matches, what to learn, or your applications. FRIDAY answers from verified listings and your own tracker — it never invents a job or submits anything for you.</p>
            </div>
            <p className="flex items-center gap-2 text-[12.5px] text-dim"><span className={cx("size-1.5 rounded-full", claude ? "bg-moss" : "bg-accent")} />{claude ? "Uses a free AI model when it's available; otherwise FRIDAY Local answers straight from your data." : "Running on FRIDAY Local — answers come straight from your data, no AI account needed."}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROMPTS.map((p) => (
                <button key={p} onClick={() => send(p)} className="card card-hover p-4 text-left text-[14px] text-muted hover:text-text disabled:opacity-50">{p}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx("reveal flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <div className="max-w-[80%] rounded-[18px] rounded-br-md bg-surface-3 px-4 py-2.5 text-[14.5px]">{m.content}</div>
            ) : (
              <div className="max-w-[92%] text-[15px] leading-[1.7]">
                <span className="label mb-1.5 flex items-center gap-2">FRIDAY{m.mode === "local" && <span title="Answered by FRIDAY's own engine from your data — no AI service used" className="rounded-full px-1.5 py-px normal-case tracking-normal text-dim [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong)]">Local</span>}</span>
                {m.content ? <Markdown text={m.content} /> : <span className="inline-flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> {tool ?? "Thinking"}…</span>}
                {m.content && busy && i === msgs.length - 1 && tool && <span className="mt-2 flex items-center gap-2 text-[12.5px] text-dim"><Loader2 size={12} className="animate-spin" /> {tool}…</span>}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="fixed inset-x-3 bottom-[calc(max(12px,env(safe-area-inset-bottom))+76px)] z-30 md:sticky md:inset-x-auto md:bottom-6">
        <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-[22px] bg-glass p-2 pl-4 backdrop-blur-xl [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder="Ask FRIDAY…"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-dim"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-[opacity,transform] active:scale-95 disabled:opacity-35">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Minimal, safe markdown: paragraphs, bullets, **bold**, [links](...). Internal links stay in-app. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return <ul key={i} className="flex list-none flex-col gap-1.5">{lines.map((l, j) => <li key={j} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:size-1 before:rounded-full before:bg-dim"><Inline s={l.replace(/^\s*([-*•]|\d+\.)\s+/, "")} /></li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline s={l} /></Fragment>)}</p>;
      })}
    </div>
  );
}

function Inline({ s }: { s: string }) {
  const parts = s.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i} className="font-medium text-text"><Inline s={bold[1]} /></strong>;
        const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          if (href.startsWith("/")) return <Link key={i} href={href} className="text-text underline decoration-accent/50 underline-offset-4 hover:decoration-accent">{label}</Link>;
          if (/^https?:\/\//.test(href)) return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-text underline decoration-hairline-strong underline-offset-4">{label}</a>;
          return <span key={i}>{label}</span>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}
