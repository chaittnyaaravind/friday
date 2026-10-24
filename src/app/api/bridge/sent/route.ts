import { z } from "zod";
import { body, errorResponse, ok } from "@/lib/api";
import { recordSent } from "@/lib/hunter/actions";
import { bridgeUser } from "@/lib/hunter/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const Input = z.union([
  z.object({ id: z.string().uuid(), messageId: z.string().min(1).max(200) }),
  z.object({ id: z.string().uuid(), error: z.string().min(1).max(1000) }),
]);

/** POST /api/bridge/sent — the bridge sent (or failed to send) one approved email from the student's Gmail. */
export async function POST(req: Request) {
  try {
    const db = createSupabaseAdmin();
    const userId = await bridgeUser(db, req);
    const input = await body(req, Input);
    return ok(await recordSent(db, userId, input.id, "messageId" in input ? { messageId: input.messageId } : { error: input.error }));
  } catch (e) {
    return errorResponse(e);
  }
}
