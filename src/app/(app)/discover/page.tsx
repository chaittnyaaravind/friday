import { ImportDialog, RunAgentButton } from "@/components/actions";
import { Feed } from "@/components/feed";
import { SearchEverywhere } from "@/components/search-everywhere";
import { PageHeader } from "@/components/ui";
import { loadSearchArea } from "@/lib/data/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Discover" };

export default async function Discover({ searchParams }: PageProps<"/discover">) {
  const sp = await searchParams;
  const user = await requireUser();
  const area = await loadSearchArea(await createSupabaseServer(), user.id);
  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title={<>Every opportunity, <span className="serif-em">verified</span>.</>}
        sub="SJSU on-campus jobs, Silicon Valley internships and student-friendly roles from official employer sources — deduplicated, ranked for you, and re-checked daily."
        actions={<><ImportDialog defaultSource="linkedin" /><RunAgentButton /></>}
      />
      <div className="mb-8"><SearchEverywhere query={typeof sp.q === "string" ? sp.q : undefined} city={area.city} radiusMiles={area.radiusMiles} /></div>
      <Feed searchParams={sp} empty={{ title: "No opportunities match these filters", body: "Clear a filter or two, or run FRIDAY to check every source again." }} />
    </>
  );
}
