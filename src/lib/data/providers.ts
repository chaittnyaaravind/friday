/**
 * What the last discovery run says about each aggregator provider, for honest status messages in the UI.
 * Reads agent_runs (visible to signed-in users); nothing here is secret — no credentials, only counts and a flag.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderStatus = { attempted: boolean; ok: boolean; inserted: number };

export async function loadProviderStatus(db: SupabaseClient): Promise<{ adzuna: ProviderStatus | null }> {
  const { data } = await db.from("agent_runs").select("stats").eq("kind", "discovery").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle();
  const a = (data?.stats as { providers?: { adzuna?: { attempted?: boolean; ok?: boolean; inserted?: number } } } | null)?.providers?.adzuna;
  return { adzuna: a ? { attempted: Boolean(a.attempted), ok: Boolean(a.ok), inserted: a.inserted ?? 0 } : null };
}
