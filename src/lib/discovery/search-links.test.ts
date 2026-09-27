import { describe, expect, it } from "vitest";
import { searchLinks } from "./search-links";

const base = { query: "software engineer intern", city: "San Jose", radiusMiles: 25 };
const by = (links: ReturnType<typeof searchLinks>, id: string) => new URL(links.find((l) => l.id === id)!.url);

describe("searchLinks", () => {
  it("covers LinkedIn, SJSU Handshake, Indeed, Google Jobs, Glassdoor, Wellfound and the SJSU Career Center", () => {
    expect(searchLinks(base).map((l) => l.id)).toEqual(["linkedin", "handshake", "indeed", "google", "glassdoor", "wellfound", "sjsu"]);
  });

  it("every link is an https address on the site's own domain — nothing is fetched by FRIDAY", () => {
    const hosts = searchLinks(base).map((l) => new URL(l.url).protocol + "//" + new URL(l.url).hostname);
    expect(hosts.every((h) => h.startsWith("https://"))).toBe(true);
    expect(hosts).toEqual(["https://www.linkedin.com", "https://sjsu.joinhandshake.com", "https://www.indeed.com", "https://www.google.com", "https://www.glassdoor.com", "https://wellfound.com", "https://www.sjsu.edu"]);
  });

  it("pre-fills the query, the student's city and their radius", () => {
    const li = by(searchLinks(base), "linkedin");
    expect(li.searchParams.get("keywords")).toBe("software engineer intern");
    expect(li.searchParams.get("location")).toBe("San Jose, CA");
    expect(li.searchParams.get("distance")).toBe("25");
    const ind = by(searchLinks(base), "indeed");
    expect(ind.searchParams.get("l")).toBe("San Jose, CA");
    expect(ind.searchParams.get("radius")).toBe("25");
    expect(by(searchLinks(base), "handshake").searchParams.get("query")).toBe("software engineer intern");
  });

  it("adds the internship and last-24-hours filters only when asked", () => {
    const off = by(searchLinks(base), "linkedin");
    expect(off.searchParams.has("f_JT")).toBe(false);
    expect(off.searchParams.has("f_TPR")).toBe(false);
    const on = searchLinks({ ...base, internship: true, lastDay: true });
    expect(by(on, "linkedin").searchParams.get("f_JT")).toBe("I");
    expect(by(on, "linkedin").searchParams.get("f_TPR")).toBe("r86400");
    expect(by(on, "indeed").searchParams.get("jt")).toBe("internship");
    expect(by(on, "indeed").searchParams.get("fromage")).toBe("1");
  });

  it("falls back to a sensible default when the query is blank", () => {
    expect(by(searchLinks({ ...base, query: "   " }), "linkedin").searchParams.get("keywords")).toBe("software engineer intern");
    expect(by(searchLinks({ ...base, query: undefined }), "indeed").searchParams.get("q")).toBe("software engineer intern");
  });

  it("keeps the radius in a sane range", () => {
    expect(by(searchLinks({ ...base, radiusMiles: 1 }), "linkedin").searchParams.get("distance")).toBe("5");
    expect(by(searchLinks({ ...base, radiusMiles: 500 }), "linkedin").searchParams.get("distance")).toBe("100");
  });

  it("encodes hostile input instead of letting it break out of the address", () => {
    const evil = searchLinks({ ...base, query: 'x&f_JT=I#"><script>alert(1)</script>', city: "San Jose&evil=1" });
    for (const l of evil) {
      const u = new URL(l.url);
      expect(u.hash).toBe("");
      expect(l.url).not.toMatch(/<script>|"/);
    }
    expect(by(evil, "linkedin").searchParams.get("keywords")).toBe('x&f_JT=I#"><script>alert(1)</script>');
    expect(by(evil, "linkedin").searchParams.has("evil")).toBe(false);
  });
});
