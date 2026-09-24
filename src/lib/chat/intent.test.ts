import { describe, expect, it } from "vitest";
import { discoverHref, keywords, parseIntent } from "./intent";

const companies = [{ slug: "cisco", name: "Cisco" }, { slug: "adobe", name: "Adobe" }, { slug: "hp", name: "HP" }];

describe("local chat intent", () => {
  it("SJSU jobs posted this week → on-campus, 7 days", () => {
    const i = parseIntent("Find me SJSU jobs posted this week.", companies);
    expect(i.kind).toBe("search");
    expect(i.filters).toMatchObject({ onCampus: true, postedWithinDays: 7 });
  });

  it("CS internships within 10 miles → internship types, 10 mi, no remote", () => {
    const i = parseIntent("Find CS internships within 10 miles.", companies);
    expect(i.filters).toMatchObject({ types: ["internship", "co_op"], maxMiles: 10, includeRemote: false });
  });

  it("'near SJSU' is a location, not on-campus", () => {
    expect(parseIntent("internships near SJSU").filters.onCampus).toBeUndefined();
  });

  it("skills and categories are detected", () => {
    const i = parseIntent("Which backend internships match my Java skills?", companies);
    expect(i.filters.skills).toContain("java");
    expect(i.filters.categories).toContain("Backend");
  });

  it("companies are matched as whole words", () => {
    expect(parseIntent("internships at Cisco", companies).filters.companies).toEqual(["cisco"]);
    expect(parseIntent("I want to chip in", companies).filters.companies).toBeUndefined();
  });

  it("routes the common questions", () => {
    const k = (t: string) => parseIntent(t, companies).kind;
    expect(k("hi")).toBe("greeting");
    expect(k("what can you do?")).toBe("help");
    expect(k("What should I learn to qualify for my top match?")).toBe("skill_gap");
    expect(k("Which applications need follow-up?")).toBe("follow_ups");
    expect(k("show my applications")).toBe("applications");
    expect(k("Show me companies hiring CS interns around San Jose.")).toBe("companies");
    expect(k("tailor my resume for Cisco")).toBe("tailor");
    expect(k("what's my resume status")).toBe("resume");
    expect(k("can I work off campus on F-1 with CPT?")).toBe("work_auth");
    expect(k("internship deadlines this month")).toBe("deadlines");
  });

  it("keyword fallback strips filler words", () => {
    expect(keywords("find me golang jobs please")).toBe("golang");
  });

  it("builds a Discover link with the same filters", () => {
    expect(discoverHref(parseIntent("SJSU jobs posted this week").filters)).toBe("/discover?campus=1&posted=7");
  });
});
