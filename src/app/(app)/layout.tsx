import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: profile } = await db.from("profiles").select("full_name, onboarded_at").eq("id", user.id).single();
  if (!profile?.onboarded_at) redirect("/onboarding");
  return <AppShell name={profile.full_name ?? user.email ?? null}>{children}</AppShell>;
}
