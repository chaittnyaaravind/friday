import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
export async function GET() {
  const db = await createSupabaseServer();
  const { data, error } = await db.auth.getUser();
  return NextResponse.json({ authenticated: !error && Boolean(data.user) }, { status: !error && data.user ? 200 : 401, headers: { "Cache-Control": "no-store" } });
}
