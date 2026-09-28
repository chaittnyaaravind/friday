/**
 * What FRIDAY knows about how recently each source was read. Reads source_health (visible to signed-in users; it
 * holds counts, times and error text — no credentials) and the source capability registry in code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { capabilityOf } from "@/lib/discovery/capabilities";
import { summarizeHealth, type HealthRow, type SourceStatusSummary } from "@/lib/discovery/health";

export async function loadSourceStatus(db: SupabaseClient, now: number = Date.now()): Promise<SourceStatusSummary> {
  const { data } = await db.from("source_health").select("*");
  return summarizeHealth((data ?? []) as HealthRow[], now, (source) => capabilityOf(source)?.configuredPollMinutes ?? null);
}

/** Health rows for one kind of source, keyed by scope (a company slug). */
export async function loadSourceHealthByScope(db: SupabaseClient, source: string): Promise<Map<string, HealthRow>> {
  const { data } = await db.from("source_health").select("*").eq("source", source);
  return new Map(((data ?? []) as HealthRow[]).map((r) => [r.scope, r]));
}

/**
 * Health rows for specific sources by slug, whatever kind of feed each one is: an SJSU employer may be read from an
 * official page, a Pinpoint job board or a Workday site, and each still has its own check time.
 */
export async function loadSourceHealthForScopes(db: SupabaseClient, scopes: string[]): Promise<Map<string, HealthRow>> {
  if (!scopes.length) return new Map();
  const { data } = await db.from("source_health").select("*").in("scope", scopes);
  return new Map(((data ?? []) as HealthRow[]).map((r) => [r.scope, r]));
}
