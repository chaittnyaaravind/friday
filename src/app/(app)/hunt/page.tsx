import { SJSU_ONLY } from "@/lib/scope";
import { redirect } from "next/navigation";
import { Feed } from "@/components/feed";
import { HuntNav } from "@/components/hunt-nav";
import { SourceStatusStrip } from "@/components/source-status";
import { Notice, PageHeader } from "@/components/ui";
import { loadSourceStatus } from "@/lib/data/source-status";
import type { JobFilters } from "@/lib/data/jobs";
import { BEST_MIN_SCORE, CLOSING_DAYS, coverageNotes, defaultWindow, huntQueryNow, isTab, isWindow, WINDOW_LABEL, WINDOWS, type HuntTab, type HuntWindow } from "@/lib/domain/hunt";
import { minutesAgoLabel } from "@/lib/discovery/health";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Hunt" };

/** What each view means, in one honest line. */
const DEFINITION: Record<HuntTab, (w: HuntWindow) => string> = {
  today: () => "First seen by FRIDAY since midnight, Pacific time.",
  "just-opened": (w) => `First seen by FRIDAY within the last ${WINDOW_LABEL[w].toLowerCase()}.`,
  closing: () => `A stated application deadline within the next ${CLOSING_DAYS} days.`,
  best: () => `A match score of ${BEST_MIN_SCORE} or more for your profile.`,
};

export default async function Hunt({ searchParams }: PageProps<"/hunt">) {
  if (SJSU_ONLY) redirect("/sjsu"); // SJSU-only (lib/scope.ts)
  const sp = await searchParams;
  await requireUser();
  const db = await createSupabaseServer();
  const status = await loadSourceStatus(db);

  const tab: HuntTab = isTab(sp.tab) ? sp.tab : "today";
  const window: HuntWindow = isWindow(sp.window) ? sp.window : defaultWindow(status.cadenceMinutes);
  const q = huntQueryNow(tab, window);
  // A view's own scope always applies; a sort the student chose in the filters is respected.
  const { sort, ...scope } = q;
  const preset: Partial<JobFilters> = { ...scope, ...(sp.sort ? {} : { sort }) };
  const notes = tab === "just-opened" ? coverageNotes({ windowMinutes: WINDOWS[window], pollMinutes: status.cadenceMinutes, minutesSinceCheck: status.minutesSinceCheck }) : [];
  const checked = status.lastCheckedAt ? `FRIDAY last checked ${minutesAgoLabel(status.minutesSinceCheck)}.` : "FRIDAY has no recorded check yet.";

  const empty: Record<HuntTab, { title: string; body: string }> = {
    today: {
      title: "Nothing new since midnight",
      body: `${checked} Listings that were already open when FRIDAY first looked at an employer are not counted as new, so a quiet day here is real, not a gap.`,
    },
    "just-opened": {
      title: `Nothing first seen in the last ${WINDOW_LABEL[window].toLowerCase()}`,
      body: `${checked} Try a longer window, or open “New today”.`,
    },
    closing: {
      title: `No listing closes in the next ${CLOSING_DAYS} days`,
      body: "Most employers do not publish a deadline, so this view only lists the ones that do. It is not a complete list of what is about to close.",
    },
    best: {
      title: `Nothing scores ${BEST_MIN_SCORE}+ for you yet`,
      body: "Add your skills or upload a resume so FRIDAY can score listings against what you have actually done.",
    },
  };

  return (
    <>
      <PageHeader
        eyebrow="Hunt"
        title={<>What just <span className="serif-em">opened</span>.</>}
        sub="New listings by when FRIDAY first saw them, not when the employer posted them. FRIDAY checks its sources on a schedule; this is not a live feed."
      />
      <div className="flex flex-col gap-5">
        <SourceStatusStrip status={status} />
        <HuntNav tab={tab} window={window} />
        <p className="text-[13px] text-muted">{DEFINITION[tab](window)}</p>
        {notes.map((n) => (
          <Notice key={n} tone="amber" title="Read this window carefully">{n}</Notice>
        ))}
        <Feed searchParams={sp} preset={preset} empty={empty[tab]} />
        <p className="text-[11.5px] leading-relaxed text-dim">
          Listings that were already open the first time FRIDAY looked at an employer are left out of “New today” and “Just opened”: FRIDAY can say when it first saw them, not when they opened.
        </p>
      </div>
    </>
  );
}
