import { Suspense } from "react";
import { parseFilters, searchJobs, type JobFilters } from "@/lib/data/jobs";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";
import { Filters } from "./filters";
import { JobGrid } from "./job-card";
import { LinkButton } from "./ui";

const PAGE = 24;

/** Server-rendered feed: URL params → search_jobs → grid. Presets lock the page's scope. */
export async function Feed({
  searchParams,
  preset,
  lockTypes,
  empty,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  preset?: Partial<JobFilters>;
  lockTypes?: boolean;
  empty: { title: string; body?: React.ReactNode; action?: React.ReactNode };
}) {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: profile } = await db.from("profiles").select("work_authorization").eq("id", user.id).single();
  const f = { ...parseFilters(searchParams), ...preset };
  const offset = f.offset ?? 0;
  const { jobs, total } = await searchJobs(db, { ...f, limit: PAGE, offset });

  const qs = (o: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v != null && k !== "offset") p.set(k, Array.isArray(v) ? v.join(",") : v);
    if (o) p.set("offset", String(o));
    return `?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <Suspense>
        <Filters total={total} preset={{ hideType: lockTypes, isF1: profile?.work_authorization === "f1" }} />
      </Suspense>
      <JobGrid jobs={jobs} empty={empty} />
      {total > PAGE && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-[12.5px] text-dim">
            <span className="num font-mono">{offset + 1}–{Math.min(offset + PAGE, total)}</span> of <span className="num font-mono">{total}</span>
          </span>
          <div className="flex gap-2">
            {offset > 0 && <LinkButton href={qs(Math.max(0, offset - PAGE))} size="sm">Previous</LinkButton>}
            {offset + PAGE < total && <LinkButton href={qs(offset + PAGE)} size="sm">Next</LinkButton>}
          </div>
        </div>
      )}
    </div>
  );
}
