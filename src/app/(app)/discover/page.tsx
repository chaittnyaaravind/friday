import { ImportDialog, RunAgentButton } from "@/components/actions";
import { Feed } from "@/components/feed";
import { Attribution, ProviderNotice } from "@/components/feed-status";
import { SearchEverywhere } from "@/components/search-everywhere";
import { Label, PageHeader } from "@/components/ui";
import { loadProviderStatus } from "@/lib/data/providers";
import { loadSearchArea } from "@/lib/data/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Discover" };

export default async function Discover({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [area, providers] = await Promise.all([loadSearchArea(db, user.id), loadProviderStatus(db)]);
  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title={<>Every opportunity, <span className="serif-em">verified</span>.</>}
        sub="SJSU on-campus jobs, Silicon Valley internships and student-friendly roles from official employer sources — deduplicated, ranked for you, and re-checked daily."
        actions={<><ImportDialog defaultSource="linkedin" /><RunAgentButton city={area.city} /></>}
      />
      <div className="mb-8"><SearchEverywhere query={typeof sp.q === "string" ? sp.q : undefined} city={area.city} state={area.state} radiusMiles={area.radiusMiles} /></div>
      <section className="flex flex-col gap-5" aria-label="Jobs found by FRIDAY">
        <div className="flex flex-col gap-1">
          <Label>Jobs found by FRIDAY</Label>
          <p className="text-[13px] text-muted">Indexed automatically from employers, SJSU&apos;s official pages and Adzuna, and re-checked every few hours.</p>
        </div>
        <ProviderNotice adzunaDown={Boolean(providers.adzuna?.attempted && !providers.adzuna.ok)} />
        <Feed searchParams={sp} empty={{ title: "No matching jobs found yet.", body: "Clear a filter or two, or run FRIDAY to check every source again." }} />
        <Attribution />
      </section>
    </>
  );
}
