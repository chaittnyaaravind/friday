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
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, telegramConfigured } from "@/lib/telegram/bot";

/** One Telegram sign-in link per account per this many seconds, so nobody can flood a student's chat. */
export const LINK_COOLDOWN_S = 30;

export type CreateResult = "created" | "exists";

const ATTEMPTS = 6;
const isExists = (e: { code?: string; message: string }) => e.code === "email_exists" || /already (been )?registered|already exists/i.test(e.message);
/** The auth server timed out or failed under load: the account may or may not exist yet, and a retry is safe. */
export const isTransient = (e: { code?: string; status?: number; message: string }) =>
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
  o: { isOurs?: () => Promise<boolean>; wait?: (ms: number) => Promise<unknown>; attempts?: number } = {},
): Promise<CreateResult> {
  const wait = o.wait ?? sleep;
  const attempts = o.attempts ?? ATTEMPTS;
  for (let attempt = 0; ; attempt++) {
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!error) return "created";
    if (isExists(error)) return attempt > 0 && (await o.isOurs?.()) ? "created" : "exists";
    if (!isTransient(error) || attempt === attempts - 1) throw error;
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

/**
 * A sign-up turn: the moment this email's account may be created (migration 0026), signed so a browser coming back for
 * its turn cannot move itself up the line. Format "<epoch ms>.<hex hmac>".
 */
export function signTurn(email: string, at: number, key: string): string {
  return `${at}.${createHmac("sha256", key).update(`signup-turn|${email}|${at}`).digest("hex")}`;
}

/** The turn's time if the token is genuine and for this email; otherwise null (the request just reserves a new turn). */
export function readTurn(token: string | undefined, email: string, key: string): number | null {
  const m = token ? /^(\d{13})\.([0-9a-f]{64})$/.exec(token) : null;
  if (!m) return null;
  const want = Buffer.from(signTurn(email, Number(m[1]), key).split(".")[1], "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got) ? Number(m[1]) : null;
}

/**
 * Has this password appeared in a known data breach? Have I Been Pwned's range API (k-anonymity): only the first five
 * hex characters of the password's SHA-1 leave the server, and the match is made here. Padding hides the response size.
 * Supabase's own breached-password check never runs for accounts created through the admin API, so this replaces it.
 * A slow or failed lookup answers "no" — a third-party outage must never block sign-up.
 */
export async function isBreachedPassword(password: string, deps: { fetch?: typeof fetch } = {}): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await (deps.fetch ?? fetch)(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    const suffix = sha1.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [hash, count] = line.trim().split(":");
      return hash === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
