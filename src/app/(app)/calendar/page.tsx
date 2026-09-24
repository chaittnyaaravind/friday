import { format, parseISO } from "date-fns";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { Card, EmptyState, Label, PageHeader, cx } from "@/components/ui";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Calendar" };

type Item = { at: string; allDay: boolean; kind: "interview" | "follow_up" | "deadline"; title: string; sub: string; href: string };

const TONE = { interview: "bg-moss", follow_up: "bg-accent", deadline: "bg-amber" } as const;
const KIND = { interview: "Interview", follow_up: "Follow-up", deadline: "Deadline" } as const;

export default async function CalendarPage() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const now = new Date();
  const from = new Date(now.getTime() - 86_400_000).toISOString();
  const to = new Date(now.getTime() + 60 * 86_400_000).toISOString();

  const [{ data: interviews }, { data: follows }, { data: saved }] = await Promise.all([
    db.from("interviews").select("id, scheduled_at, kind, location, applications(id, company_name, job_title)").eq("user_id", user.id).gte("scheduled_at", from).lte("scheduled_at", to),
    db.from("follow_ups").select("id, due_at, note, applications(id, company_name, job_title)").eq("user_id", user.id).is("done_at", null).lte("due_at", to),
    db.from("saved_jobs").select("job_id, jobs!inner(id, title, deadline, companies(name))").eq("user_id", user.id).gte("jobs.deadline", from.slice(0, 10)).lte("jobs.deadline", to.slice(0, 10)),
  ]);

  type A = { id: string; company_name: string; job_title: string } | null;
  const items: Item[] = [
    ...(interviews ?? []).map((i) => {
      const a = i.applications as unknown as A;
      return { at: i.scheduled_at, allDay: false, kind: "interview" as const, title: `${i.kind[0].toUpperCase()}${i.kind.slice(1)} · ${a?.company_name ?? ""}`, sub: [a?.job_title, i.location].filter(Boolean).join(" · "), href: `/applications?open=${a?.id}` };
    }),
    ...(follows ?? []).map((f) => {
      const a = f.applications as unknown as A;
      return { at: f.due_at, allDay: true, kind: "follow_up" as const, title: `Follow up · ${a?.company_name ?? ""}`, sub: f.note ?? a?.job_title ?? "", href: `/applications?open=${a?.id}` };
    }),
    ...(saved ?? []).map((s) => {
      const j = s.jobs as unknown as { id: string; title: string; deadline: string; companies: { name: string } | null };
      return { at: `${j.deadline}T23:59:00`, allDay: true, kind: "deadline" as const, title: `Closes · ${j.title}`, sub: j.companies?.name ?? "", href: `/jobs/${j.id}` };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const days = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.at.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), it]);
  }
  const today = now.toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="Calendar" title={<>What&apos;s <span className="serif-em">next</span>.</>} sub="Interviews, follow-ups and deadlines for saved roles — the next 60 days in one place." />
      <div className="mb-6 flex flex-wrap gap-4">
        {(Object.keys(KIND) as Item["kind"][]).map((k) => (
          <span key={k} className="flex items-center gap-2 text-[12.5px] text-muted"><span className={cx("size-2 rounded-full", TONE[k])} />{KIND[k]}</span>
        ))}
      </div>
      {!items.length ? (
        <EmptyState title="Nothing scheduled" body="Add interviews and follow-ups from any application, and save roles with deadlines — they'll appear here." action={<Link href="/applications" className="text-[13px] underline decoration-hairline-strong underline-offset-4">Open applications</Link>} />
      ) : (
        <div className="flex flex-col gap-6">
          {[...days.entries()].map(([day, list]) => {
            const d = parseISO(day);
            const overdue = day < today;
            return (
              <Reveal as="section" key={day} className="grid gap-3 md:grid-cols-[140px_1fr]">
                <div className="flex items-baseline gap-2 md:flex-col md:gap-0.5">
                  <span className={cx("num text-[30px] font-light leading-none tracking-[-0.03em]", day === today && "text-accent", overdue && "text-dim")}>{format(d, "d")}</span>
                  <Label>{day === today ? "Today" : overdue ? `${format(d, "EEE, MMM")} · overdue` : format(d, "EEE, MMM")}</Label>
                </div>
                <Card className="divide-y-[0.5px] divide-hairline-strong">
                  {list.map((it, i) => (
                    <Link key={i} href={it.href} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[rgb(var(--ink)/.03)]">
                      <span className={cx("h-8 w-[3px] shrink-0 rounded-full", TONE[it.kind])} />
                      <span className="w-16 shrink-0 font-mono text-[12px] text-dim">{it.allDay ? "all day" : format(parseISO(it.at), "h:mm a")}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px]">{it.title}</span>
                        {it.sub && <span className="block truncate text-[12.5px] text-muted">{it.sub}</span>}
                      </span>
                    </Link>
                  ))}
                </Card>
              </Reveal>
            );
          })}
        </div>
      )}
    </>
  );
}
