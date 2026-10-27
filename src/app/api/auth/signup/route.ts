import { createClient } from "@supabase/supabase-js";
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

/** Does this password open the account? Stateless: nothing is stored, and the session it returns is dropped. */
const opens = (email: string, password: string) => async () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.auth.signInWithPassword({ email, password });
  return !error;
};

/** POST /api/auth/signup — creates a confirmed account with no email round-trip (lib/auth/accounts.ts). */
export async function POST(req: Request) {
  try {
    const { email, password, website } = await body(req, Signup);
    // Bots fill the hidden field: same answer as a real sign-up, and no account.
    if (website) return ok({ created: true }, { status: 201 });
    const result = await createAccount(createSupabaseAdmin(), email, password, { isOurs: opens(email, password) }).catch((e: { code?: string; message?: string }) => {
      if (e.code === "weak_password") throw new HttpError(422, e.message ?? "Choose a stronger password.");
      throw e;
    });
    if (result === "exists") return ok({ error: "exists" }, { status: 409 });
    return ok({ created: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
