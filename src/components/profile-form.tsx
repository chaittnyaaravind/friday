"use client";

import { Check, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BAY_AREA_CITIES } from "@/lib/domain/geo";
import { ISSS_NOTICE } from "@/lib/domain/match";
import { SKILLS, type SkillCategory } from "@/lib/domain/skills";
import { api } from "./actions";
import { Button, Card, Field, Input, Label, Select, cx } from "./ui";

export type ProfileValues = {
  full_name: string; major: string; graduation_year: string; gpa: string; work_authorization: string;
  origin: string; radius_miles: number; workplace: "onsite" | "hybrid" | "remote" | "any";
  desired_titles: string; github_url: string; linkedin_url: string; portfolio_url: string; digest_enabled: boolean; skills: string[];
};

const CAT_LABEL: Partial<Record<SkillCategory, string>> = {
  language: "Languages", frontend: "Frontend", backend: "Backend", database: "Databases", data: "Data", ml: "AI / ML",
  cloud: "Cloud", devops: "DevOps", mobile: "Mobile", testing: "Testing", security: "Security", systems: "Systems", cs: "CS fundamentals", tools: "Tools", design: "Design",
};

export function ProfileForm({ initial, mode }: { initial: ProfileValues; mode: "onboarding" | "settings" }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ProfileValues>(k: K, val: ProfileValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const skillSet = new Set(v.skills);

  const grouped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = SKILLS.filter((s) => !needle || s.aliases.some((a) => a.includes(needle)));
    const m = new Map<SkillCategory, typeof SKILLS>();
    for (const s of list) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [q]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/profile", {
        method: "PATCH",
        json: {
          full_name: v.full_name || null,
          major: v.major || null,
          graduation_year: v.graduation_year ? Number(v.graduation_year) : null,
          gpa: v.gpa ? Number(v.gpa) : null,
          work_authorization: v.work_authorization || null,
          origin: v.origin,
          radius_miles: v.radius_miles,
          workplace: v.workplace,
          desired_titles: v.desired_titles.split(",").map((s) => s.trim()).filter(Boolean),
          github_url: v.github_url,
          linkedin_url: v.linkedin_url,
          portfolio_url: v.portfolio_url,
          digest_enabled: v.digest_enabled,
          skills: v.skills,
          ...(mode === "onboarding" ? { onboarded: true } : {}),
        },
      });
      if (mode === "onboarding") router.push("/dashboard");
      else {
        setMsg({ ok: true, text: "Saved — every opportunity was re-ranked for you." });
        router.refresh();
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-10">
      <Section title="About you" eyebrow="01">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={v.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Your name" /></Field>
          <Field label="Major"><Input value={v.major} onChange={(e) => set("major", e.target.value)} placeholder="Computer Science" list="majors" /></Field>
          <datalist id="majors">{["Computer Science", "Software Engineering", "Computer Engineering", "Data Science", "Electrical Engineering", "Applied Mathematics"].map((m) => <option key={m} value={m} />)}</datalist>
          <Field label="Graduation year"><Input type="number" min={2024} max={2035} value={v.graduation_year} onChange={(e) => set("graduation_year", e.target.value)} placeholder="2027" /></Field>
          <Field label="GPA" hint="Optional — only used if you choose to share it."><Input type="number" step="0.01" min={0} max={4.5} value={v.gpa} onChange={(e) => set("gpa", e.target.value)} placeholder="—" /></Field>
        </div>
      </Section>

      <Section title="Work authorization" eyebrow="02">
        <Field label="Status" hint="Used only to show informational notes on postings. Never shared with employers.">
          <Select value={v.work_authorization} onChange={(e) => set("work_authorization", e.target.value)}>
            <option value="">Prefer not to say</option>
            <option value="f1">F-1 student visa</option>
            <option value="us_citizen">U.S. citizen</option>
            <option value="permanent_resident">Permanent resident</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        {v.work_authorization === "f1" && (
          <p className="text-[12.5px] leading-relaxed text-muted">FRIDAY will separate on-campus roles (potentially relevant) from internships that may need CPT/OPT (requires verification). This is never legal advice. {ISSS_NOTICE}</p>
        )}
      </Section>

      <Section title="Where you want to work" eyebrow="03">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Search from" hint="Distances are computed privately on FRIDAY's server.">
            <Select value={v.origin} onChange={(e) => set("origin", e.target.value)}>
              <option value="SJSU Campus">SJSU Campus</option>
              {BAY_AREA_CITIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Radius">
            <Select value={v.radius_miles} onChange={(e) => set("radius_miles", Number(e.target.value))}>
              <option value={5}>Within 5 miles</option>
              <option value={10}>Within 10 miles</option>
              <option value={25}>Within 25 miles</option>
              <option value={45}>Anywhere in Silicon Valley</option>
              <option value={100}>Greater Bay Area</option>
            </Select>
          </Field>
          <Field label="Workplace">
            <Select value={v.workplace} onChange={(e) => set("workplace", e.target.value as ProfileValues["workplace"])}>
              <option value="any">Any</option>
              <option value="onsite">On-site</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
            </Select>
          </Field>
        </div>
        <Field label="Roles you want" hint="Comma-separated, e.g. Software Engineering Intern, Backend Intern, Lab Assistant">
          <Input value={v.desired_titles} onChange={(e) => set("desired_titles", e.target.value)} />
        </Field>
      </Section>

      <Section title="Skills" eyebrow="04" id="skills">
        <p className="-mt-2 text-[13px] text-muted">FRIDAY compares these to every posting. Uploading a resume adds the skills it finds automatically.</p>
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter skills…" className="pl-10" />
        </label>
        <div className="flex flex-col gap-5">
          {grouped.map(([cat, list]) => (
            <div key={cat} className="flex flex-col gap-2">
              <Label>{CAT_LABEL[cat] ?? cat}</Label>
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => {
                  const on = skillSet.has(s.slug);
                  return (
                    <button key={s.slug} type="button" aria-pressed={on} onClick={() => set("skills", on ? v.skills.filter((x) => x !== s.slug) : [...v.skills, s.slug])} className={cx("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150", on ? "bg-moss-soft text-moss [box-shadow:inset_0_0_0_0.5px_var(--moss)]" : "text-muted hairline hover:text-text")}>
                      {on && <Check size={12} strokeWidth={2.4} />}{s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-dim"><span className="num font-mono text-muted">{v.skills.length}</span> selected</p>
      </Section>

      <Section title="Links" eyebrow="05">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GitHub"><Input type="url" value={v.github_url} onChange={(e) => set("github_url", e.target.value)} placeholder="https://github.com/…" /></Field>
          <Field label="LinkedIn"><Input type="url" value={v.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" /></Field>
          <Field label="Portfolio"><Input type="url" value={v.portfolio_url} onChange={(e) => set("portfolio_url", e.target.value)} placeholder="https://…" /></Field>
        </div>
        <label className="flex items-center gap-3 text-[14px]">
          <input type="checkbox" checked={v.digest_enabled} onChange={(e) => set("digest_enabled", e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Daily digest — “FRIDAY found 12 new opportunities today.”
        </label>
      </Section>

      <div className="sticky bottom-24 z-20 flex items-center justify-between gap-4 rounded-2xl bg-glass p-3 pl-5 backdrop-blur-xl [box-shadow:inset_0_0_0_0.5px_var(--hairline-strong),var(--shadow)] md:bottom-6">
        <span className={cx("text-[13px]", msg ? (msg.ok ? "text-moss" : "text-accent") : "text-dim")}>{msg?.text ?? (mode === "onboarding" ? "You can change all of this later in Settings." : "Changes re-rank your matches.")}</span>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />} {mode === "onboarding" ? "Start FRIDAY" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, eyebrow, id, children }: { title: string; eyebrow: string; id?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="grid gap-5 p-6 md:grid-cols-[200px_1fr] md:gap-8 md:p-8">
      <div className="flex flex-col gap-1.5">
        <Label>{eyebrow}</Label>
        <h2 className="text-[20px]">{title}</h2>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </Card>
  );
}
