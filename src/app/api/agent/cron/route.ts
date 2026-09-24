import { timingSafeEqual } from "node:crypto";
import { errorResponse, ok } from "@/lib/api";
import { runDiscovery } from "@/lib/discovery/agent";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const want = `Bearer ${secret}`;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** GET /api/agent/cron — the morning run, invoked by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { newJobIds, ...report } = await runDiscovery(createSupabaseAdmin(), { trigger: "cron" });
    return ok({ ...report, newJobs: newJobIds.length });
  } catch (e) {
    return errorResponse(e);
  }
}
