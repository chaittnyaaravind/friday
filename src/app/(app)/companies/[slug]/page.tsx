import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/actions";
import { JobGrid } from "@/components/job-card";
import { CompanyMark, Label, LinkButton } from "@/components/ui";
import { searchJobs } from "@/lib/data/jobs";
import { ago } from "@/lib/format";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export default async function CompanyPage({ params }: PageProps<"/companies/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: c } = await db.from("companies").select("id, slug, name, hq_city, industry, careers_url, ats, discoverable, last_crawled_at").eq("slug", slug).maybeSingle();
  if (!c) notFound();
  const [{ jobs, total }, { data: w }] = await Promise.all([
    searchJobs(db, { companies: [c.slug], limit: 60 }),
    db.from("company_watchlists").select("company_id").eq("user_id", user.id).eq("company_id", c.id).maybeSingle(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <Link href="/companies" className="reveal inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft size={14} /> Companies
      </Link>
      <header className="reveal flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-4">
          <CompanyMark name={c.name} size={56} />
          <div className="flex flex-col gap-2">
            <h1 className="text-[36px] leading-none md:text-[48px]">{c.name}</h1>
            <Label>{c.hq_city} · {c.industry} · {c.discoverable ? `checked ${c.last_crawled_at ? ago(c.last_crawled_at) : "daily"}` : "no public feed"}</Label>
          </div>
        </div>
        <div className="flex gap-2">
          <FollowButton companyId={c.id} following={Boolean(w)} />
          {c.careers_url && (
            <LinkButton href={c.careers_url} external size="sm" variant="secondary">
              Official careers <ArrowUpRight size={14} />
            </LinkButton>
          )}
        </div>
      </header>
      <section className="flex flex-col gap-4">
        <Label><span className="num">{total}</span> open student role{total === 1 ? "" : "s"}</Label>
        <JobGrid
          jobs={jobs}
          empty={{
            title: c.discoverable ? "No open student roles today" : "FRIDAY can't read this company's feed",
            body: c.discoverable ? "Follow to get an alert the day they post one." : "Check their official careers page, then import any listing you find.",
          }}
        />
      </section>
    </div>
  );
}
