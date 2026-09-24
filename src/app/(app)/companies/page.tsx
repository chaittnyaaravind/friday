import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { FollowButton, RunAgentButton } from "@/components/actions";
import { Card, CompanyMark, Label, PageHeader, SectionHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Companies" };

type Co = { id: string; slug: string; name: string; hq_city: string | null; industry: string | null; careers_url: string | null; ats: string | null; discoverable: boolean; is_sjsu: boolean; last_crawled_at: string | null; open: number; following: boolean };

const ATS_LABEL: Record<string, string> = { workday: "Workday", greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", smartrecruiters: "SmartRecruiters", careers_page: "Careers page" };

export default async function Companies({ searchParams }: PageProps<"/companies">) {
  const { q } = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  let query = db.from("companies").select("id, slug, name, hq_city, industry, careers_url, ats, discoverable, is_sjsu, last_crawled_at, jobs(count)").eq("is_sjsu", false).eq("jobs.status", "active").order("name");
  if (typeof q === "string" && q.trim()) query = query.ilike("name", `%${q.trim()}%`);
  const [{ data }, { data: watched }] = await Promise.all([query, db.from("company_watchlists").select("company_id").eq("user_id", user.id)]);
  const follow = new Set((watched ?? []).map((w) => w.company_id));
  const all: Co[] = (data ?? []).map(({ jobs, ...c }) => ({ ...c, open: (jobs as unknown as { count: number }[])[0]?.count ?? 0, following: follow.has(c.id) }));

  const following = all.filter((c) => c.following);
  const hiring = all.filter((c) => c.discoverable && c.open > 0 && !c.following).sort((a, b) => b.open - a.open);
  const quiet = all.filter((c) => c.discoverable && c.open === 0 && !c.following);
  const watchOnly = all.filter((c) => !c.discoverable && !c.following);

  return (
    <>
      <PageHeader
        eyebrow="Companies"
        title={<>Follow the companies you <span className="serif-em">want</span>.</>}
        sub="FRIDAY reads each company's own careers system every morning. Follow one and you'll get an alert the day it posts a student role."
        actions={following.length ? <RunAgentButton scope="watchlist" label="Check my companies" /> : undefined}
      />
      <form className="mb-10 max-w-md">
        <input name="q" defaultValue={typeof q === "string" ? q : ""} placeholder="Find a company…" className="h-11 w-full rounded-[10px] bg-surface-2 px-4 text-[14px] outline-none hairline placeholder:text-dim focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]" />
      </form>

      <div className="flex flex-col gap-14">
        {following.length > 0 && <Group title="My companies" eyebrow={`${following.length} followed`} items={following} />}
        <Group title="Hiring students now" eyebrow="Open roles from official feeds" items={hiring} />
        {quiet.length > 0 && <Group title="Watching — no open student roles today" eyebrow="Checked daily" items={quiet} />}
        {watchOnly.length > 0 && (
          <section className="flex flex-col gap-5">
            <SectionHeader eyebrow="No public feed FRIDAY may read" title="Career pages to check yourself" />
            <p className="-mt-2 max-w-[62ch] text-[13.5px] text-muted">These companies don&apos;t publish a feed FRIDAY is permitted to read. Follow them to keep them on your radar, open their student careers page, and import any listing you find.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {watchOnly.map((c) => (
                <Card key={c.id} className="flex items-center gap-3 p-4">
                  <CompanyMark name={c.name} size={34} />
                  <a href={c.careers_url ?? "#"} target="_blank" rel="noopener noreferrer" className="group min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[14.5px]">{c.name}<ArrowUpRight size={13} className="text-dim group-hover:text-text" /></span>
                    <span className="block truncate text-[12px] text-muted">{c.hq_city} · {c.industry}</span>
                  </a>
                  <FollowButton companyId={c.id} following={c.following} />
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function Group({ title, eyebrow, items }: { title: string; eyebrow: string; items: Co[] }) {
  return (
    <section className="flex flex-col gap-5">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => (
          <Link key={c.id} href={`/companies/${c.slug}`}>
            <Card interactive className="flex h-full flex-col gap-4 p-4">
              <div className="flex items-center gap-3">
                <CompanyMark name={c.name} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">{c.name}</p>
                  <p className="truncate text-[12px] text-muted">{c.hq_city} · {c.industry}</p>
                </div>
                <FollowButton companyId={c.id} following={c.following} />
              </div>
              <div className="flex items-end justify-between">
                <span className="flex items-baseline gap-2">
                  <span className="num text-[26px] font-light leading-none tracking-[-0.03em]">{c.open}</span>
                  <Label>open student role{c.open === 1 ? "" : "s"}</Label>
                </span>
                <span className="text-[11px] text-dim">{ATS_LABEL[c.ats ?? ""] ?? ""}{c.last_crawled_at ? ` · ${ago(c.last_crawled_at)}` : ""}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
