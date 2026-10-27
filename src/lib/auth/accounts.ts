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

const ATTEMPTS = 6;
const isExists = (e: { code?: string; message: string }) => e.code === "email_exists" || /already (been )?registered|already exists/i.test(e.message);
/** The auth server timed out or failed under load: the account may or may not exist yet, and a retry is safe. */
const isTransient = (e: { code?: string; status?: number; message: string }) =>
  e.code === "request_timeout" || (e.status ?? 0) >= 500 || e.status === 429 || /deadline|timeout|fetch failed|network|ECONNRESET/i.test(e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Creates the account, riding out bursts: a burst of sign-ups makes the auth server hash hundreds of passwords at once and
 * time out, so transient failures retry with jittered backoff. A retry that finds the email "already registered" asks
 * `isOurs` whether the account takes this password — a timed-out first attempt that still succeeded must not tell the
 * student their own brand-new account belongs to someone else.
 */
export async function createAccount(
  admin: SupabaseClient, email: string, password: string,
  o: { isOurs?: () => Promise<boolean>; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<CreateResult> {
  const wait = o.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!error) return "created";
    if (isExists(error)) return attempt > 0 && (await o.isOurs?.()) ? "created" : "exists";
    if (!isTransient(error) || attempt === ATTEMPTS - 1) throw error;
    await wait(Math.min(8_000, 400 * 2 ** attempt) * (0.5 + Math.random()));
  }
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
