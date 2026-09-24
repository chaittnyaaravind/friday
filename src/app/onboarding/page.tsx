import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { Label } from "@/components/ui";
import { loadProfileValues } from "@/lib/data/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Welcome" };

export default async function Onboarding() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: p } = await db.from("profiles").select("onboarded_at").eq("id", user.id).single();
  if (p?.onboarded_at) redirect("/dashboard");
  const initial = await loadProfileValues(db, user.id, user.email);

  return (
    <main className="mx-auto flex w-full max-w-[980px] flex-col gap-12 px-4 pb-32 pt-12 sm:px-6 md:pt-20">
      <header className="reveal flex flex-col gap-4">
        <Label>FRIDAY · setup</Label>
        <h1 className="max-w-[16ch] text-[40px] leading-[0.98] md:text-[64px]">
          Let&apos;s find what <span className="serif-em">fits</span> you.
        </h1>
        <p className="max-w-[56ch] text-[16px] leading-relaxed text-muted">
          Two minutes. FRIDAY uses this to rank every SJSU on-campus job and Silicon Valley internship against you — and to explain exactly why each one matches. You can upload your resume next to fill in skills automatically.
        </p>
      </header>
      <ProfileForm initial={initial} mode="onboarding" />
    </main>
  );
}
