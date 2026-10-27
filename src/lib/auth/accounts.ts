/**
 * Accounts without the Supabase mailer. Supabase's built-in email sender allows a handful of messages an hour for the
 * whole project and often lands in spam, so nothing on the critical path waits for it:
 *
 *  - Sign-up creates the account on the server (admin API, already confirmed). No email is sent, so there is no email
 *    rate limit to hit; the browser then signs in with the password it just chose.
 *  - A sign-in link is generated on the server (admin API, which sends nothing) and delivered over the student's linked
 *    Telegram chat. The link carries a one-time token hash that /auth/confirm verifies; it is never logged.
 *    Students without Telegram fall back to the email link in the browser.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, telegramConfigured } from "@/lib/telegram/bot";

/** One Telegram sign-in link per account per this many seconds, so nobody can flood a student's chat. */
export const LINK_COOLDOWN_S = 30;

export type CreateResult = "created" | "exists";

export async function createAccount(admin: SupabaseClient, email: string, password: string): Promise<CreateResult> {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return "created";
  if (error.code === "email_exists" || /already (been )?registered|already exists/i.test(error.message)) return "exists";
  throw error;
}

export type LinkResult = { channel: "telegram" } | { channel: "none" } | { channel: "wait"; seconds: number };

/** The link a student taps: verified server-side by /auth/confirm, then on to `next`. */
export const confirmUrl = (site: string, tokenHash: string, next: string) =>
  `${site}/auth/confirm?${new URLSearchParams({ token_hash: tokenHash, type: "magiclink", next })}`;

export async function sendTelegramLink(admin: SupabaseClient, o: { email: string; next: string; site: string; now?: number }): Promise<LinkResult> {
  if (!telegramConfigured()) return { channel: "none" };
  const now = o.now ?? Date.now();
  // Look the account up first: generateLink CREATES an account for an unknown address (migration 0023).
  const { data: rows, error: lookup } = await admin.rpc("signin_link_target", { p_email: o.email });
  if (lookup) throw lookup;
  const target = (rows as { user_id: string; telegram_chat_id: number; signin_link_sent_at: string | null }[] | null)?.[0];
  if (!target) return { channel: "none" };
  const since = target.signin_link_sent_at ? (now - Date.parse(target.signin_link_sent_at)) / 1000 : Infinity;
  if (since < LINK_COOLDOWN_S) return { channel: "wait", seconds: Math.ceil(LINK_COOLDOWN_S - since) };

  // generateLink sends no email; the account exists, so it only mints a one-time token.
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: o.email });
  if (error || data.user?.id !== target.user_id || !data.properties?.hashed_token) return { channel: "none" };

  await sendMessage(Number(target.telegram_chat_id), {
    text: "<b>Your FRIDAY sign-in link</b>\nIt works once and expires in an hour. If you didn't ask for it, ignore this message.",
    buttons: [[{ text: "Sign in to FRIDAY", url: confirmUrl(o.site, data.properties.hashed_token, o.next) }]],
  });
  await admin.from("hunter_links").update({ signin_link_sent_at: new Date(now).toISOString() }).eq("user_id", target.user_id);
  return { channel: "telegram" };
}
