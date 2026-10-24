import { HttpError, ok, withUser } from "@/lib/api";
import { newLinkCode } from "@/lib/hunter/link";
import { botUsername, telegramConfigured } from "@/lib/telegram/bot";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/** POST /api/hunter/telegram — a one-time code (15 minutes) and the bot link that sends it. */
export const POST = withUser(async ({ user }) => {
  if (!telegramConfigured()) throw new HttpError(503, "Telegram is not set up on this FRIDAY server yet (TELEGRAM_BOT_TOKEN).");
  const code = await newLinkCode(createSupabaseAdmin(), user.id);
  const bot = botUsername();
  return ok({ code, link: bot ? `https://t.me/${bot}?start=${code}` : null, bot });
});

/** DELETE /api/hunter/telegram — unlink this account's chat. No more cards are sent. */
export const DELETE = withUser(async ({ user }) => {
  const { error } = await createSupabaseAdmin().from("hunter_links").update({ telegram_chat_id: null, telegram_linked_at: null }).eq("user_id", user.id);
  if (error) throw error;
  return ok({ linked: false });
});
