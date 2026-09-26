import { safeNextPath } from "@/lib/auth/safe-next";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/** Magic-link / email-confirmation landing: exchanges the PKCE code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext = safeNextPath(next);

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "That sign-in link is invalid or expired. Request a new one.");
  return NextResponse.redirect(login);
}
