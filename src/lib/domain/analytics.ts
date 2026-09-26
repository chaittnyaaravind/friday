/**
 * Job-search analytics computed only from the student's own tracked applications.
 * A rate is reported only when there is enough data behind it; otherwise it is null and the UI says so.
 */
export type AnalyticsApp = {
  status: string;
  applied_at: string | null;
  source: string | null;
  interviews?: { id: string }[] | null;
};

export const MIN_SAMPLE = 5; // applications needed before an overall rate means anything
export const MIN_SOURCE_SAMPLE = 3; // per-source

const POST_APPLY = ["applied", "assessment", "interview", "final_round", "offer"];
const RESPONDED = ["assessment", "interview", "final_round", "offer", "rejected"];
const INTERVIEWED = ["interview", "final_round", "offer"];
const DAY = 86_400_000;

export type SearchAnalytics = {
  total: number;
  applied: number;
  responded: number;
  interviewed: number;
  offers: number;
  enough: boolean;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  funnel: { label: string; count: number }[];
  weekly: { weekStart: string; applied: number }[];
  bySource: { source: string; applied: number; interviews: number; interviewRate: number | null }[];
};

const pct = (n: number, d: number) => Math.round((n / d) * 100);

/** Monday 00:00 UTC of the week containing t. */
function weekStart(t: number) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

export function analyze(apps: AnalyticsApp[], now: number = Date.now(), weeks = 8): SearchAnalytics {
  const hasApplied = (a: AnalyticsApp) => a.applied_at != null || POST_APPLY.includes(a.status);
  const applied = apps.filter(hasApplied);
  const responded = applied.filter((a) => RESPONDED.includes(a.status) || (a.interviews?.length ?? 0) > 0);
  const interviewed = applied.filter((a) => INTERVIEWED.includes(a.status) || (a.interviews?.length ?? 0) > 0);
  const offers = applied.filter((a) => a.status === "offer");
  const enough = applied.length >= MIN_SAMPLE;

  // The last `weeks` weeks, oldest first, zeros included so the chart is honest about quiet weeks.
  const buckets = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) buckets.set(weekStart(now - i * 7 * DAY), 0);
  for (const a of applied) {
    if (!a.applied_at) continue;
    const k = weekStart(Date.parse(a.applied_at));
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }

  const groups = new Map<string, { applied: number; interviews: number }>();
  for (const a of applied) {
    const key = (a.source ?? "").trim() || "Unspecified";
    const g = groups.get(key) ?? { applied: 0, interviews: 0 };
    g.applied++;
    if (interviewed.includes(a)) g.interviews++;
    groups.set(key, g);
  }

  return {
    total: apps.length,
    applied: applied.length,
    responded: responded.length,
    interviewed: interviewed.length,
    offers: offers.length,
    enough,
    responseRate: enough ? pct(responded.length, applied.length) : null,
    interviewRate: enough ? pct(interviewed.length, applied.length) : null,
    offerRate: enough ? pct(offers.length, applied.length) : null,
    funnel: [
      { label: "Tracked", count: apps.length },
      { label: "Applied", count: applied.length },
      { label: "Heard back", count: responded.length },
      { label: "Interviewed", count: interviewed.length },
      { label: "Offers", count: offers.length },
    ],
    weekly: [...buckets].map(([weekStart, n]) => ({ weekStart, applied: n })),
    bySource: [...groups]
      .map(([source, g]) => ({ source, applied: g.applied, interviews: g.interviews, interviewRate: g.applied >= MIN_SOURCE_SAMPLE ? pct(g.interviews, g.applied) : null }))
      .sort((a, b) => b.applied - a.applied),
  };
}
