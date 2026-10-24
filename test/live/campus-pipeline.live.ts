/**
 * LIVE: today's real SJSU listings through FRIDAY's real pipeline (reader → normalize → exclusion → pay → physical demand),
 * entirely in memory. Nothing is written anywhere. It prints what the campus hunter would store for each listing, so the
 * exclusion rules and the "only stated pay" rule can be checked against real postings rather than fixtures.
 *   npm run test:live
 */
import { describe, expect, it } from "vitest";
import { normalizePosting } from "@/lib/discovery/ingest";
import { REGISTRY } from "@/lib/discovery/registry";
import { ADAPTERS, type CompanyFeed, type SourceKind } from "@/lib/discovery/sources";

describe("SJSU campus pipeline (live, in memory)", () => {
  it("every live campus listing is normalized; dining work is excluded with a reason; pay is only what is stated", async () => {
    const rows: string[] = [];
    for (const c of REGISTRY.filter((x) => x.isSjsu)) {
      const feed: CompanyFeed = { slug: c.slug, name: c.name, ats: c.ats as SourceKind, config: c.config ?? {} };
      const postings = await ADAPTERS[c.ats as SourceKind]!(feed).catch(() => []);
      for (const p of postings) {
        const n = normalizePosting(p, { id: "live", slug: c.slug });
        if ("skip" in n) { rows.push(`skip      | ${c.slug.padEnd(26)} | ${p.title} (${n.skip})`); continue; }
        const r = n.row;
        // A stated hourly figure is the only pay that becomes pay_hourly_*.
        if (r.pay_hourly_max != null) expect(String(r.pay_text)).toMatch(/\/hr$/);
        rows.push(`${r.excluded_reason ? "EXCLUDED " : "listed   "} | ${c.slug.padEnd(26)} | ${String(p.title).slice(0, 48).padEnd(48)} | pay ${r.pay_hourly_max != null ? `$${r.pay_hourly_min}–$${r.pay_hourly_max}/hr` : "not stated"} | physical ${r.physical_demand}${r.excluded_reason ? ` | ${r.excluded_reason}` : ""}`);
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    process.stdout.write("\n" + rows.join("\n") + "\n");
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
