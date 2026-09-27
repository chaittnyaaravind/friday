"use client";

import { ArrowUpRight, Bookmark } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { searchLinks } from "@/lib/discovery/search-links";
import { Card, Input, Label } from "./ui";

/**
 * Opens each job site's own live search, pre-filled for the student's area — LinkedIn, SJSU Handshake, Indeed,
 * Google Jobs and more. FRIDAY doesn't read those sites: the student browses them signed in as themselves, then brings
 * any listing back with the Send-to-FRIDAY bookmarklet so it's matched, tracked and tailored here.
 */
export function SearchEverywhere({ query, city, radiusMiles, internshipsOnly = false }: { query?: string; city: string; radiusMiles: number; internshipsOnly?: boolean }) {
  const [q, setQ] = useState(query ?? "");
  const [internship, setInternship] = useState(internshipsOnly);
  const [lastDay, setLastDay] = useState(false);
  const links = useMemo(() => searchLinks({ query: q, city, radiusMiles, internship, lastDay }), [q, city, radiusMiles, internship, lastDay]);

  return (
    <Card className="flex flex-col gap-5 p-5 md:p-6">
      <div className="flex flex-col gap-1.5">
        <Label>Search everywhere</Label>
        <h3 className="text-[20px] leading-tight">Live jobs near {city}</h3>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-muted">
          FRIDAY searches 100+ employers and SJSU&apos;s pages for you. For LinkedIn, Handshake and other sites — which don&apos;t allow apps to read them — open their live search below, already set to your area, then send any listing back to FRIDAY with one click.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-[300px]"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="software engineer intern" aria-label="What to search for" /></div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={internship} onChange={(e) => setInternship(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Internships only</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Past 24 hours</label>
      </div>

      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.note || undefined}
            className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] text-text hairline transition-colors hover:bg-[rgb(var(--ink)/.05)]"
          >
            {l.name} <ArrowUpRight size={14} className="text-dim" />
          </a>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-dim">
        <Bookmark size={13} /> Found one you like? Click <b className="font-medium text-muted">Send to FRIDAY</b> on the listing —
        <Link href="/import" className="text-accent underline-offset-2 hover:underline">install the bookmarklet</Link>.
      </p>
    </Card>
  );
}
