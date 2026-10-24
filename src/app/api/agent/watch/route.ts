import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse, ok } from "@/lib/api";
import { runDiscovery } from "@/lib/discovery/agent";
import { backfill } from "@/lib/hunter/link";
import { enqueue, processQueue } from "@/lib/hunter/pipeline";
import { sha256 } from "@/lib/hunter/tokens";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Two callers: anything holding CRON_SECRET (GitHub backup), and the database's own pg_cron job (migration 0019), whose
 * token lives only in Supabase Vault — FRIDAY compares its sha256 with scheduler_tokens and never sees it stored.
 */
async function authorized(req: Request, db: SupabaseClient) {
  const got = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const want = secret ? `Bearer ${secret}` : null;
  if (want && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))) return true;
  const token = /^Bearer ([0-9a-f]{64})$/.exec(got)?.[1];
  if (!token) return false;
  const { data } = await db.from("scheduler_tokens").select("token_hash").eq("name", "watch").maybeSingle();
  const hash = sha256(token);
  return Boolean(data?.token_hash) && timingSafeEqual(Buffer.from(hash), Buffer.from(data!.token_hash as string));
}

/**
 * GET /api/agent/watch — the 5-minute SJSU watch (called by pg_cron, migration 0019). Re-reads only the official SJSU
 * sources, then prepares and sends a Telegram card for every new desk job a linked student would want. The full
 * multi-source discovery stays on /api/agent/cron.
 */
export async function GET(req: Request) {
  const started = Date.now();
  try {
    const db = createSupabaseAdmin();
    if (!(await authorized(req, db))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { newJobIds, runId, created, failures, companies } = await runDiscovery(db, { trigger: "cron", onlySjsu: true });
    let queued = await enqueue(db, newJobIds);
    // Catch-up: any open desk job a linked student has never been sent (reclassified as desk, or missed earlier). Idempotent.
    const { data: links } = await db.from("hunter_links").select("user_id").eq("enabled", true).not("telegram_chat_id", "is", null);
    for (const l of links ?? []) queued += await backfill(db, l.user_id as string);
    // Leave headroom under maxDuration; anything unfinished is picked up by the next tick.
    // One item can take ~70s (AI tailoring + research), so the last one may start no later than ~200s in.
    const hunter = await processQueue(db, { deadline: started + 200_000 });
    return ok({ runId, companies, created, failures: failures.length, queued, hunter, ms: Date.now() - started });
  } catch (e) {
    return errorResponse(e);
  }
}
