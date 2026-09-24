import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Request-scoped client acting as the signed-in user (RLS applies). */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. proxy.ts refreshes the session.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS — only for the discovery agent writing the
 * shared job catalog, never for reading or writing a user's own rows.
 */
export function createSupabaseAdmin() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new NotConfiguredError("SUPABASE_SECRET_KEY");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isAdminConfigured() {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

export class NotConfiguredError extends Error {
  constructor(public readonly variable: string) {
    super(`${variable} is not configured`);
    this.name = "NotConfiguredError";
  }
}

/** Current user or null, deduped per request. */
export const getUser = cache(async () => {
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

/** For pages behind auth: returns the user or redirects to /login. */
export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
