"use client";

/**
 * The hunt brief: onboarding as one question per screen. Every answer maps to a field FRIDAY already ranks on —
 * campus_prefs (role types, desk/active, hours, pay floor, schedule), work authorization, studies, skills — plus
 * `availability`, the sentence the email drafts use ("My availability: weekday afternoons, up to 15 hours a week.").
 * Nothing here is shared with an employer except that availability sentence, and only in a draft the student sends.
 */
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CAMPUS_ROLE_LABEL, type CampusRole } from "@/lib/domain/campus";
import type { CampusPrefs } from "@/lib/domain/campus-fit";
import { SKILLS } from "@/lib/domain/skills";
import { api } from "./actions";
import { EASE_OUT } from "./motion";
import type { ProfileValues } from "./profile-form";
import { Button, Input, Label, cx } from "./ui";

/** Dining is excluded by rule, so it is never offered (same list as campus-prefs.tsx). */
const TARGETS: { role: CampusRole; hint: string }[] = [
  { role: "front_desk_admin", hint: "Reception, offices, check-in desks" },
  { role: "it_support", hint: "Help desk, computer labs, tech support" },
  { role: "library_assistant", hint: "Circulation, shelving, study spaces" },
  { role: "student_assistant", hint: "General office and department help" },
  { role: "tutor_mentor", hint: "Tutoring, peer mentoring, writing help" },
  { role: "research_assistant", hint: "Faculty labs and research projects" },
  { role: "lab_assistant", hint: "Running and supporting teaching labs" },
  { role: "technical_media", hint: "AV, video, web and media work" },
  { role: "teaching_assistant", hint: "Grading and course support" },
  { role: "orientation_leader", hint: "Welcoming and guiding new students" },
  { role: "resident_advisor", hint: "Living in and supporting a residence hall" },
  { role: "fitness_recreation", hint: "Rec center, events, front of house" },
];

type Work = "desk" | "mostly_desk" | "active";
const WORK: { id: Work; title: string; hint: string }[] = [
  { id: "desk", title: "Desk work only", hint: "Front desk, office, IT help desk and library roles. Nothing physically demanding." },
  { id: "mostly_desk", title: "Mostly desk, some moving around", hint: "Desk roles first, but events, labs or shelving are fine. Heavy lifting ranks lower." },
  { id: "active", title: "Anything, active is fine", hint: "Rec center, events, moving equipment: all ranked on the same footing." },
];

type Slot = "mornings" | "afternoons" | "evenings" | "weekends";
const SLOTS: { id: Slot; title: string; text: string }[] = [
  { id: "mornings", title: "Weekday mornings", text: "weekday mornings" },
  { id: "afternoons", title: "Weekday afternoons", text: "weekday afternoons" },
  { id: "evenings", title: "Weekday evenings", text: "weekday evenings" },
  { id: "weekends", title: "Weekends", text: "weekends" },
];
const HOURS: { value: number | null; title: string }[] = [
  { value: 10, title: "Up to 10 hrs" }, { value: 15, title: "Up to 15 hrs" }, { value: 20, title: "Up to 20 hrs" }, { value: null, title: "As many as I can" },
];
const PAY: { value: number | null; title: string }[] = [
  { value: null, title: "Any pay" }, { value: 17, title: "$17+/hr" }, { value: 18, title: "$18+/hr" }, { value: 20, title: "$20+/hr" }, { value: 22, title: "$22+/hr" }, { value: 25, title: "$25+/hr" },
];
const AUTH: { value: string; title: string; hint?: string }[] = [
  { value: "f1", title: "F-1 student visa", hint: "On-campus work only, at most 20 hours a week while classes are in session." },
  { value: "us_citizen", title: "U.S. citizen" },
  { value: "permanent_resident", title: "Permanent resident" },
  { value: "other", title: "Other" },
  { value: "", title: "Prefer not to say" },
];
const QUICK_SKILLS = ["excel", "python", "java", "javascript", "typescript", "sql", "html", "css", "react", "cpp", "git", "linux", "figma", "ui-ux"];
const YEARS = [2026, 2027, 2028, 2029, 2030];

type Brief = {
  name: string; roles: CampusRole[]; work: Work; slots: Slot[]; hours: number | null; minHourly: number | null;
  auth: string; major: string; grad: string; skills: string[];
};

