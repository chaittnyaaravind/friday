import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { campusOverview, eventsSince, type OverviewApp, type OverviewEvent, type OverviewJob } from "@/lib/domain/campus-overview";
import { shortDate } from "@/lib/format";
import { Card, Label } from "./ui";

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** SJSU dashboard strip. Every number is counted from the catalog and the student's tracker; nothing is estimated. */
export async function CampusOverviewStrip({ db, userId }: { db: SupabaseClient; userId: string }) {
  const { data: rows, error } = await db
    .from("jobs")
    .select("id, title, excluded_reason, deadline, discovered_at, is_baseline, pay_hourly_min, pay_hourly_max, campus_roles, physical_demand, companies(name)")
    .eq("is_on_campus", true)
    .eq("status", "active")
    .limit(1000);
  if (error) return <p className="text-[12.5px] text-dim">The campus overview is unavailable right now ({error.message}).</p>;
  const jobs: OverviewJob[] = (rows ?? []).map((r) => ({ ...(r as unknown as OverviewJob), company: (r.companies as unknown as { name: string } | null)?.name ?? "" }));
  const ids = jobs.map((j) => j.id);
  const since = eventsSince();
  const [{ data: events }, { data: apps }] = await Promise.all([
    ids.length ? db.from("job_events").select("job_id, kind, created_at, changes").in("job_id", ids.slice(0, 500)).eq("kind", "updated").gte("created_at", since) : Promise.resolve({ data: [] }),
    db.from("applications").select("status, submission_evidence, job_id").eq("user_id", userId),
  ]);
  const o = campusOverview(jobs, (events ?? []) as OverviewEvent[], (apps ?? []) as OverviewApp[]);

  const tile = (label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <Card className="flex flex-col gap-2 p-4">
      <Label>{label}</Label>
      <span className="num text-[26px] font-light leading-none tracking-[-0.03em]">{value}</span>
      {note && <span className="text-[11.5px] leading-snug text-dim">{note}</span>}
    </Card>
  );

  return (
    <section aria-label="Campus overview" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tile("Open to apply now", o.open, `${o.desk} desk job${o.desk === 1 ? "" : "s"} · ${o.excluded ? `${o.excluded} dining / staff listing${o.excluded === 1 ? "" : "s"} excluded` : "none excluded"}`)}
        {tile("New this week", o.newThisWeek.length, "First seen by FRIDAY in the last 7 days")}
        {tile("Stated pay", o.pay.min != null && o.pay.max != null ? (o.pay.min === o.pay.max ? `${money(o.pay.max)}/hr` : `${money(o.pay.min)}–${money(o.pay.max)}`) : "—", `${o.pay.stated} state an hourly rate · ${o.pay.unknown} do not`)}
        {tile("Your campus applications", o.applications.tracked, o.applications.tracked ? `${o.applications.preparing} preparing · ${o.applications.submittedUnverified + o.applications.submittedConfirmed} submitted (${o.applications.submittedUnverified} unverified) · ${o.applications.interviewing} interviewing` : "Save a job to start tracking it")}
      </div>
      {o.byEmployer.length > 0 && (
        <p className="text-[12.5px] text-muted">
          {o.byEmployer.map((e) => `${e.company.replace(/^SJSU /, "")} ${e.open}${e.desk ? ` (${e.desk} desk)` : ""}`).join(" · ")}
        </p>
      )}
      {(o.closing.length > 0 || o.changed.length > 0 || o.newThisWeek.length > 0) && (
        <div className="grid gap-2 md:grid-cols-3">
          {[
            { label: "Closing in the next 14 days", items: o.closing.map((c) => ({ id: c.id, text: c.title, note: shortDate(c.deadline) })) },
            { label: "Changed this week", items: o.changed.map((c) => ({ id: c.id, text: c.title, note: c.what.join(", ") })) },
            { label: "Newly posted", items: o.newThisWeek.map((n) => ({ id: n.id, text: n.title, note: n.company.replace(/^SJSU /, "") })) },
          ].map((g) => (
            <Card key={g.label} className="flex flex-col gap-2 p-4">
              <Label>{g.label}</Label>
              {g.items.length ? (
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <Link href={`/jobs/${i.id}`} className="truncate hover:underline">{i.text}</Link>
                      <span className="shrink-0 text-[11.5px] text-dim">{i.note}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-dim">None.</p>}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
