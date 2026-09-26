/**
 * Unsubscribe links carry an HMAC of the user id, so a link can only opt out the person it was sent to and
 * cannot be forged or guessed. The secret is server-side only (AI_SIGNING_SECRET, else the Supabase secret key).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const secret = (env: Record<string, string | undefined> = process.env) => env.AI_SIGNING_SECRET || env.SUPABASE_SECRET_KEY || "";

export function unsubscribeToken(userId: string, env?: Record<string, string | undefined>): string {
  const key = secret(env);
  if (!key) throw new Error("No signing secret configured");
  return createHmac("sha256", key).update(`friday-unsubscribe-v1|${userId}`).digest("hex").slice(0, 40);
}

export function verifyUnsubscribeToken(userId: string, token: string, env?: Record<string, string | undefined>): boolean {
  if (!secret(env) || !/^[0-9a-f]{40}$/.test(token)) return false;
  const want = Buffer.from(unsubscribeToken(userId, env));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The one-click unsubscribe address for a user (an absolute URL on the public site). */
export function unsubscribeUrl(siteUrl: string, userId: string, env?: Record<string, string | undefined>): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId, env)}`;
}
