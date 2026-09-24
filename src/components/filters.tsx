"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CATEGORIES } from "@/lib/domain/normalize";
import { Input, Select, cx } from "./ui";

const TYPES = [
  { v: "", l: "All types" },
  { v: "internship,co_op", l: "Internships" },
  { v: "on_campus", l: "On-campus" },
  { v: "part_time", l: "Part-time" },
  { v: "full_time", l: "Full-time / new grad" },
  { v: "research", l: "Research" },
];

type Preset = { hideType?: boolean; hideCategory?: boolean; isF1?: boolean };

export function Filters({ preset = {}, total }: { preset?: Preset; total: number }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [more, setMore] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("offset");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };

  // Debounced keyword search.
  useEffect(() => {
    const t = setTimeout(() => (q !== (sp.get("q") ?? "") ? set({ q: q || null }) : undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggle = (k: string) => set({ [k]: sp.get(k) === "1" ? null : "1" });
  const active = [...sp.keys()].filter((k) => !["sort", "offset"].includes(k)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row">
        <label className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles, skills, companies…" className="h-11 pl-10" aria-label="Search" />
        </label>
        <div className="flex gap-2">
          <Select value={sp.get("sort") ?? ""} onChange={(e) => set({ sort: e.target.value || null })} className="h-11 w-auto min-w-[150px]" aria-label="Sort">
            <option value="">Best match</option>
            <option value="new">Newest</option>
            <option value="distance">Closest</option>
            <option value="deadline">Deadline soon</option>
            {sp.get("q") && <option value="relevance">Keyword relevance</option>}
          </Select>
          <button onClick={() => setMore((m) => !m)} className={cx("inline-flex h-11 items-center gap-2 rounded-[10px] px-3.5 text-[14px] hairline transition-colors", more ? "bg-surface-3 text-text" : "bg-surface-2 text-muted hover:text-text")}>
            <SlidersHorizontal size={15} /> Filters{active ? <span className="num font-mono text-[11px] text-accent">{active}</span> : null}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {!preset.hideType &&
          TYPES.map((t) => (
            <Pill key={t.l} on={(sp.get("type") ?? "") === t.v} onClick={() => set({ type: t.v || null })}>{t.l}</Pill>
          ))}
        <Pill on={sp.get("remote") === "1"} onClick={() => toggle("remote")}>Remote</Pill>
        <Pill on={sp.get("hybrid") === "1"} onClick={() => toggle("hybrid")}>Hybrid</Pill>
        <Pill on={sp.get("saved") === "1"} onClick={() => toggle("saved")}>Saved</Pill>
        {preset.isF1 && <Pill on={sp.get("hideRestricted") === "1"} onClick={() => toggle("hideRestricted")}>Hide citizenship/clearance-only</Pill>}
        <span className={cx("ml-auto text-[12px] text-dim transition-opacity", pending && "opacity-50")}>
          <span className="num font-mono">{total}</span> result{total === 1 ? "" : "s"}
        </span>
      </div>

      {more && (
        <div className="reveal card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Sel label="Distance" value={sp.get("miles") ?? ""} onChange={(v) => set({ miles: v || null })}>
            <option value="">Any distance</option>
            <option value="5">Within 5 miles</option>
            <option value="10">Within 10 miles</option>
            <option value="25">Within 25 miles</option>
            <option value="45">Anywhere in Silicon Valley</option>
          </Sel>
          {!preset.hideCategory && (
            <Sel label="Category" value={sp.get("category") ?? ""} onChange={(v) => set({ category: v || null })}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Sel>
          )}
          <Sel label="Date posted" value={sp.get("posted") ?? ""} onChange={(v) => set({ posted: v || null })}>
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">This week</option>
            <option value="30">This month</option>
          </Sel>
          <Sel label="Deadline" value={sp.get("deadline") ?? ""} onChange={(v) => set({ deadline: v || null })}>
            <option value="">Any deadline</option>
            <option value="7">Closes within 7 days</option>
            <option value="30">Closes within 30 days</option>
          </Sel>
          <Sel label="Source" value={sp.get("source") ?? ""} onChange={(v) => set({ source: v || null })}>
            <option value="">All sources</option>
            <option value="sjsu_page">Official SJSU pages</option>
            <option value="workday,greenhouse,lever,ashby,smartrecruiters">Company career sites</option>
            <option value="handshake_import">Handshake (imported)</option>
            <option value="linkedin_import,indeed_import">LinkedIn / Indeed (imported)</option>
          </Sel>
          <Sel label="Skill" value={sp.get("skills") ?? ""} onChange={(v) => set({ skills: v || null })}>
            <option value="">Any skill</option>
            {["java", "python", "javascript", "typescript", "cpp", "go", "react", "nodejs", "sql", "aws", "ml", "pytorch", "kubernetes", "embedded", "linux"].map((s) => (
              <option key={s} value={s}>{s === "cpp" ? "C++" : s === "ml" ? "Machine Learning" : s === "nodejs" ? "Node.js" : s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </Sel>
          <Sel label="Industry" value={sp.get("industry") ?? ""} onChange={(v) => set({ industry: v || null })}>
            <option value="">All industries</option>
            {["Semiconductors", "Software", "AI", "Fintech", "Security", "Autonomy", "Storage", "Networking", "Developer Tools", "Consumer"].map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </Sel>
          <div className="flex items-end">
            <button onClick={() => start(() => router.replace(path, { scroll: false }))} className="inline-flex h-10 items-center gap-1.5 text-[13px] text-muted hover:text-text">
              <X size={14} /> Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cx("h-8 rounded-full px-3.5 text-[13px] transition-[background-color,color,box-shadow] duration-150", on ? "bg-text text-bg" : "text-muted hairline hover:text-text")}>
      {children}
    </button>
  );
}

function Sel({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>{children}</Select>
    </label>
  );
}
