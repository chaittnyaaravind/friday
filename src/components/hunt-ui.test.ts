/**
 * Render tests for the hunt components: they turn real component output into HTML and check what a student would
 * actually read — including that nothing claims to be real-time.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceStatusSummary } from "@/lib/discovery/health";
import { HuntNav } from "./hunt-nav";
import { SourceStatusStrip } from "./source-status";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const base: SourceStatusSummary = { sources: 0, ok: 0, failing: 0, blocked: 0, overdue: 0, lastCheckedAt: null, minutesSinceCheck: null, cadenceMinutes: null, groups: [] };
const healthy: SourceStatusSummary = {
  sources: 3, ok: 3, failing: 0, blocked: 0, overdue: 0, lastCheckedAt: "2026-09-27T11:50:00.000Z", minutesSinceCheck: 10, cadenceMinutes: 180,
  groups: [
    { source: "greenhouse", sources: 2, failing: 0, lastSuccessAt: "2026-09-27T11:50:00.000Z", minutesSinceCheck: 10 },
    { source: "sjsu_page", sources: 1, failing: 0, lastSuccessAt: "2026-09-27T10:20:00.000Z", minutesSinceCheck: 100 },
  ],
};

describe("HuntNav", () => {
  it("shows the four views as links; only the current one is marked current", () => {
    const h = html(createElement(HuntNav, { tab: "today", window: "6h" }));
    for (const label of ["New today", "Just opened", "Closing soon", "Best matches"]) expect(text(h)).toContain(label);
    expect(h.match(/aria-current="page"/g)).toHaveLength(1);
    expect(h).toContain('href="/hunt?tab=today"');
    expect(h).toContain('href="/hunt?tab=closing"');
    expect(h).toContain('href="/hunt?tab=best"');
    expect(text(h)).not.toContain("First seen within"); // window chips belong to "Just opened" only
  });
  it("'Just opened' shows the four first-seen windows, marks the chosen one, and keeps it in its own link", () => {
    const h = html(createElement(HuntNav, { tab: "just-opened", window: "1h" }));
    for (const label of ["15 min", "1 hour", "6 hours", "24 hours"]) expect(text(h)).toContain(label);
    expect(text(h)).toContain("First seen within");
    expect(h.match(/aria-current="true"/g)).toHaveLength(1);
    expect(h).toContain('href="/hunt?tab=just-opened&amp;window=15m"');
    expect(h).toContain('href="/hunt?tab=just-opened&amp;window=1h"');
  });
  it("switching back to 'Just opened' remembers the window", () => {
    expect(html(createElement(HuntNav, { tab: "best", window: "24h" }))).toContain('href="/hunt?tab=just-opened&amp;window=24h"');
  });
});

describe("SourceStatusStrip", () => {
  it("with no recorded check it says so and shows no time", () => {
    const t = text(html(createElement(SourceStatusStrip, { status: base })));
    expect(t).toContain("No source check recorded yet");
    expect(t).not.toMatch(/Last check/);
    expect(t).not.toMatch(/sources read fine/);
  });
  it("healthy: last check time, source count, and the cadence — worded as NOT real-time", () => {
    const h = html(createElement(SourceStatusStrip, { status: healthy }));
    const t = text(h);
    expect(t).toContain("Last check 10 min ago");
    expect(t).toContain("3 of 3 sources read fine");
    expect(t).toContain("Checked about every 3h — not real-time");
    expect(t).not.toMatch(/failing|overdue|holding/);
    expect(h).toContain("bg-moss");
  });
  it("lists each kind of source with its own check time", () => {
    const t = text(html(createElement(SourceStatusStrip, { status: healthy })));
    expect(t).toContain("Greenhouse ×2");
    expect(t).toContain("checked 10 min ago");
    expect(t).toContain("Official SJSU pages ×1");
    expect(t).toContain("checked 1 h ago");
  });
  it("failing, overdue and close-blocked sources are stated and turn the status amber", () => {
    const h = html(createElement(SourceStatusStrip, { status: { ...healthy, ok: 1, failing: 1, overdue: 1, blocked: 1, groups: [{ ...healthy.groups[0], failing: 1 }] } }));
    const t = text(h);
    expect(t).toContain("1 failing");
    expect(t).toContain("1 overdue");
    expect(t).toContain("1 holding listings open");
    expect(t).toContain("1 failing · checked 10 min ago");
    expect(h).toContain("bg-amber");
    expect(h).not.toContain("bg-moss");
  });
  it("NEVER claims real-time or live: the only such words are 'not real-time'", () => {
    for (const status of [base, healthy, { ...healthy, cadenceMinutes: null }]) {
      const t = text(html(createElement(SourceStatusStrip, { status })));
      expect(t.replace(/not real-time/gi, "")).not.toMatch(/real-?time|\blive\b/i);
    }
  });
  it("an unknown cadence is still worded as a schedule, not as a live feed", () => {
    expect(text(html(createElement(SourceStatusStrip, { status: { ...healthy, cadenceMinutes: null } })))).toContain("Checked on a schedule — not real-time");
  });
});
