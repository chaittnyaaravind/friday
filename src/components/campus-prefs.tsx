"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPUS_ROLE_LABEL, type CampusRole } from "@/lib/domain/campus";
import type { CampusPrefs } from "@/lib/domain/campus-fit";
import { api } from "./actions";
import { Button, Card, Field, Label, Select } from "./ui";

/** Role types a student can rank. Dining is excluded by rule, so it is never offered. */
const RANKABLE: CampusRole[] = ["front_desk_admin", "it_support", "library_assistant", "student_assistant", "research_assistant", "lab_assistant", "technical_media", "tutor_mentor", "teaching_assistant", "orientation_leader", "resident_advisor", "fitness_recreation"];

/**
 * Campus preferences: what the campus-fit ranking weighs. Saving re-ranks every on-campus job for you on the server
 * (PATCH /api/profile → rematch). Nothing is hidden by these, except that the SJSU page can filter by stated pay.
 */
export function CampusPrefsForm({ initial }: { initial: CampusPrefs }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const toggleRole = (r: CampusRole) => setP({ ...p, roles: p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r] });

  const save = async () => {
    setState("saving");
    setErr(null);
    try {
      await api("/api/profile", { method: "PATCH", json: { campus_prefs: p } });
      setState("saved");
      router.refresh();
    } catch (e) {
      setState("error");
      setErr((e as Error).message);
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-6 md:p-8">
      <div className="flex flex-col gap-1.5">
        <Label>Campus job preferences</Label>
        <p className="max-w-[62ch] text-[13px] leading-snug text-muted">These shape the campus-fit ranking on the SJSU page. Dining and food-service jobs are always excluded and are not listed here.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum hourly pay" hint="Jobs stating less rank lower. Jobs that do not state pay are never assumed to meet it.">
          <Select value={p.minHourly == null ? "" : String(p.minHourly)} onChange={(e) => setP({ ...p, minHourly: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No minimum</option>
            {[17, 18, 19, 20, 22, 25].map((v) => <option key={v} value={v}>${v}/hr</option>)}
          </Select>
        </Field>
        <Field label="Most hours per week" hint="F-1 students may work at most 20 hours a week on campus while classes are in session.">
          <Select value={p.maxWeeklyHours == null ? "" : String(p.maxWeeklyHours)} onChange={(e) => setP({ ...p, maxWeeklyHours: e.target.value ? Number(e.target.value) : null })}>
            <option value="">No limit</option>
            {[10, 12, 15, 20, 25, 30].map((v) => <option key={v} value={v}>{v} hours</option>)}
          </Select>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">Role types you want (ranked in the order you pick them)</legend>
        <div className="flex flex-wrap gap-1.5">
          {RANKABLE.map((r) => {
            const idx = p.roles.indexOf(r);
            return (
              <button key={r} type="button" aria-pressed={idx >= 0} onClick={() => toggleRole(r)} className={idx >= 0 ? "h-8 rounded-full bg-text px-3 text-[12.5px] text-bg" : "h-8 rounded-full px-3 text-[12.5px] text-muted hairline hover:text-text"}>
                {idx >= 0 && <span className="num mr-1 font-mono opacity-70">{idx + 1}</span>}{CAMPUS_ROLE_LABEL[r]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-3 py-1.5 text-[14px]">
          <input type="checkbox" checked={p.deskOnly} onChange={(e) => setP({ ...p, deskOnly: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
          <span>Desk jobs only<span className="block text-[12.5px] text-muted">Front desk, office, IT help desk and library roles, or duties stated as desk work — never physically demanding ones. Applies to the SJSU page and to Auto Hunter cards.</span></span>
        </label>
        <label className="flex items-start gap-3 py-1.5 text-[14px]">
          <input type="checkbox" checked={p.avoidPhysical} onChange={(e) => setP({ ...p, avoidPhysical: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
          <span>Rank physically demanding work lower<span className="block text-[12.5px] text-muted">Lifting, long standing, moving equipment — only when the duties say so.</span></span>
        </label>
        <label className="flex items-start gap-3 py-1.5 text-[14px]">
          <input type="checkbox" checked={p.avoidSchedule} onChange={(e) => setP({ ...p, avoidSchedule: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
          <span>Rank hard schedules lower<span className="block text-[12.5px] text-muted">Overnight, early-morning or required-weekend shifts stated in the posting.</span></span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? <Loader2 size={15} className="animate-spin" /> : null} Save and re-rank</Button>
        {state === "saved" && <span className="inline-flex items-center gap-1.5 text-[13px] text-moss"><Check size={14} /> Saved — campus jobs re-ranked</span>}
        {err && <span className="text-[13px] text-accent">{err}</span>}
      </div>
    </Card>
  );
}
