/**
 * The hunt views — what "new today", "just opened", "closing soon" and "best matches" mean, stated precisely.
 *
 * "Opened" here ALWAYS means "first seen by FRIDAY". It is never "posted by the employer": most sources do not say
 * when a role was posted, and FRIDAY only looks every few hours. A window shorter than FRIDAY's check interval can
 * therefore only show what a check happened to find in that time — coverageNotes() says so instead of implying a
 * live feed. Pure and deterministic (time is always passed in).
 */

/** First-seen windows, in minutes. */
export const WINDOWS = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 } as const;
export type HuntWindow = keyof typeof WINDOWS;
export const WINDOW_LABEL: Record<HuntWindow, string> = { "15m": "15 min", "1h": "1 hour", "6h": "6 hours", "24h": "24 hours" };
export const isWindow = (v: unknown): v is HuntWindow => typeof v === "string" && v in WINDOWS;

export type HuntTab = "today" | "just-opened" | "closing" | "best";
export const HUNT_TABS: { id: HuntTab; label: string }[] = [
  { id: "today", label: "New today" },
  { id: "just-opened", label: "Just opened" },
  { id: "closing", label: "Closing soon" },
  { id: "best", label: "Best matches" },
];
export const isTab = (v: unknown): v is HuntTab => HUNT_TABS.some((t) => t.id === v);

export const CLOSING_DAYS = 7;
export const BEST_MIN_SCORE = 70;
/** SJSU's day is Pacific time, whatever the server's clock says. */
export const TZ = "America/Los_Angeles";

/**
 * Epoch ms of the most recent midnight in `tz`. On the two days a year the clock changes, midnight-to-now is 1 hour
 * off from wall-clock elapsed time; the error is at most one hour and only on those days.
 */
export function startOfDay(now: number, tz: string = TZ): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const sinceMidnight = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + (((now % 1000) + 1000) % 1000);
  return now - sinceMidnight;
}

/** The calendar date (YYYY-MM-DD) in `tz`. */
export const todayISODate = (now: number, tz: string = TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The instant (ISO) from which a first-seen window starts. */
export function firstSeenAfter(w: HuntWindow | "today", now: number): string {
  return new Date(w === "today" ? startOfDay(now) : now - WINDOWS[w] * 60_000).toISOString();
}

/**
 * The window "Just opened" starts on: the smallest one that covers two check intervals, so a single slow or failed
 * check does not empty the view. Falls back to 24 hours when the check interval is unknown.
 */
export function defaultWindow(pollMinutes: number | null): HuntWindow {
  if (!pollMinutes) return "24h";
  return (Object.entries(WINDOWS).find(([, m]) => m >= pollMinutes * 2)?.[0] as HuntWindow | undefined) ?? "24h";
}

const every = (minutes: number) => (minutes >= 60 ? `${minutes / 60} hours` : `${minutes} minutes`);

/**
 * Plain-language caveats for a window, or none. Shown above the results so an empty short window reads as
 * "FRIDAY has not checked that recently", not as "nothing opened".
 */
export function coverageNotes(o: { windowMinutes: number; pollMinutes: number | null; minutesSinceCheck: number | null }): string[] {
  const notes: string[] = [];
  if (o.pollMinutes && o.windowMinutes < o.pollMinutes) {
    notes.push(`FRIDAY checks about every ${every(o.pollMinutes)}, so a window this short can only show what a check happened to find. It is not a live feed of what employers post.`);
  }
  if (o.pollMinutes && o.minutesSinceCheck != null && o.minutesSinceCheck > o.pollMinutes * 2) {
    notes.push(`The last successful check was ${o.minutesSinceCheck >= 120 ? `${Math.floor(o.minutesSinceCheck / 60)} hours` : `${o.minutesSinceCheck} minutes`} ago, so newer listings may not be here yet.`);
  }
  return notes;
}

export type HuntQuery = {
  firstSeenAfter?: string;
  deadlineAfter?: string;
  deadlineWithinDays?: number;
  minScore?: number;
  sort: "first_seen" | "deadline" | "match";
};

/** `huntQuery` for "right now", for server components (which must not read the clock themselves). */
export const huntQueryNow = (tab: HuntTab, window: HuntWindow): HuntQuery => huntQuery(tab, window, Date.now());

/** The search a tab stands for. */
export function huntQuery(tab: HuntTab, window: HuntWindow, now: number): HuntQuery {
  switch (tab) {
    case "today":
      return { firstSeenAfter: firstSeenAfter("today", now), sort: "first_seen" };
    case "just-opened":
      return { firstSeenAfter: firstSeenAfter(window, now), sort: "first_seen" };
    case "closing":
      return { deadlineAfter: todayISODate(now), deadlineWithinDays: CLOSING_DAYS, sort: "deadline" };
    case "best":
      return { minScore: BEST_MIN_SCORE, sort: "match" };
  }
}
