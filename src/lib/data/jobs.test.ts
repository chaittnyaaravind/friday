import { describe, expect, it } from "vitest";
import { invalidFilterParams, parseFilters } from "./jobs";

const sp = (q: string) => new URLSearchParams(q);
const parse = (q: string) => parseFilters(sp(q));

describe("parseFilters — the unified search API", () => {
  it("reads keyword, type, radius, remote, source, recency, sort and pagination", () => {
    expect(parse("q=software%20engineering&type=internship,co_op&miles=25&remote=1&source=adzuna&posted=7&sort=new&limit=20&offset=40")).toMatchObject({
      q: "software engineering", types: ["internship", "co_op"], maxMiles: 25, remoteOnly: true, sources: ["adzuna"], postedWithinDays: 7, sort: "new", limit: 20, offset: 40,
    });
  });
  it("supports the API's friendlier names: internshipsOnly, radius, provider, postedWithin", () => {
    expect(parse("internshipsOnly=true&radius=50&provider=adzuna&postedWithin=24h")).toMatchObject({ types: ["internship", "co_op"], maxMiles: 50, sources: ["adzuna"], postedWithinDays: 1 });
    expect(parse("postedWithin=3d").postedWithinDays).toBe(3);
    expect(parse("postedWithin=30d").postedWithinDays).toBe(30);
  });
  it("an explicit type wins over internshipsOnly", () => {
    expect(parse("type=full_time&internshipsOnly=true").types).toEqual(["full_time"]);
  });
  it("new-grad and entry-level filters", () => {
    expect(parse("level=new_grad,entry").levels).toEqual(["new_grad", "entry"]);
    expect(parse("level=senior").levels).toBeUndefined();
  });
  it("page + limit become an offset", () => {
    expect(parse("page=3&limit=20").offset).toBe(40);
    expect(parse("page=1&limit=20").offset).toBe(0);
    expect(parse("page=2").offset).toBe(30); // default page size
    expect(parse("offset=7&page=9&limit=10").offset).toBe(7); // an explicit offset wins
  });
  it("clamps numbers into a safe range", () => {
    expect(parse("limit=9999").limit).toBe(100);
    expect(parse("limit=0").limit).toBe(1);
    expect(parse("miles=100000").maxMiles).toBe(500);
    expect(parse("posted=99999").postedWithinDays).toBe(365);
  });
  it("drops values it cannot use instead of passing them to the database", () => {
    const f = parse("type=bogus,internship&source=evil;drop&sort=hackme&level=x");
    expect(f.types).toEqual(["internship"]);
    expect(f.sources).toBeUndefined();
    expect(f.sort).toBeUndefined();
    expect(f.levels).toBeUndefined();
  });
  it("caps the keyword length and works with Next.js page search params too", () => {
    expect(parse(`q=${"a".repeat(500)}`).q).toHaveLength(200);
    expect(parseFilters({ q: "python", type: ["internship", "co_op"], posted: "7" })).toMatchObject({ q: "python", types: ["internship", "co_op"], postedWithinDays: 7 });
  });
  it("defaults are unchanged: nothing requested means nothing filtered", () => {
    expect(parse("")).toMatchObject({ q: undefined, types: undefined, sources: undefined, sort: undefined, includeRemote: true });
  });
});

describe("invalidFilterParams — a 400 that names the problem", () => {
  it("accepts every valid request", () => {
    expect(invalidFilterParams(sp("q=x&type=internship&level=entry&source=adzuna&provider=greenhouse&sort=distance&postedWithin=7d&miles=10&limit=50&page=2&offset=0"))).toEqual([]);
    expect(invalidFilterParams(sp(""))).toEqual([]);
  });
  it("names each unusable parameter", () => {
    expect(invalidFilterParams(sp("type=bogus"))).toEqual(["type"]);
    expect(invalidFilterParams(sp("source=nope"))).toEqual(["source"]);
    expect(invalidFilterParams(sp("level=guru"))).toEqual(["level"]);
    expect(invalidFilterParams(sp("sort=random"))).toEqual(["sort"]);
    expect(invalidFilterParams(sp("postedWithin=2w"))).toEqual(["postedWithin"]);
    expect(invalidFilterParams(sp("miles=abc&limit=-5&page=x"))).toEqual(["miles", "limit", "page"]);
    expect(invalidFilterParams(sp(`q=${"a".repeat(201)}`))).toEqual(["q"]);
  });
  it("catches injection-shaped values before they reach the database", () => {
    expect(invalidFilterParams(sp("type=internship'; drop table jobs;--"))).toEqual(["type"]);
    expect(invalidFilterParams(sp("source=adzuna,evil"))).toEqual(["source"]);
  });
});
