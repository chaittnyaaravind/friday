import { verifyUnsubscribeToken } from "@/lib/email/token";
import { createSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Email opt-out. Works without signing in because the link's signature proves who it was sent to.
 *   GET   shows a confirmation page (so mail scanners that prefetch links cannot unsubscribe anyone)
 *   POST  performs the opt-out — used by that page's button and by mail clients' one-click unsubscribe
 */
const page = (title: string, body: string, form?: { u: string; t: string }) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2a1d16">
<main style="max-width:420px;padding:32px;background:#fffdf9;border-radius:16px;margin:16px">
<p style="font-size:13px;letter-spacing:.18em;font-weight:600;margin:0 0 16px">FRIDAY</p><h1 style="font-size:22px;margin:0 0 12px">${title}</h1><p style="line-height:1.55;margin:0 0 20px">${body}</p>
${form ? `<form method="post" action="/api/email/unsubscribe?u=${encodeURIComponent(form.u)}&t=${encodeURIComponent(form.t)}"><button style="background:#c2410c;color:#fff;border:0;border-radius:999px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Unsubscribe</button></form>` : `<a href="/settings" style="color:#c2410c">Notification settings</a>`}
</main></body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );

function params(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  return { u, t, valid: /^[0-9a-f-]{36}$/i.test(u) && verifyUnsubscribeToken(u, t) };
}

export async function GET(req: Request) {
  const { u, t, valid } = params(req);
  if (!valid) return page("This link isn't valid", "It may have been copied incorrectly. You can turn email alerts off any time in your FRIDAY notification settings.");
  return page("Unsubscribe from FRIDAY email?", "You'll stop receiving FRIDAY emails. In-app notifications are unaffected, and you can turn email back on in Settings.", { u, t });
}

export async function POST(req: Request) {
  const { valid, u } = params(req);
  if (!valid) return new Response("Invalid unsubscribe link", { status: 400 });
  const { error } = await createSupabaseAdmin().from("profiles").update({ email_unsubscribed_at: new Date().toISOString() }).eq("id", u);
  if (error) return new Response("Could not update your preference. Please try again.", { status: 500 });
  return page("You're unsubscribed", "You won't receive any more FRIDAY emails. You can turn them back on in Settings whenever you like.");
}
