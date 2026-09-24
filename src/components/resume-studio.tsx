"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { cx } from "./ui";

type UploadResult = { added: number; skipped: number; needsConfirmation: number };

/** Upload → local parse (no AI) → straight to the review screen. */
export function ResumeUpload({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/resumes", { method: "POST", body: fd });
      const data = (await res.json()) as UploadResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (!data.added) {
        setNote(`Nothing new — all ${data.skipped} items are already in your profile.`);
        setBusy(false);
        router.refresh();
        return;
      }
      router.push("/resume/review");
    } catch (e) {
      setErr((e as Error).message);
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
        disabled={busy}
        className={cx("card flex flex-col items-center gap-3 px-6 py-10 text-center transition-colors", drag ? "bg-accent-soft" : "hover:bg-surface-2")}
        style={{ boxShadow: "inset 0 0 0 1px var(--hairline-strong)", borderRadius: 16 }}
      >
        {busy ? <Loader2 size={22} className="animate-spin text-accent" /> : <FileUp size={22} strokeWidth={1.5} className="text-muted" />}
        <span className="text-[15px]">{busy ? "Reading your resume…" : hasResume ? "Upload a new version" : "Drop your resume here"}</span>
        <span className="text-[12.5px] text-dim">PDF, DOCX or TXT · up to 5 MB · read locally, no AI · original kept untouched</span>
      </button>
      <input ref={input} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {err && <p className="text-[13px] text-accent">{err}</p>}
      {note && <p className="text-[13px] text-muted">{note}</p>}
    </div>
  );
}
