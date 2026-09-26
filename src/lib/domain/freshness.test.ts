import { describe, expect, it } from "vitest";
import { ARCHIVE_DAYS, archiveCutoff, freshnessOf } from "./freshness";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const job = (o: Partial<Parameters<typeof freshnessOf>[0]> = {}) => ({ status: "active", discovered_at: ago(24 * 30), last_verified_at: ago(1), deadline: null, ...o });

describe("freshnessOf — only claims what the evidence supports", () => {
  it("new: found in the last few days AND confirmed recently", () => {
    expect(freshnessOf(job({ discovered_at: ago(10), last_verified_at: ago(2) }), NOW).state).toBe("new");
  });
  it("recently verified: confirmed within 48h but discovered long ago", () => {
    expect(freshnessOf(job({ last_verified_at: ago(20) }), NOW).state).toBe("recent");
  });
  it("active: confirmed 2–14 days ago", () => {
    const f = freshnessOf(job({ last_verified_at: ago(24 * 5) }), NOW);
    expect(f.state).toBe("active");
    expect(f.detail).toMatch(/5 days ago/);
  });
  it("stale: not confirmed for over 14 days — says it may have closed", () => {
    const f = freshnessOf(job({ last_verified_at: ago(24 * 20) }), NOW);
    expect(f.state).toBe("stale");
    expect(f.detail).toMatch(/may have closed/);
  });
  it("a listing with no verification timestamp is never called active", () => {
    expect(freshnessOf(job({ last_verified_at: null }), NOW).state).toBe("stale");
    expect(freshnessOf(job({ last_verified_at: "garbage" }), NOW).state).toBe("stale");
  });
  it("new requires recent verification: a stale-verified new find is not 'new'", () => {
    expect(freshnessOf(job({ discovered_at: ago(24), last_verified_at: ago(24 * 5) }), NOW).state).toBe("active");
  });
  it("closed and expired statuses win over any timestamp", () => {
    expect(freshnessOf(job({ status: "closed" }), NOW).state).toBe("closed");
    expect(freshnessOf(job({ status: "broken" }), NOW).state).toBe("closed");
    expect(freshnessOf(job({ status: "expired" }), NOW).state).toBe("expired");
  });
  it("a passed deadline expires an otherwise active listing; a future deadline does not", () => {
    expect(freshnessOf(job({ deadline: "2026-09-01" }), NOW).state).toBe("expired");
    expect(freshnessOf(job({ deadline: "2026-10-30" }), NOW).state).toBe("recent");
    expect(freshnessOf(job({ deadline: "2026-09-26" }), NOW).state).not.toBe("expired"); // deadline day itself is still open
  });
});

describe("archiveCutoff", () => {
  it("is exactly ARCHIVE_DAYS before now", () => {
    expect(Date.parse(archiveCutoff(NOW))).toBe(NOW - ARCHIVE_DAYS * 86_400_000);
  });
});
