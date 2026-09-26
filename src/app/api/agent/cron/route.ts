import { timingSafeEqual } from "node:crypto";
import { errorResponse, ok } from "@/lib/api";
import { runDiscovery } from "@/lib/discovery/agent";
import { runEmailAlerts } from "@/lib/email/alerts";
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
    const admin = createSupabaseAdmin();
    const { newJobIds, ...report } = await runDiscovery(admin, { trigger: "cron" });
    // Email is a separate step: a failure or missing configuration here never fails discovery.
    let email: Awaited<ReturnType<typeof runEmailAlerts>> | { error: string };
    try {
      email = await runEmailAlerts(admin);
    } catch (e) {
      email = { error: e instanceof Error ? e.message.slice(0, 200) : "email alerts failed" };
    }
    return ok({ ...report, newJobs: newJobIds.length, email });
  } catch (e) {
    return errorResponse(e);
  }
}
