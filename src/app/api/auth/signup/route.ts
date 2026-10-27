import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, errorResponse, HttpError, ok } from "@/lib/api";
import { createAccount, isTransient } from "@/lib/auth/accounts";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const Signup = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  /** Honeypot: a field people never see. */
  website: z.string().max(200).optional(),
});

export const maxDuration = 60;
/** How long a slot is held at most; a create that takes longer is answered "in line" and retried by the browser. */
const HOLD_S = 40;

/** Does this password open the account? Checked in Postgres (migration 0024), so sign-in rate limits never interfere. */
const opens = (admin: SupabaseClient, email: string, password: string) => async () => {
  const { data, error } = await admin.rpc("account_password_matches", { p_email: email, p_password: password });
  return !error && data === true;
};

/** POST /api/auth/signup — creates a confirmed account with no email round-trip (lib/auth/accounts.ts). */
export async function POST(req: Request) {
  try {
    const { email, password, website } = await body(req, Signup);
    // Bots fill the hidden field: same answer as a real sign-up, and no account.
    if (website) return ok({ created: true }, { status: 201 });
    const admin = createSupabaseAdmin();
    // Admission control (migration 0025): at most 8 creates at once across every server, so a burst never overloads the
    // auth server. No free slot → 202, and the browser asks again a moment later.
    const { data: lease, error: leaseError } = await admin.rpc("take_signup_slot", { p_hold_seconds: HOLD_S });
    if (leaseError) throw leaseError;
    const slot = (lease as { slot: number; holder: string }[] | null)?.[0];
    if (!slot) return ok({ queued: true }, { status: 202 });
    let result;
    try {
      result = await createAccount(admin, email, password, { isOurs: opens(admin, email, password), attempts: 2 });
    } catch (e) {
      const err = e as { code?: string; status?: number; message?: string };
      if (err.code === "weak_password") throw new HttpError(422, err.message ?? "Choose a stronger password.");
      if (isTransient({ ...err, message: err.message ?? "" })) return ok({ queued: true }, { status: 202 });
      throw e;
    } finally {
      await admin.rpc("free_signup_slot", { p_slot: slot.slot, p_holder: slot.holder });
    }
    if (result === "exists") return ok({ error: "exists" }, { status: 409 });
    return ok({ created: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
