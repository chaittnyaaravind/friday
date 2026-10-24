import { SJSU_ONLY } from "@/lib/scope";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ImportDialog } from "@/components/actions";
import { Feed } from "@/components/feed";
import { Attribution, ProviderNotice } from "@/components/feed-status";
import { SearchEverywhere } from "@/components/search-everywhere";
import { PageHeader, cx } from "@/components/ui";
import { loadProviderStatus } from "@/lib/data/providers";
import { loadSearchArea } from "@/lib/data/profile";
import { CATEGORIES } from "@/lib/domain/normalize";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Internships" };

export default async function Internships({ searchParams }: PageProps<"/internships">) {
  if (SJSU_ONLY) redirect("/sjsu"); // SJSU-only (lib/scope.ts)
  const sp = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [area, providers] = await Promise.all([loadSearchArea(db, user.id), loadProviderStatus(db)]);
  const current = typeof sp.category === "string" ? sp.category : "";
  const href = (c: string) => {
    const p = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "category" && k !== "offset" ? [[k, v]] : [])));
    if (c) p.set("category", c);
    return `/internships?${p.toString()}`;
  };
  return (
    <>
      <PageHeader
        eyebrow="Internships"
        title={<>Silicon Valley <span className="serif-em">internships</span>.</>}
        sub="Computer Science internships and co-ops from NVIDIA, Adobe, Cisco, Waymo and 60+ more — straight from each company's own careers system."
        actions={<ImportDialog defaultSource="linkedin" trigger="Import from LinkedIn / Indeed" />}
      />
      <div className="mb-6"><SearchEverywhere query={typeof sp.q === "string" ? sp.q : undefined} city={area.city} state={area.state} radiusMiles={area.radiusMiles} internshipsOnly /></div>
      <nav className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {["", ...CATEGORIES].map((c) => (
          <Link key={c || "all"} href={href(c)} className={cx("h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-8 transition-colors", current === c ? "bg-text text-bg" : "text-muted hairline hover:text-text")}>
            {c || "All"}
          </Link>
        ))}
      </nav>
      <ProviderNotice adzunaDown={Boolean(providers.adzuna?.attempted && !providers.adzuna.ok)} />
      <Feed
        searchParams={sp}
        preset={{ types: ["internship", "co_op"], onCampus: false }}
        lockTypes
        empty={{ title: current ? `No ${current} internships right now` : "No matching jobs found yet.", body: "New internships post constantly — FRIDAY checks every few hours and will alert you." }}
      />
      <div className="mt-6"><Attribution /></div>
    </>
  );
}
