import { describe, expect, it } from "vitest";
import { bookmarkletSource, CAPTURE_LIMITS, clip, sourceFromUrl } from "./capture";

describe("sourceFromUrl", () => {
  it("recognises the sites students copy listings from", () => {
    expect(sourceFromUrl("https://sjsu.joinhandshake.com/jobs/123")).toBe("handshake");
    expect(sourceFromUrl("https://www.linkedin.com/jobs/view/999")).toBe("linkedin");
    expect(sourceFromUrl("https://www.indeed.com/viewjob?jk=abc")).toBe("indeed");
    expect(sourceFromUrl("https://jobs.example.com/apply/1")).toBe("other");
    expect(sourceFromUrl("not a url")).toBe("other");
  });
  it("does not trust look-alike hosts", () => {
    expect(sourceFromUrl("https://linkedin.com.evil.example/jobs")).toBe("other");
    expect(sourceFromUrl("https://notlinkedin.com/jobs")).toBe("other");
  });
});

describe("clip", () => {
  it("collapses whitespace, takes the first value and enforces the limit", () => {
    expect(clip("  a \n b  ", 10)).toBe("a b");
    expect(clip(["first", "second"], 10)).toBe("first");
    expect(clip(undefined, 10)).toBe("");
    expect(clip("x".repeat(500), 200)).toHaveLength(200);
  });
});

describe("bookmarkletSource", () => {
  const src = bookmarkletSource("https://friday-roan.vercel.app");

  it("is a single-line javascript: URL pointing at the given origin", () => {
    expect(src.startsWith("javascript:")).toBe(true);
    expect(src).not.toMatch(/\n/);
    expect(src).toContain('"https://friday-roan.vercel.app"');
  });

  it("only opens FRIDAY in a new tab — it makes no network request of its own", () => {
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|\.src\s*=/);
    expect(src).toContain("window.open(");
  });

  /** Run it against a tiny fake page and read the address it would open. */
  function run(page: { ld?: unknown; title?: string; h1?: string; body?: string; selection?: string; href: string }) {
    let opened = "";
    const el = (over: object) => ({ textContent: "", content: "", innerText: "", ...over });
    const doc = {
      title: page.title ?? "",
      body: el({ innerText: page.body ?? "" }),
      querySelectorAll: (q: string) => (q.includes("ld+json") && page.ld ? [el({ textContent: JSON.stringify(page.ld) })] : []),
      querySelector: (q: string) => (q === "h1" && page.h1 ? el({ textContent: page.h1 }) : null),
      createElement: () => ({
        html: "",
        set innerHTML(v: string) { this.html = v; },
        get textContent() { return this.html.replace(/<[^>]+>/g, " "); },
      }),
    };
    const win = { getSelection: () => page.selection ?? "", open: (u: string) => { opened = u; } };
    new Function("document", "window", "location", src.slice("javascript:".length))(doc, win, { href: page.href });
    return new URL(opened);
  }

  it("prefers the page's structured JobPosting data", () => {
    const u = run({
      href: "https://www.linkedin.com/jobs/view/1#top",
      ld: { "@type": "JobPosting", title: "Software Engineering Intern", hiringOrganization: { name: "Acme" }, jobLocation: { address: { addressLocality: "San Jose", addressRegion: "CA" } }, description: "<p>Build <b>APIs</b> in Node.js</p>" },
      title: "ignored",
    });
    expect(u.pathname).toBe("/import");
    expect(u.searchParams.get("title")).toBe("Software Engineering Intern");
    expect(u.searchParams.get("company")).toBe("Acme");
    expect(u.searchParams.get("location")).toBe("San Jose, CA");
    expect(u.searchParams.get("description")).toBe("Build APIs in Node.js");
    expect(u.searchParams.get("url")).toBe("https://www.linkedin.com/jobs/view/1"); // fragment dropped
  });

  it("falls back to the heading and uses the student's selection as the description", () => {
    const u = run({ href: "https://sjsu.joinhandshake.com/jobs/9", h1: "Library Student Assistant", selection: "Shelve books. 10 hrs/week.", body: "menu menu menu" });
    expect(u.searchParams.get("title")).toBe("Library Student Assistant");
    expect(u.searchParams.get("description")).toBe("Shelve books. 10 hrs/week.");
  });

  it("keeps the address short enough for any server, however long the page is", () => {
    const u = run({ href: "https://jobs.example.com/x", h1: "Intern", body: "word ".repeat(20000) });
    expect(u.href.length).toBeLessThanOrEqual(7800);
    expect((u.searchParams.get("description") ?? "").length).toBeLessThanOrEqual(CAPTURE_LIMITS.description);
  });
});
