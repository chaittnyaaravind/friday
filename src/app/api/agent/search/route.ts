import { z } from "zod";
import { HttpError, ok, withUser } from "@/lib/api";
import { runDiscovery } from "@/lib/discovery/agent";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

const Input = z.object({ scope: z.enum(["all", "sjsu", "watchlist"]).default("all") }).default({ scope: "all" });

/**
 * POST /api/agent/search — run FRIDAY now: crawl sources, dedupe, verify, re-match.
 * Shared catalog, so runs are throttled to one every 15 minutes across all users.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const { scope } = Input.parse(await req.json().catch(() => ({})));
  const admin = createSupabaseAdmin();

  const { data: last } = await admin.from("agent_runs").select("id, status, started_at, finished_at, stats").eq("kind", "discovery").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const since = last ? Date.now() - new Date(last.started_at).getTime() : Infinity;
  if (last && (last.status === "running" ? since < 10 * 60_000 : since < 15 * 60_000) && scope === "all") {
    throw new HttpError(429, last.status === "running" ? "FRIDAY is already searching — results will appear shortly." : "FRIDAY searched less than 15 minutes ago. Showing those results.");
  }

  let companySlugs: string[] | undefined;
  if (scope === "watchlist") {
    const { data } = await db.from("company_watchlists").select("companies(slug)").eq("user_id", user.id);
    companySlugs = (data ?? []).map((w) => (w.companies as unknown as { slug: string }).slug);
    if (!companySlugs.length) throw new HttpError(400, "Follow a company first");
  }
  const report = await runDiscovery(admin, { trigger: "user", userId: user.id, companySlugs, onlySjsu: scope === "sjsu" });
  const { newJobIds, ...summary } = report;
  return ok({ ...summary, newJobs: newJobIds.length });
});
