import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, errorResponse, HttpError, ok } from "@/lib/api";
import { createAccount } from "@/lib/auth/accounts";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const Signup = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  /** Honeypot: a field people never see. */
  website: z.string().max(200).optional(),
});

// Under a burst the auth server is slow; createAccount retries with backoff, so give it room.
export const maxDuration = 120;

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
    const result = await createAccount(admin, email, password, { isOurs: opens(admin, email, password) }).catch((e: { code?: string; message?: string }) => {
      if (e.code === "weak_password") throw new HttpError(422, e.message ?? "Choose a stronger password.");
      throw e;
    });
    if (result === "exists") return ok({ error: "exists" }, { status: 409 });
    return ok({ created: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
