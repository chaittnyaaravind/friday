import { CalendarClock, ListChecks } from "lucide-react";
import Link from "next/link";
import { MIN_SAMPLE, type SearchAnalytics } from "@/lib/domain/analytics";
import { dateTime } from "@/lib/format";
import { Card, Label, cx } from "./ui";

export type TodayItem = { id: string; kind: "follow_up" | "interview"; at: string; title: string; detail: string; href: string };

/** What needs the student's attention in the next seven days — real follow-ups and interviews, soonest first. */
export function TodayPanel({ items, now }: { items: TodayItem[]; now: number }) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <Label>Today &amp; this week</Label>
        <Link href="/calendar" className="text-[12.5px] text-muted hover:text-text">Calendar →</Link>
      </div>
      {items.length ? (
        <ul className="flex flex-col divide-y-[0.5px] divide-hairline-strong">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`}>
              <Link href={i.href} className="flex items-start gap-3 py-3 transition-colors hover:bg-[rgb(var(--ink)/.03)]">
                <span className="mt-0.5 text-dim">{i.kind === "interview" ? <CalendarClock size={16} /> : <ListChecks size={16} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{i.title}</span>
                  <span className="block truncate text-[12px] text-muted">{i.detail}</span>
                </span>
                <span className={cx("num shrink-0 font-mono text-[12px]", Date.parse(i.at) < now ? "text-accent" : "text-dim")}>{dateTime(i.at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">Nothing due. Follow-ups and interviews you schedule on an application show up here.</p>
      )}
    </Card>
  );
}

/** Funnel, weekly activity and source performance — every figure comes from the student's own tracked applications. */
export function AnalyticsPanel({ a }: { a: SearchAnalytics }) {
  if (a.total === 0) {
    return (
      <Card className="p-5 text-[14px] text-muted">
        Analytics appear once you track applications. Save a job and open <Link href="/applications" className="text-text underline underline-offset-4">Applications</Link> to start.
      </Card>
    );
  }
  const max = Math.max(1, ...a.funnel.map((f) => f.count));
  const weekMax = Math.max(1, ...a.weekly.map((w) => w.applied));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-4 p-5 lg:col-span-2">
        <Label>Application funnel</Label>
        <ul className="flex flex-col gap-2.5">
          {a.funnel.map((f) => (
            <li key={f.label} className="grid grid-cols-[92px_1fr_32px] items-center gap-3 text-[13px]">
              <span className="text-muted">{f.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-[rgb(var(--ink)/.06)]"><span className="block h-full rounded-full bg-accent" style={{ width: `${(f.count / max) * 100}%` }} /></span>
              <span className="num text-right font-mono text-[12px]">{f.count}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-3 border-t-[0.5px] border-hairline-strong pt-4">
          {[
            ["Heard back", a.responseRate],
            ["Interview rate", a.interviewRate],
            ["Offer rate", a.offerRate],
          ].map(([l, v]) => (
            <div key={l as string} className="flex flex-col gap-1">
              <span className="label">{l}</span>
              <span className="num text-[24px] font-light leading-none">{v == null ? "—" : `${v}%`}</span>
            </div>
          ))}
        </div>
        {!a.enough && <p className="text-[12px] text-dim">Rates appear after {MIN_SAMPLE} applications — with fewer, a percentage would be noise. You have {a.applied}.</p>}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <Label>Applications per week</Label>
        <div className="flex h-24 items-end gap-1.5" role="img" aria-label={`Applications per week for the last ${a.weekly.length} weeks`}>
          {a.weekly.map((w) => (
            <div key={w.weekStart} className="flex flex-1 flex-col items-center justify-end gap-1" title={`Week of ${w.weekStart}: ${w.applied}`}>
              <span className="num font-mono text-[10px] text-dim">{w.applied || ""}</span>
              <span className={cx("w-full rounded-sm", w.applied ? "bg-accent" : "bg-[rgb(var(--ink)/.08)]")} style={{ height: `${Math.max(4, (w.applied / weekMax) * 100)}%` }} />
            </div>
          ))}
        </div>
        <Label className="pt-1">By source</Label>
        {a.bySource.length ? (
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {a.bySource.slice(0, 5).map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted">{s.source}</span>
                <span className="num shrink-0 font-mono text-[12px]">{s.applied} applied{s.interviewRate == null ? "" : ` · ${s.interviewRate}% interviewed`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No submitted applications yet.</p>
        )}
      </Card>
    </div>
  );
}
