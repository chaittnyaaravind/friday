import { z } from "zod";
import { body, ok, withUser } from "@/lib/api";
import { botUsername, telegramConfigured } from "@/lib/telegram/bot";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/** GET /api/hunter — is Telegram linked, is the Gmail bridge connected, and what the hunter has done lately. */
export const GET = withUser(async ({ db, user }) => {
  const [{ data: link }, { data: items }] = await Promise.all([
    db.from("hunter_links").select("enabled, telegram_chat_id, telegram_linked_at, bridge_token_hash, bridge_created_at, bridge_seen_at").eq("user_id", user.id).maybeSingle(),
    db.from("hunt_items").select("id, state, error, created_at, notified_at, jobs(title, companies(name))").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
  ]);
  return ok({
    configured: { telegram: telegramConfigured(), bot: botUsername() },
    enabled: link?.enabled ?? true,
    telegram: { linked: Boolean(link?.telegram_chat_id), linkedAt: link?.telegram_linked_at ?? null },
    bridge: { connected: Boolean(link?.bridge_token_hash), createdAt: link?.bridge_created_at ?? null, seenAt: link?.bridge_seen_at ?? null },
    recent: items ?? [],
  });
});

/** PATCH /api/hunter — pause or resume the hunter. */
export const PATCH = withUser(async ({ user, req }) => {
  const { enabled } = await body(req, z.object({ enabled: z.boolean() }));
  const { error } = await createSupabaseAdmin().from("hunter_links").upsert({ user_id: user.id, enabled }, { onConflict: "user_id" });
  if (error) throw error;
  return ok({ enabled });
});
