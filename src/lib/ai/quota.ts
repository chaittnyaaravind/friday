/**
 * Daily AI allowances (migration 0027). Sign-up is instant, so AI spend is the thing worth protecting: each student gets
 * a generous daily allowance per kind of AI call, and each kind has a site-wide daily ceiling that caps the bill.
 * Deterministic features never count. Over the allowance, callers degrade (chat answers locally, tailoring skips the
 * AI pass) or say so plainly — never a silent failure.
 */
import "server-only";
import { HttpError } from "@/lib/api";
import { createSupabaseAdmin, isAdminConfigured } from "@/lib/supabase/server";

export const AI_LIMITS = {
  chat: { user: 80, global: 4000, label: "FRIDAY AI chat" },
  resume_ai: { user: 60, global: 3000, label: "AI resume edits" },
  tailor: { user: 25, global: 1500, label: "AI-tailored resumes" },
  cover_letter: { user: 15, global: 800, label: "AI cover letters" },
  analyze_job: { user: 40, global: 2000, label: "AI job analysis" },
} as const;
export type AiKind = keyof typeof AI_LIMITS;

/**
 * One more AI call of this kind for this student today? Records it when yes. A server without the admin key (local
 * development) keeps no ledger and allows; a ledger error is logged and allows too, so a database hiccup never takes a
 * feature down — the site-wide ceilings still hold on every call that does reach the ledger.
 */
export async function takeAiQuota(userId: string, kind: AiKind): Promise<boolean> {
  if (!isAdminConfigured()) return true;
  const l = AI_LIMITS[kind];
  const { data, error } = await createSupabaseAdmin().rpc("take_ai_quota", { p_user: userId, p_kind: kind, p_user_limit: l.user, p_global_limit: l.global });
  if (error) {
    console.error("[ai quota]", kind, error.message);
    return true;
  }
  return data === true;
}

export async function requireAiQuota(userId: string, kind: AiKind): Promise<void> {
  if (!(await takeAiQuota(userId, kind))) throw new HttpError(429, `You've used today's ${AI_LIMITS[kind].label}. It frees up again within 24 hours.`);
}
