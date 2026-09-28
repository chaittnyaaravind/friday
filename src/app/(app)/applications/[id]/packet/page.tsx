import Link from "next/link";
import { notFound } from "next/navigation";
import { PacketReview } from "@/components/apply/packet-review";
import { Notice, PageHeader } from "@/components/ui";
import { aiProviders } from "@/lib/ai/client";
import { CONFIRM_TEXT } from "@/lib/apply/packet";
import { getPacketState } from "@/lib/apply/packet-service";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Application packet" };

export default async function PacketPage({ params }: PageProps<"/applications/[id]/packet">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: app } = await db.from("applications").select("id, job_id, company_name, job_title, status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!app) notFound();

  const back = <Link href="/applications" className="text-[13px] text-muted hover:text-text">← Tracker</Link>;
  const header = (
    <PageHeader
      eyebrow={`Application packet · ${app.company_name}`}
      title={<>{app.job_title}</>}
      sub="Everything FRIDAY has prepared, exactly as you would send it. Review it, approve this content, then submit on the employer's own site — FRIDAY never submits for you."
      actions={back}
    />
  );

  if (!app.job_id) {
    return (
      <>
        {header}
        <Notice tone="amber" title="This application was added by hand">A packet is built from a listing FRIDAY knows about, and this one has none. You can still track it in the tracker.</Notice>
      </>
    );
  }

  const [state, { data: versions }] = await Promise.all([
    getPacketState(db, user.id, id),
    db.from("resume_versions").select("id, label, kind").eq("user_id", user.id).neq("kind", "legacy").order("updated_at", { ascending: false }),
  ]);

  return (
    <>
      {header}
      <div className="max-w-[820px]">
        <PacketReview applicationId={id} state={state} versions={(versions ?? []) as { id: string; label: string; kind: string }[]} confirmText={CONFIRM_TEXT} aiConfigured={aiProviders().length > 0} />
      </div>
    </>
  );
}
