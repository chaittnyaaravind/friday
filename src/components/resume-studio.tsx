"use client";

import { Download, FileUp, Loader2, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { skillBySlug } from "@/lib/domain/skills";
import { Button, Card, Chip, Label, Notice, Textarea, cx } from "./ui";

export function ResumeUpload({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<{ skills: string[]; note: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("primary", "true");
    try {
      const res = await fetch("/api/resumes", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setResult(data);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        className={cx("card flex flex-col items-center gap-3 px-6 py-10 text-center transition-colors", drag ? "bg-accent-soft" : "hover:bg-surface-2")}
        style={{ boxShadow: "inset 0 0 0 1px var(--hairline-strong)", borderRadius: 16 }}
      >
        {busy ? <Loader2 size={22} className="animate-spin text-accent" /> : <FileUp size={22} strokeWidth={1.5} className="text-muted" />}
        <span className="text-[15px]">{busy ? "Reading your resume…" : hasResume ? "Upload a new version" : "Drop your resume here"}</span>
        <span className="text-[12.5px] text-dim">PDF, DOCX or TXT · up to 5 MB · stored privately</span>
      </button>
      <input ref={input} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {err && <p className="text-[13px] text-accent">{err}</p>}
      {result && (
        <Notice tone="moss" title={`Found ${result.skills.length} skills — your matches were re-ranked.`}>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.skills.slice(0, 24).map((s) => <Chip key={s} tone="moss">{skillBySlug(s)?.name ?? s}</Chip>)}
          </div>
          {result.note && <p className="mt-2">{result.note}</p>}
        </Notice>
      )}
    </div>
  );
}

type Tailored = {
  summary: string | null;
  skills: string[];
  experience: { title: string; organization: string; start: string | null; end: string | null; bullets: string[] }[];
  projects: { name: string; technologies: string[]; bullets: string[] }[];
  education: { school: string; degree: string | null; field: string | null; end: string | null; gpa: string | null }[];
  changes: { what: string; why: string }[];
  suggestions: string[];
};

function toText(t: Tailored, name: string | null, contact: string) {
  const out: string[] = [];
  if (name) out.push(name.toUpperCase());
  if (contact) out.push(contact);
  if (t.summary) out.push("", t.summary);
  if (t.education.length) {
    out.push("", "EDUCATION");
    for (const e of t.education) out.push(`${e.school} — ${[e.degree, e.field].filter(Boolean).join(", ")}${e.end ? ` (${e.end})` : ""}${e.gpa ? ` · GPA ${e.gpa}` : ""}`);
  }
  if (t.skills.length) out.push("", "SKILLS", t.skills.join(", "));
  if (t.experience.length) {
    out.push("", "EXPERIENCE");
    for (const e of t.experience) {
      out.push(`${e.title}, ${e.organization}${e.start || e.end ? ` (${[e.start, e.end].filter(Boolean).join(" – ")})` : ""}`);
      for (const b of e.bullets) out.push(`• ${b}`);
      out.push("");
    }
  }
  if (t.projects.length) {
    out.push("PROJECTS");
    for (const p of t.projects) {
      out.push(`${p.name}${p.technologies.length ? ` — ${p.technologies.join(", ")}` : ""}`);
      for (const b of p.bullets) out.push(`• ${b}`);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Original ↓ Tailored ↓ Download / Edit. Edits stay local; download as text or print to PDF. */
export function VersionView({ label, tailored, original, name, contact }: { label: string; tailored: Tailored; original: string; name: string | null; contact: string }) {
  const [text, setText] = useState(() => toText(tailored, name, contact));
  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${label.replace(/[^\w\- ]+/g, "").slice(0, 60) || "resume"}.txt` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><title>${esc(label)}</title><style>body{font:11pt/1.45 Georgia,serif;max-width:7.2in;margin:.6in auto;white-space:pre-wrap;color:#111}</style><body>${esc(text)}</body>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <Label>Original</Label>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-muted">{original}</pre>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <Label className="!text-accent">Tailored · editable</Label>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={download}><Download size={14} /> .txt</Button>
              <Button size="sm" variant="ghost" onClick={print}><Printer size={14} /> PDF</Button>
            </div>
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[520px] font-sans text-[12.5px]" />
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <Label>What FRIDAY changed</Label>
          <ul className="flex flex-col gap-2 text-[13px]">
            {tailored.changes.map((c, i) => <li key={i}><span className="text-text">{c.what}</span> <span className="text-muted">— {c.why}</span></li>)}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <Label>Honest ways to close the gap</Label>
          <ul className="flex flex-col gap-2 text-[13px] text-muted">
            {tailored.suggestions.length ? tailored.suggestions.map((s, i) => <li key={i}>{s}</li>) : <li>No gaps flagged for this role.</li>}
          </ul>
          <p className="text-[11.5px] text-dim">FRIDAY never adds experience, skills or achievements you didn&apos;t provide.</p>
        </Card>
      </div>
    </div>
  );
}
