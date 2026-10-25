import { errorResponse, ok } from "@/lib/api";
import { resumePdf } from "@/lib/hunter/actions";
import { bridgeUser } from "@/lib/hunter/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/** A claimed email not reported within this long is offered again (the script may have stopped mid-run). */
const RECLAIM_MS = 15 * 60_000;

/**
 * GET /api/bridge/outbox — the approved applications this student's Gmail bridge should send now, each with the tailored
 * resume as a PDF. Only rows created by an approval in Telegram exist here. Claiming a row is not sending it: the bridge
 * reports the result to /api/bridge/sent, and only then is anything marked applied.
 */
export async function GET(req: Request) {
  try {
    const db = createSupabaseAdmin();
    const userId = await bridgeUser(db, req);
    const stale = new Date(Date.now() - RECLAIM_MS).toISOString();
    const { data: rows, error } = await db
      .from("outbox")
      .select("id, to_email, subject, body, resume_version_id, state, claimed_at")
      .eq("user_id", userId)
      .or(`state.eq.pending,and(state.eq.claimed,claimed_at.lt.${stale})`)
      .order("created_at")
      .limit(5);
    if (error) throw error;
    const out = [];
    for (const r of rows ?? []) {
      // Compare-and-swap: a stale claim is taken over only if nobody re-claimed it since it was read (same claimed_at), so
      // two overlapping bridge runs can never both send the same application.
      let take = db.from("outbox").update({ state: "claimed", claimed_at: new Date().toISOString() }).eq("id", r.id).eq("state", r.state);
      if (r.state === "claimed") take = take.eq("claimed_at", r.claimed_at as string);
      const { data: claimed } = await take.select("id");
      if (!claimed?.length) continue;
      const pdf = r.resume_version_id ? await resumePdf(db, userId, r.resume_version_id as string) : null;
      out.push({ id: r.id, to: r.to_email, subject: r.subject, body: r.body, attachment: pdf ? { name: pdf.name, type: "application/pdf", base64: Buffer.from(pdf.bytes).toString("base64") } : null });
    }
    return ok({ items: out });
  } catch (e) {
    return errorResponse(e);
  }
}
