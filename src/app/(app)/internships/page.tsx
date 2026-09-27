import Link from "next/link";
import { ImportDialog } from "@/components/actions";
import { Feed } from "@/components/feed";
import { SearchEverywhere } from "@/components/search-everywhere";
import { PageHeader, cx } from "@/components/ui";
import { loadSearchArea } from "@/lib/data/profile";
import { CATEGORIES } from "@/lib/domain/normalize";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Internships" };

export default async function Internships({ searchParams }: PageProps<"/internships">) {
  const sp = await searchParams;
  const user = await requireUser();
  const area = await loadSearchArea(await createSupabaseServer(), user.id);
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
      <div className="mb-6"><SearchEverywhere query={typeof sp.q === "string" ? sp.q : undefined} city={area.city} radiusMiles={area.radiusMiles} internshipsOnly /></div>
      <nav className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {["", ...CATEGORIES].map((c) => (
          <Link key={c || "all"} href={href(c)} className={cx("h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-8 transition-colors", current === c ? "bg-text text-bg" : "text-muted hairline hover:text-text")}>
            {c || "All"}
          </Link>
        ))}
      </nav>
      <Feed
        searchParams={sp}
        preset={{ types: ["internship", "co_op"], onCampus: false }}
        lockTypes
        empty={{ title: current ? `No ${current} internships right now` : "No internships match", body: "New internships post constantly — FRIDAY checks every morning and will alert you." }}
      />
    </>
  );
}
