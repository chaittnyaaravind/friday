import { LogOut } from "lucide-react";
import { ProfileForm } from "@/components/profile-form";
import { Card, Label, PageHeader } from "@/components/ui";
import { isAiConfigured } from "@/lib/ai/client";
import { loadProfileValues } from "@/lib/data/profile";
import { createSupabaseServer, isAdminConfigured, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const initial = await loadProfileValues(db, user.id, user.email);
  const status = [
    { label: "Job discovery", ok: isAdminConfigured(), off: "SUPABASE_SECRET_KEY missing — FRIDAY can't write newly discovered jobs." },
    { label: "FRIDAY AI (resume parsing, tailoring, chat)", ok: isAiConfigured(), off: "No free AI key set (GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY) — AI features are off; matching and FRIDAY Local still work." },
    { label: "Daily schedule", ok: Boolean(process.env.CRON_SECRET), off: "CRON_SECRET missing — the morning run can't authenticate." },
  ];
  return (
    <>
      <PageHeader eyebrow="Settings" title="Your profile" sub={`Signed in as ${user.email}. Everything here is private to you and protected by row-level security.`} />
      <div className="flex flex-col gap-10">
        <ProfileForm initial={initial} mode="settings" />
        <Card className="flex flex-col gap-4 p-6 md:p-8">
          <Label>System</Label>
          <ul className="flex flex-col gap-3">
            {status.map((s) => (
              <li key={s.label} className="flex items-start gap-3 text-[14px]">
                <span className={s.ok ? "mt-1.5 size-2 shrink-0 rounded-full bg-moss" : "mt-1.5 size-2 shrink-0 rounded-full bg-amber"} />
                <span>{s.label}<span className="block text-[12.5px] text-muted">{s.ok ? "Connected" : s.off}</span></span>
              </li>
            ))}
          </ul>
        </Card>
        <form action="/auth/signout" method="post">
          <button className="inline-flex items-center gap-2 text-[14px] text-muted hover:text-accent"><LogOut size={15} /> Sign out</button>
        </form>
      </div>
    </>
  );
}
