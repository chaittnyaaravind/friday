"use client";

import { ArrowUpRight, Bookmark, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { searchLinks } from "@/lib/discovery/search-links";
import { Button, Card, Input, Label } from "./ui";

/**
 * One search box, two clearly different things:
 *  - Search FRIDAY: the listings FRIDAY indexes automatically (employers, SJSU pages, Adzuna) — searched right here.
 *  - Search everywhere: each job site's own live search, opened in the student's browser, pre-filled for their area.
 *    FRIDAY does not read those sites (LinkedIn and Handshake forbid it); the student searches as themselves, then
 *    brings any listing back with the Send-to-FRIDAY bookmarklet.
 */
export function SearchEverywhere({ query, city, state, radiusMiles, internshipsOnly = false }: { query?: string; city: string; state?: string; radiusMiles: number; internshipsOnly?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const current = useSearchParams();
  const [q, setQ] = useState(query ?? "");
  const [internship, setInternship] = useState(internshipsOnly);
  const [lastDay, setLastDay] = useState(false);
  const links = useMemo(() => searchLinks({ query: q, city, state, radiusMiles, internship, lastDay }), [q, city, state, radiusMiles, internship, lastDay]);

  // Apply the same search to FRIDAY's own feed below (this page's URL is the source of truth for its filters).
  const searchFriday = () => {
    const next = new URLSearchParams(current.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    if (!internshipsOnly) {
      if (internship) next.set("type", "internship,co_op");
      else if (next.get("type") === "internship,co_op") next.delete("type");
    }
    if (lastDay) next.set("posted", "1");
    else if (next.get("posted") === "1") next.delete("posted");
    next.delete("offset");
    router.push(`${path}?${next.toString()}`, { scroll: false });
  };

  return (
    <Card className="flex flex-col gap-5 p-5 md:p-6">
      <div className="flex flex-col gap-1.5">
        <Label>Search</Label>
        <h3 className="text-[20px] leading-tight">Jobs near {city}</h3>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); searchFriday(); }} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-[320px]"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="software engineer intern" aria-label="What to search for" /></div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={internship} onChange={(e) => setInternship(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Internships only</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Past 24 hours</label>
      </form>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-8">
        <section className="flex flex-col gap-2.5" aria-label="Search FRIDAY">
          <span className="label">Search FRIDAY</span>
          <p className="text-[12.5px] leading-relaxed text-muted">Listings FRIDAY finds automatically — 100+ employers, SJSU&apos;s official pages and Adzuna — ranked against your resume.</p>
          <div><Button type="button" variant="primary" size="sm" onClick={searchFriday}><Search size={14} /> Search FRIDAY</Button></div>
        </section>

        <section className="flex flex-col gap-2.5 md:border-l-[0.5px] md:border-hairline-strong md:pl-8" aria-label="Search everywhere">
          <span className="label">Search everywhere</span>
          <p className="text-[12.5px] leading-relaxed text-muted">Opens each site&apos;s own live search in your browser, already set to your area. FRIDAY doesn&apos;t access these sites — you search as yourself.</p>
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                title={l.note || undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] text-text hairline transition-colors hover:bg-[rgb(var(--ink)/.05)]"
              >
                {l.name} <ArrowUpRight size={13} className="text-dim" />
              </a>
            ))}
          </div>
        </section>
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-dim">
        <Bookmark size={13} /> Found one on LinkedIn, Handshake or another site? Click <b className="font-medium text-muted">Send to FRIDAY</b> on the listing —
        <Link href="/import" className="text-accent underline-offset-2 hover:underline">install the bookmarklet</Link>. Imported listings are marked <b className="font-medium text-muted">Imported by you</b>.
      </p>
    </Card>
  );
}
