/**
 * Per-source health: when FRIDAY last tried and last succeeded to read each source, what it saw, and whether a
 * close was refused. This is what lets the UI say "checked 12 min ago" from evidence instead of assuming, and lets
 * a broken source be seen as broken.
 *
 * Health is telemetry, not catalog data: recording it never fails a discovery run (errors are logged, not thrown).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloseBlock } from "./close-guard";

export type HealthKey = { source: string; scope: string };

export type HealthRow = HealthKey & {
  last_attempt_at: string;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  last_returned: number | null;
  last_kept: number | null;
  last_closed: number | null;
  close_blocked_reason: CloseBlock | null;
  updated_at: string;
};

export type SourceRunOutcome = { ok: boolean; returned?: number; kept?: number; closed?: number; error?: string | null; closeBlocked?: CloseBlock | null };

/** The health row after one run. A failure keeps the last success time and its counts; a success clears the error. */
export function nextHealth(prev: HealthRow | null, key: HealthKey, o: SourceRunOutcome, now: string): HealthRow {
  if (!o.ok) {
    return {
      ...key,
      last_attempt_at: now,
      last_success_at: prev?.last_success_at ?? null,
      last_error: (o.error ?? "failed").slice(0, 300),
      consecutive_failures: (prev?.consecutive_failures ?? 0) + 1,
      last_returned: prev?.last_returned ?? null,
      last_kept: prev?.last_kept ?? null,
      last_closed: prev?.last_closed ?? null,
      close_blocked_reason: prev?.close_blocked_reason ?? null,
      updated_at: now,
    };
  }
  return {
    ...key,
    last_attempt_at: now,
    last_success_at: now,
    last_error: null,
    consecutive_failures: 0,
    last_returned: o.returned ?? null,
    last_kept: o.kept ?? null,
    last_closed: o.closed ?? null,
    close_blocked_reason: o.closeBlocked ?? null,
    updated_at: now,
  };
}

export async function recordSourceRun(db: SupabaseClient, key: HealthKey, outcome: SourceRunOutcome, now: string = new Date().toISOString()): Promise<void> {
  try {
    const { data: prev } = await db.from("source_health").select("*").eq("source", key.source).eq("scope", key.scope).maybeSingle();
    const row = nextHealth((prev as HealthRow | null) ?? null, key, outcome, now);
    const { error } = await db.from("source_health").upsert(row, { onConflict: "source,scope" });
    if (error) throw error;
  } catch (e) {
    console.error(JSON.stringify({ event: "source_health_failed", source: key.source, scope: key.scope, error: e instanceof Error ? e.message : String(e) }));
  }
}

/** Whole minutes since `iso`, or null when it is unknown or in the future (clock skew is not "just now"). */
export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > now) return null;
  return Math.floor((now - t) / 60_000);
}

/** "just now", "12 min ago", "3 h ago", "2 d ago" — or "not yet" when a source has never been read. */
export function minutesAgoLabel(minutes: number | null): string {
  if (minutes == null) return "not yet";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

export type SourceGroup = { source: string; sources: number; failing: number; lastSuccessAt: string | null; minutesSinceCheck: number | null };

export type SourceStatusSummary = {
  /** Sources FRIDAY tracks (one per employer feed or SJSU page). */
  sources: number;
  /** Last attempt succeeded. */
  ok: number;
  /** Last attempt failed (consecutive failures > 0). */
  failing: number;
  /** A close was refused because the feed looked broken (see close-guard.ts). */
  blocked: number;
  /** Not failing, but no success within two configured check intervals. */
  overdue: number;
  /** The most recent successful read of ANY source; null if none has ever succeeded. */
  lastCheckedAt: string | null;
  minutesSinceCheck: number | null;
  /** The slowest configured interval among tracked sources: every source is checked at least this often, when checks run. */
  cadenceMinutes: number | null;
  groups: SourceGroup[];
};

/**
 * Boil source_health down to what a person can act on. Nothing here is assumed: a source that has never succeeded has
 * no check time, and the summary says so instead of borrowing another source's.
 */
export function summarizeHealth(rows: HealthRow[], now: number, cadenceOf: (source: string) => number | null): SourceStatusSummary {
  const bySource = new Map<string, HealthRow[]>();
  for (const r of rows) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);

  const cadences = rows.map((r) => cadenceOf(r.source)).filter((c): c is number => c != null);
  const groups: SourceGroup[] = [...bySource].map(([source, rs]) => {
    const last = rs.map((r) => r.last_success_at).filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;
    return { source, sources: rs.length, failing: rs.filter((r) => r.consecutive_failures > 0).length, lastSuccessAt: last, minutesSinceCheck: minutesSince(last, now) };
  });
  groups.sort((a, b) => b.sources - a.sources || a.source.localeCompare(b.source));

  const lastCheckedAt = rows.map((r) => r.last_success_at).filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;
  const failing = rows.filter((r) => r.consecutive_failures > 0).length;
  const overdue = rows.filter((r) => {
    const cadence = cadenceOf(r.source);
    const since = minutesSince(r.last_success_at, now);
    return r.consecutive_failures === 0 && cadence != null && since != null && since > cadence * 2;
  }).length;
  return {
    sources: rows.length,
    ok: rows.filter((r) => r.consecutive_failures === 0 && r.last_success_at).length,
    failing,
    blocked: rows.filter((r) => r.close_blocked_reason).length,
    overdue,
    lastCheckedAt,
    minutesSinceCheck: minutesSince(lastCheckedAt, now),
    cadenceMinutes: cadences.length ? Math.max(...cadences) : null,
    groups,
  };
}
