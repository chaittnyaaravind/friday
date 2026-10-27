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

/** POST /api/auth/signup — creates a confirmed account with no email round-trip (lib/auth/accounts.ts). */
export async function POST(req: Request) {
  try {
    const { email, password, website } = await body(req, Signup);
    // Bots fill the hidden field: same answer as a real sign-up, and no account.
    if (website) return ok({ created: true }, { status: 201 });
    const result = await createAccount(createSupabaseAdmin(), email, password).catch((e: { code?: string; message?: string }) => {
      if (e.code === "weak_password") throw new HttpError(422, e.message ?? "Choose a stronger password.");
      throw e;
    });
    if (result === "exists") return ok({ error: "exists" }, { status: 409 });
    return ok({ created: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
