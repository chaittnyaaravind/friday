/**
 * How much FRIDAY can honestly say about whether an opportunity is still open.
 * Pure and deterministic: the state is derived only from evidence FRIDAY holds (its status and the
 * last time a source confirmed the posting), never assumed. No evidence → not "active".
 */
export type Freshness = "new" | "recent" | "active" | "stale" | "closed" | "expired";

export const FRESH_HOURS = 48; // confirmed by a source within this window → "recently verified"
export const NEW_DAYS = 3; // first seen within this window (and verified) → "new"
export const STALE_DAYS = 14; // not confirmed for this long → "stale": may have closed
export const ARCHIVE_DAYS = 45; // not confirmed for this long → archived as expired by the agent

export type FreshnessInput = {
  status: string;
  discovered_at: string | null;
  last_verified_at: string | null;
  deadline?: string | null;
  /** Found on the employer's first crawl: already open when FRIDAY arrived, so its first-seen time is not "just opened". */
  is_baseline?: boolean | null;
};

export type FreshnessInfo = { state: Freshness; label: string; detail: string };

const DAY = 86_400_000;

export function freshnessOf(job: FreshnessInput, now: number = Date.now()): FreshnessInfo {
  if (job.status !== "active") {
    return job.status === "expired"
      ? { state: "expired", label: "Expired", detail: "FRIDAY archived this listing after it stopped being confirmed by any source." }
      : { state: "closed", label: "Closed", detail: "The employer's site no longer lists this opportunity." };
  }
  if (job.deadline) {
    const end = Date.parse(`${job.deadline}T23:59:59`);
    if (!Number.isNaN(end) && end < now) return { state: "expired", label: "Deadline passed", detail: `The application deadline was ${job.deadline}.` };
  }
  const verified = job.last_verified_at ? Date.parse(job.last_verified_at) : NaN;
  if (Number.isNaN(verified)) return { state: "stale", label: "Unverified", detail: "FRIDAY has no confirmation that this is still open." };

  const sinceVerified = now - verified;
  if (sinceVerified > STALE_DAYS * DAY) {
    return { state: "stale", label: "Stale", detail: `Last confirmed ${Math.floor(sinceVerified / DAY)} days ago. It may have closed — check the employer's page.` };
  }
  const found = job.discovered_at ? Date.parse(job.discovered_at) : NaN;
  if (!job.is_baseline && !Number.isNaN(found) && now - found <= NEW_DAYS * DAY && sinceVerified <= FRESH_HOURS * 3_600_000) {
    return { state: "new", label: "New", detail: "Found in the last few days and confirmed by its source." };
  }
  if (sinceVerified <= FRESH_HOURS * 3_600_000) return { state: "recent", label: "Recently verified", detail: "Confirmed open by its source within the last two days." };
  return { state: "active", label: "Active", detail: `Last confirmed ${Math.max(1, Math.floor(sinceVerified / DAY))} days ago.` };
}

/** ISO cutoff before which an active listing with no confirmation is archived. */
export const archiveCutoff = (now: number = Date.now()) => new Date(now - ARCHIVE_DAYS * DAY).toISOString();
