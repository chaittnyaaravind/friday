/**
 * The only code that talks to Resend. Safe by construction:
 *  - not configured (RESEND_API_KEY + EMAIL_FROM) → nothing is sent and nothing is logged as sent;
 *  - a message with the same (user, dedupe key) that was already sent is never sent again;
 *  - at most MAX_EMAILS_PER_DAY per user in any 24 hours;
 *  - every attempt is recorded in email_log; failures keep a short reason, never the API key.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mail } from "./templates";

export const MAX_EMAILS_PER_DAY = 5;
export type EmailKind = "new_matches" | "follow_up" | "interview" | "status_change";
export type SendResult = { status: "sent" | "failed" | "skipped"; reason?: string };
type Env = Record<string, string | undefined>;

export function emailStatus(env: Env = process.env): { configured: boolean; missing: string[] } {
  const missing = ["RESEND_API_KEY", "EMAIL_FROM"].filter((k) => !env[k]);
  return { configured: missing.length === 0, missing };
}
export const emailConfigured = (env: Env = process.env) => emailStatus(env).configured;

const UNIQUE_VIOLATION = "23505";

export async function sendMail(
  db: SupabaseClient,
  o: { userId: string; to: string; kind: EmailKind; dedupeKey: string; mail: Mail; unsubscribeUrl: string },
  deps: { env?: Env; fetch?: typeof fetch; now?: number } = {},
): Promise<SendResult> {
  const env = deps.env ?? process.env;
  if (!emailConfigured(env)) return { status: "skipped", reason: "not_configured" };
  const now = deps.now ?? Date.now();

  const { data: already } = await db.from("email_log").select("id").eq("user_id", o.userId).eq("dedupe_key", o.dedupeKey).eq("status", "sent").maybeSingle();
  if (already) return { status: "skipped", reason: "duplicate" };

  const since = new Date(now - 24 * 3_600_000).toISOString();
  const { count } = await db.from("email_log").select("id", { count: "exact", head: true }).eq("user_id", o.userId).eq("status", "sent").gte("created_at", since);
  if ((count ?? 0) >= MAX_EMAILS_PER_DAY) return { status: "skipped", reason: "rate_limited" };

  const key = env.RESEND_API_KEY!;
  const record = async (status: "sent" | "failed", extra: { error?: string; provider_id?: string }) => {
    const { error } = await db.from("email_log").insert({ user_id: o.userId, kind: o.kind, dedupe_key: o.dedupeKey, status, ...extra });
    if (error && error.code !== UNIQUE_VIOLATION) console.error("email_log insert failed", error.message);
  };

  try {
    const res = await (deps.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [o.to],
        subject: o.mail.subject,
        html: o.mail.html,
        text: o.mail.text,
        headers: { "List-Unsubscribe": `<${o.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      const reason = `resend ${res.status}: ${String(body.message ?? "request failed").split(key).join("[redacted]").slice(0, 200)}`;
      await record("failed", { error: reason });
      return { status: "failed", reason };
    }
    await record("sent", { provider_id: body.id });
    return { status: "sent" };
  } catch (e) {
    const reason = `network: ${(e instanceof Error ? e.message : "request failed").split(key).join("[redacted]").slice(0, 200)}`;
    await record("failed", { error: reason });
    return { status: "failed", reason };
  }
}
