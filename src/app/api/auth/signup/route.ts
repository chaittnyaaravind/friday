import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { body, errorResponse, HttpError, ok } from "@/lib/api";
import { createAccount, isTransient, readTurn, signTurn } from "@/lib/auth/accounts";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const Signup = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  /** Honeypot: a field people never see. */
  website: z.string().max(200).optional(),
  /** A signed turn from an earlier 202, when the browser comes back for it. */
  turn: z.string().max(100).optional(),
});

export const maxDuration = 60;
/** Accounts created per second at most (migration 0026). Measured ~15/s on this Supabase compute; raise it after an upgrade. */
const PER_SECOND = 12;
/** A turn this close is waited out on the server; a later one is handed to the browser to come back for. */
const WAIT_HERE_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Does this password open the account? Checked in Postgres (migration 0024), so sign-in rate limits never interfere. */
const opens = (admin: SupabaseClient, email: string, password: string) => async () => {
  const { data, error } = await admin.rpc("account_password_matches", { p_email: email, p_password: password });
  return !error && data === true;
};

async function reserve(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc("reserve_signup_turn", { p_per_second: PER_SECOND });
  if (error) throw error;
  return Date.parse(data as string);
}

/**
 * POST /api/auth/signup — creates a confirmed account with no email round-trip (lib/auth/accounts.ts).
 * Every sign-up reserves a turn first, so a burst reaches the auth server at a rate it can sustain instead of all at once:
 * 201 created · 202 { turn, waitMs } come back then · 409 the email already has an account.
 */
export async function POST(req: Request) {
  try {
    const { email, password, website, turn } = await body(req, Signup);
    // Bots fill the hidden field: same answer as a real sign-up, and no account.
    if (website) return ok({ created: true }, { status: 201 });
    const admin = createSupabaseAdmin();
    const key = process.env.SUPABASE_SECRET_KEY!;

    let at = readTurn(turn, email, key) ?? (await reserve(admin));
    let wait = at - Date.now();
    if (wait > WAIT_HERE_MS) return ok({ queued: true, turn: signTurn(email, at, key), waitMs: wait }, { status: 202 });
    if (wait > 0) await sleep(wait);

    try {
      const result = await createAccount(admin, email, password, { attempts: 1 });
      // "Exists" with this very password is this student's own account — an earlier request of theirs that timed out on
      // the way back still created it — so it is theirs to sign in to, not someone else's.
      if (result === "exists") return (await opens(admin, email, password)()) ? ok({ created: true }, { status: 201 }) : ok({ error: "exists" }, { status: 409 });
      return ok({ created: true }, { status: 201 });
    } catch (e) {
      const err = e as { code?: string; status?: number; message?: string };
      if (err.code === "weak_password") throw new HttpError(422, err.message ?? "Choose a stronger password.");
      if (!isTransient({ ...err, message: err.message ?? "" })) throw e;
      // The auth server hiccuped: a fresh turn at the back of the line, never an error for the student.
      at = await reserve(admin);
      wait = Math.max(0, at - Date.now());
      return ok({ queued: true, turn: signTurn(email, at, key), waitMs: wait }, { status: 202 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
