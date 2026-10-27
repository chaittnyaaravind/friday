import { redirect } from "next/navigation";
import { HuntBrief } from "@/components/hunt-brief";
import { normalizeCampusPrefs } from "@/lib/domain/campus-fit";
import { loadProfileValues } from "@/lib/data/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Hunt brief" };

export default async function Onboarding() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: p } = await db.from("profiles").select("onboarded_at, campus_prefs").eq("id", user.id).single();
  if (p?.onboarded_at) redirect("/dashboard");
  const initial = await loadProfileValues(db, user.id, user.email);

  return (
    <main className="relative">
      <div aria-hidden className="pointer-events-none fixed inset-0 [background:radial-gradient(70%_50%_at_50%_0%,rgb(217_164_65/.08),transparent_70%)]" />
      <HuntBrief profile={initial} prefs={normalizeCampusPrefs(p?.campus_prefs)} />
    </main>
  );
}