const STEPS = ["name", "target", "work", "when", "pay", "auth", "study", "skills", "review"] as const;
type Step = (typeof STEPS)[number];

/** "weekday afternoons and weekends, up to 15 hours a week" — or null when nothing was said. */
export function availabilityText(slots: Slot[], hours: number | null): string | null {
  const parts = SLOTS.filter((s) => slots.includes(s.id)).map((s) => s.text);
  const when = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "";
  const much = hours ? `up to ${hours} hours a week` : "";
  return [when, much].filter(Boolean).join(", ") || null;
}

const workOf = (p: CampusPrefs): Work => (p.deskOnly ? "desk" : p.avoidPhysical ? "mostly_desk" : "active");

export function HuntBrief({ profile, prefs }: { profile: ProfileValues; prefs: CampusPrefs }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [b, setB] = useState<Brief>({
    name: profile.full_name, roles: [], work: workOf(prefs), slots: [], hours: prefs.maxWeeklyHours,
    minHourly: prefs.minHourly, auth: profile.work_authorization, major: profile.major, grad: profile.graduation_year, skills: profile.skills,
  });
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step: Step = STEPS[i];
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setB((p) => ({ ...p, [k]: v }));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const canGo = step === "target" ? b.roles.length > 0 : true;
  const go = useCallback((d: number) => {
    setDir(d);
    setI((n) => Math.min(STEPS.length - 1, Math.max(0, n + d)));
  }, []);
  const jump = (s: Step) => { setDir(-1); setI(STEPS.indexOf(s)); };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const availability = availabilityText(b.slots, b.hours);
      await api("/api/profile", {
        method: "PATCH",
        json: {
          full_name: b.name.trim() || null,
          major: b.major.trim() || null,
          graduation_year: b.grad ? Number(b.grad) : null,
          work_authorization: b.auth || null,
          ...(availability ? { availability } : {}),
          origin: profile.origin,
          skills: b.skills,
          campus_prefs: {
            ...prefs,
            roles: b.roles,
            deskOnly: b.work === "desk",
            avoidPhysical: b.work !== "active",
            avoidSchedule: !b.slots.includes("weekends"),
            minHourly: b.minHourly,
            maxWeeklyHours: b.hours,
          },
          onboarded: true,
        },
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // Enter moves on; number keys pick the matching option on choice screens. Typing in a field is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (e.key === "Enter" && !e.shiftKey) {
        if (step === "review" || !canGo || (e.target as HTMLElement | null)?.closest?.("button")) return;
        e.preventDefault();
        go(1);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      const k = n - 1;
      if (step === "target" && TARGETS[k]) setB((p) => ({ ...p, roles: toggle(p.roles, TARGETS[k].role) }));
      if (step === "work" && WORK[k]) setB((p) => ({ ...p, work: WORK[k].id }));
      if (step === "when" && SLOTS[k]) setB((p) => ({ ...p, slots: toggle(p.slots, SLOTS[k].id) }));
      if (step === "pay" && PAY[k]) setB((p) => ({ ...p, minHourly: PAY[k].value }));
      if (step === "auth" && AUTH[k]) setB((p) => ({ ...p, auth: AUTH[k].value }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, canGo, go]);

  const motionProps = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 40 * dir, filter: "blur(8px)" },
        animate: { opacity: 1, x: 0, filter: "blur(0px)" },
        exit: { opacity: 0, x: -30 * dir, filter: "blur(6px)" },
      };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[720px] flex-col px-5 pb-8 pt-6 md:pt-10">
      <header className="flex items-center justify-between gap-4">
        <span className="flex items-baseline gap-2.5">
          <span className="text-[16px] font-medium tracking-[0.16em]">FRIDAY</span>
          <span className="label !text-[9.5px]">hunt brief</span>
        </span>
        <span className="label num">{String(i + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}</span>
      </header>
      <div className="relative mt-4 h-px bg-hairline-strong">
        <motion.div className="absolute inset-y-0 left-0 bg-accent" animate={{ width: `${((i + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
      </div>

      <div className="relative flex flex-1 flex-col justify-center py-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={step} {...motionProps} transition={{ duration: 0.45, ease: EASE_OUT }} className="flex flex-col gap-8">
            {step === "name" && (
              <Q eyebrow="Before the hunt" title={<>What should FRIDAY <span className="serif-em">call</span> you?</>} sub="Used on your resume and in the drafts FRIDAY writes for you.">
                <Input autoFocus value={b.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" className="h-14 !text-[22px]" />
              </Q>
            )}

            {step === "target" && (
              <Q eyebrow="The target" title={<>What are you <span className="serif-em">hunting</span>?</>} sub="Pick every kind of campus job you'd take, most wanted first. Dining jobs are never shown.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {TARGETS.map(({ role, hint }, k) => {
                    const at = b.roles.indexOf(role);
                    return <Option key={role} n={k + 1} on={at >= 0} rank={at >= 0 ? at + 1 : undefined} title={CAMPUS_ROLE_LABEL[role]} hint={hint} onClick={() => set("roles", toggle(b.roles, role))} />;
                  })}
                </div>
              </Q>
            )}

            {step === "work" && (
              <Q eyebrow="The terrain" title={<>What kind of <span className="serif-em">work</span>?</>} sub="Physical demands are read from each posting's duties, never guessed from the title.">
                <div className="flex flex-col gap-2">
                  {WORK.map((w, k) => <Option key={w.id} n={k + 1} on={b.work === w.id} title={w.title} hint={w.hint} onClick={() => set("work", w.id)} />)}
                </div>
              </Q>
            )}

            {step === "when" && (
              <Q eyebrow="Your hours" title={<>When are you <span className="serif-em">free</span> to work?</>} sub="Pick every time that works around your classes. FRIDAY uses this to rank shifts and to fill in your availability.">
                <div className="grid gap-2 sm:grid-cols-2">
                  {SLOTS.map((s, k) => <Option key={s.id} n={k + 1} on={b.slots.includes(s.id)} title={s.title} onClick={() => set("slots", toggle(b.slots, s.id))} />)}
                </div>
                <div className="flex flex-col gap-3">
                  <Label>Hours per week</Label>
                  <div className="flex flex-wrap gap-2">
                    {HOURS.map((h) => <Pill key={h.title} on={b.hours === h.value} onClick={() => set("hours", h.value)}>{h.title}</Pill>)}
                  </div>
                  {b.auth === "f1" && b.hours === null && <p className="text-[12.5px] text-amber">On an F-1 visa you can work at most 20 hours a week on campus while classes are in session.</p>}
                </div>
              </Q>
            )}

            {step === "pay" && (
              <Q eyebrow="The prize" title={<>Lowest <span className="serif-em">pay</span> you&apos;d take?</>} sub="Jobs below it rank lower, never hidden. Jobs that don't state pay are never assumed to meet it.">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PAY.map((p, k) => <Option key={p.title} n={k + 1} on={b.minHourly === p.value} title={p.title} onClick={() => set("minHourly", p.value)} />)}
                </div>
              </Q>
            )}

            {step === "auth" && (
              <Q eyebrow="Private" title={<>Your work <span className="serif-em">authorization</span>?</>} sub="Only used to show informational notes on postings. Never shared with an employer, and never legal advice.">
                <div className="flex flex-col gap-2">
                  {AUTH.map((a, k) => <Option key={a.title} n={k + 1} on={b.auth === a.value} title={a.title} hint={a.hint} onClick={() => set("auth", a.value)} />)}
                </div>
              </Q>
            )}

            {step === "study" && (
              <Q eyebrow="Your studies" title={<>What are you <span className="serif-em">studying</span>?</>} sub="Goes on your resume and helps rank research, lab and tutoring roles.">
                <Input value={b.major} onChange={(e) => set("major", e.target.value)} placeholder="Computer Science" list="brief-majors" className="h-12 !text-[17px]" />
                <datalist id="brief-majors">{["Computer Science", "Software Engineering", "Computer Engineering", "Data Science", "Electrical Engineering", "Business Administration", "Psychology", "Biology"].map((m) => <option key={m} value={m} />)}</datalist>
                <div className="flex flex-col gap-3">
                  <Label>Graduating</Label>
                  <div className="flex flex-wrap gap-2">
                    {YEARS.map((y) => <Pill key={y} on={b.grad === String(y)} onClick={() => set("grad", b.grad === String(y) ? "" : String(y))}>{y}</Pill>)}
                  </div>
                </div>
              </Q>
            )}

            {step === "skills" && (
              <Q eyebrow="Your gear" title={<>What have you actually <span className="serif-em">used</span>?</>} sub="Only pick what you could talk about in an interview. Uploading your resume later adds the rest it finds.">
                <div className="flex flex-wrap gap-2">
                  {SKILLS.filter((s) => QUICK_SKILLS.includes(s.slug)).map((s) => (
                    <Pill key={s.slug} on={b.skills.includes(s.slug)} onClick={() => set("skills", toggle(b.skills, s.slug))}>{s.name}</Pill>
                  ))}
                </div>
              </Q>
            )}

            {step === "review" && (
              <Q eyebrow="Brief locked" title={<>Ready to <span className="serif-em">hunt</span>, {b.name.trim().split(/\s+/)[0] || "hunter"}.</>} sub="Check your brief. You can change any of it later in Settings.">
                <dl className="card divide-y divide-[var(--hairline)] overflow-hidden">
                  {[
                    ["target", "Hunting", b.roles.map((r) => CAMPUS_ROLE_LABEL[r]).join(", ")],
                    ["work", "Work", WORK.find((w) => w.id === b.work)?.title],
                    ["when", "Free", availabilityText(b.slots, b.hours) ?? "Not set"],
                    ["pay", "Pay floor", PAY.find((p) => p.value === b.minHourly)?.title],
                    ["study", "Studies", [b.major, b.grad && `class of ${b.grad}`].filter(Boolean).join(", ") || "Not set"],
                    ["skills", "Skills", `${b.skills.length} selected`],
                  ].map(([s, k, v]) => (
                    <div key={k} className="flex items-baseline gap-4 px-5 py-3.5">
                      <dt className="label w-20 shrink-0">{k}</dt>
                      <dd className="min-w-0 flex-1 text-[14.5px]">{v}</dd>
                      <button type="button" onClick={() => jump(s as Step)} className="text-[12.5px] text-muted hover:text-text">Edit</button>
                    </div>
                  ))}
                </dl>
                {error && <p role="alert" className="text-[13px] text-amber">{error}</p>}
              </Q>
            )}
          </motion.section>
        </AnimatePresence>
      </div>

      <footer className="sticky bottom-0 z-10 -mx-5 flex items-center justify-between gap-4 bg-glass px-5 py-3 backdrop-blur-xl [box-shadow:inset_0_0.5px_0_var(--hairline-strong)] md:static md:mx-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none">
        <Button variant="ghost" onClick={() => go(-1)} disabled={i === 0} className={cx(i === 0 && "invisible")}>
          <ArrowLeft size={15} /> Back
        </Button>
        <div className="flex items-center gap-4">
          {step !== "review" && <span className="label hidden sm:inline">Press Enter ↵</span>}
          {step === "review" ? (
            <Button variant="primary" size="lg" onClick={finish} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} Start the hunt
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(1)} disabled={!canGo}>
              {step === "skills" && !b.skills.length ? "Skip for now" : "Continue"} <ArrowRight size={16} />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Q({ eyebrow, title, sub, children }: { eyebrow: string; title: React.ReactNode; sub: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Label className="!text-accent">{eyebrow}</Label>
        <h1 className="text-[40px] font-[450] leading-[0.98] tracking-[-0.04em] md:text-[56px]">{title}</h1>
        <p className="max-w-[56ch] text-[15px] leading-relaxed text-muted">{sub}</p>
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </>
  );
}

function Option({ n, on, title, hint, rank, onClick }: { n: number; on: boolean; title: string; hint?: string; rank?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "group flex items-start gap-3 rounded-[14px] p-4 text-left transition-[background-color,box-shadow] duration-150",
        on ? "bg-accent-soft [box-shadow:inset_0_0_0_1px_var(--accent)]" : "bg-surface-1 hairline hover:bg-surface-2",
      )}
    >
      <span className={cx("num grid size-6 shrink-0 place-items-center rounded-[7px] font-mono text-[11px]", on ? "bg-accent text-accent-ink" : "text-dim hairline")}>
        {on ? (rank ?? <Check size={12} strokeWidth={2.6} />) : n}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px]">{title}</span>
        {hint && <span className="text-[12.5px] leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx("h-10 rounded-full px-4 text-[14px] transition-[background-color,box-shadow,color] duration-150", on ? "bg-text text-bg" : "text-muted hairline hover:text-text")}>
      {children}
    </button>
  );
}
