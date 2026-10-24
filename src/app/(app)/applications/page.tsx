import { Suspense } from "react";
import { Board, BoardSummary, type App } from "@/components/board";
import { PageHeader } from "@/components/ui";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Applications" };

export default async function Applications() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [{ data: apps }, { data: versions }] = await Promise.all([
    db.from("applications").select("*, jobs(deadline, status, pay_hourly_min, pay_hourly_max, campus_roles, discovered_at, is_on_campus), follow_ups!follow_ups_parent_owner_fk(id, due_at, done_at, note), interviews!interviews_parent_owner_fk(id, scheduled_at, kind)").eq("user_id", user.id).order("position").order("updated_at", { ascending: false }),
    db.from("resume_versions").select("id, label").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);
  const list = (apps ?? []) as App[];
  return (
    <>
      <PageHeader
        eyebrow="Applications"
        title={<>Your <span className="serif-em">pipeline</span>.</>}
        sub="Everything you're pursuing, from saved to offer. Drag between columns; open a card for notes, follow-ups, interviews, the application packet and a cover letter drafted from your real resume. FRIDAY never submits for you."
      />
      <div className="flex flex-col gap-8">
        <BoardSummary apps={list} />
        <Suspense>
          <Board initial={list} versions={versions ?? []} />
        </Suspense>
      </div>
    </>
  );
}
