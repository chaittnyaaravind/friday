import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Request origin is not allowed" }, { status: 403 });
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signOut();
  if (error) return NextResponse.json({ error: "Sign-out failed. Please retry." }, { status: 502 });
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
