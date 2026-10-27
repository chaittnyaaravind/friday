import { z } from "zod";
import { body, errorResponse, ok } from "@/lib/api";
import { sendTelegramLink } from "@/lib/auth/accounts";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { botUsername } from "@/lib/telegram/bot";

const Link = z.object({ email: z.string().trim().toLowerCase().email().max(254), next: z.string().max(300).optional() });

/**
 * POST /api/auth/link — a one-time sign-in link sent to the student's linked Telegram chat.
 * { channel: "none" } means the browser should fall back to the email link.
 */
export async function POST(req: Request) {
  try {
    const { email, next } = await body(req, Link);
    const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
    const result = await sendTelegramLink(createSupabaseAdmin(), { email, next: safeNextPath(next), site });
    return ok({ ...result, bot: result.channel === "none" ? null : botUsername() });
  } catch (e) {
    return errorResponse(e);
  }
}
