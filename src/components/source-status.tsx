import { cadenceLabel } from "@/lib/discovery/capabilities";
import { minutesAgoLabel, type SourceStatusSummary } from "@/lib/discovery/health";
import { Card, cx } from "./ui";

const NAME: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", workday: "Workday",
  sjsu_page: "Official SJSU pages", usajobs: "USAJOBS", adzuna: "Adzuna",
};

/**
 * "When did FRIDAY last look?" — from recorded checks, never assumed. The dot is amber whenever anything is failing,
 * overdue or holding back a closure, grey when nothing has ever been recorded, and moss only when every source is fine.
 */
export function SourceStatusStrip({ status, className }: { status: SourceStatusSummary; className?: string }) {
  const never = !status.lastCheckedAt;
  const trouble = status.failing > 0 || status.overdue > 0 || status.blocked > 0;
  return (
    <Card className={cx("flex flex-col gap-3 p-4 md:px-5", className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className={cx("size-1.5 rounded-full", never ? "bg-dim" : trouble ? "bg-amber" : "bg-moss")} />
          <span className="text-[14px]">
            {never ? "No source check recorded yet" : <>Last check <span className="num font-mono">{minutesAgoLabel(status.minutesSinceCheck)}</span></>}
          </span>
        </span>
        {status.sources > 0 && (
          <span className="text-[13px] text-muted">
            <span className="num font-mono">{status.ok}</span> of <span className="num font-mono">{status.sources}</span> sources read fine
            {status.failing > 0 && <span className="text-amber"> · {status.failing} failing</span>}
            {status.overdue > 0 && <span className="text-amber"> · {status.overdue} overdue</span>}
            {status.blocked > 0 && <span className="text-amber"> · {status.blocked} holding listings open</span>}
          </span>
        )}
        <span className="label md:ml-auto">{cadenceLabel(status.cadenceMinutes)}</span>
      </div>

      {status.groups.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[12.5px] text-muted transition-colors hover:text-text">
            <span className="group-open:hidden">Per source ↓</span>
            <span className="hidden group-open:inline">Hide ↑</span>
          </summary>
          <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {status.groups.map((g) => (
              <li key={g.source} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-muted">
                  {NAME[g.source] ?? g.source} <span className="num font-mono text-[11.5px] text-dim">×{g.sources}</span>
                </span>
                <span className={cx("num font-mono text-[11.5px]", g.failing ? "text-amber" : "text-dim")}>
                  {g.failing ? `${g.failing} failing · ` : ""}checked {minutesAgoLabel(g.minutesSinceCheck)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
