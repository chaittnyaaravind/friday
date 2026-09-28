/**
 * LIVE verification of every SJSU source in the registry, through FRIDAY's real readers.
 *   npm run test:live
 * Read-only GETs (one page/feed per source, FRIDAY's User-Agent, a pause between requests). It asserts that each source
 * can still be READ without error and prints what it currently lists. It deliberately does not assert counts: openings
 * come and go, and a page with nothing open is a valid result. What it catches is a source that has MOVED or broken —
 * e.g. the old Peer Connections address, which now redirects to a general landing page and listed nothing for weeks.
 * A source earns its `verifiedOn` date in capabilities.ts by passing here.
 */
import { describe, expect, it } from "vitest";
import { REGISTRY } from "@/lib/discovery/registry";
import { ADAPTERS, type CompanyFeed, type SourceKind } from "@/lib/discovery/sources";

describe("SJSU sources (live)", () => {
  const sjsu = REGISTRY.filter((c) => c.isSjsu);

  it("every registered SJSU source can be read, and the table shows what each lists right now", async () => {
    const rows: string[] = [];
    const failures: string[] = [];
    for (const c of sjsu) {
      const feed: CompanyFeed = { slug: c.slug, name: c.name, ats: c.ats as SourceKind, config: c.config ?? {} };
      try {
        const out = await ADAPTERS[c.ats as SourceKind]!(feed);
        rows.push(`ok   | ${c.slug.padEnd(28)} | ${c.ats.padEnd(10)} | ${String(out.length).padStart(2)} listed | ${out.slice(0, 3).map((p) => p.title).join(" / ")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        rows.push(`FAIL | ${c.slug.padEnd(28)} | ${c.ats.padEnd(10)} | ${msg}`);
        failures.push(`${c.slug}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    process.stdout.write("\n" + rows.join("\n") + "\n");
    expect(failures, "sources that could not be read").toEqual([]);
  });
});
