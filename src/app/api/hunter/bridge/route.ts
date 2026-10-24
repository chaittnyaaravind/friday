import { ok, withUser } from "@/lib/api";
import { newBridgeToken } from "@/lib/hunter/link";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/** POST /api/hunter/bridge — a new Gmail-bridge token, shown ONCE. Any earlier token stops working. */
export const POST = withUser(async ({ user }) => ok({ token: await newBridgeToken(createSupabaseAdmin(), user.id) }, { status: 201 }));

/** DELETE /api/hunter/bridge — disconnect the bridge; pending emails stay unsent. */
export const DELETE = withUser(async ({ user }) => {
  const { error } = await createSupabaseAdmin().from("hunter_links").update({ bridge_token_hash: null, bridge_seen_at: null }).eq("user_id", user.id);
  if (error) throw error;
  return ok({ connected: false });
});
