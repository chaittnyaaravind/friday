import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-next";
import { createSupabaseServer } from "@/lib/supabase/server";

/** One-time sign-in links FRIDAY generates itself (lib/auth/accounts.ts): verifies the token hash and sets the session cookie. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const next = safeNextPath(url.searchParams.get("next"));

  if (tokenHash && url.searchParams.get("type") === "magiclink") {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "That sign-in link is invalid, used or expired. Request a new one.");
  return NextResponse.redirect(login);
}
