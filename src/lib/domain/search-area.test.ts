import { describe, expect, it } from "vitest";
import { areaFromProfile, areaLabel, areasFromProfiles, FALLBACK_AREA, milesToKm } from "./search-area";

const p = (o: Record<string, unknown> = {}) => ({ origin_label: "SJSU Campus", origin_lat: 37.3352, origin_lng: -121.8811, radius_miles: 25, workplace: "any", ...o });

describe("areaFromProfile — uses the profile FRIDAY already stores", () => {
  it("SJSU campus resolves to San Jose, CA with the student's own coordinates and radius", () => {
    expect(areaFromProfile(p())).toEqual({ city: "San Jose", state: "CA", country: "US", lat: 37.3352, lng: -121.8811, radiusMiles: 25, remote: true });
  });
  it("another Bay Area origin is used as-is (no San Jose hard-coding)", () => {
    const a = areaFromProfile(p({ origin_label: "Palo Alto", origin_lat: 37.44, origin_lng: -122.14, radius_miles: 10 }));
    expect(a).toMatchObject({ city: "Palo Alto", state: "CA", lat: 37.44, radiusMiles: 10 });
    expect(areaLabel(a)).toBe("Palo Alto, CA");
  });
  it("an onsite-only student does not get remote searches", () => {
    expect(areaFromProfile(p({ workplace: "onsite" })).remote).toBe(false);
    expect(areaFromProfile(p({ workplace: "remote" })).remote).toBe(true);
  });
  it("keeps the radius in a sane range and tolerates a missing profile", () => {
    expect(areaFromProfile(p({ radius_miles: 1 })).radiusMiles).toBe(5);
    expect(areaFromProfile(p({ radius_miles: 900 })).radiusMiles).toBe(100);
    expect(areaFromProfile(null)).toMatchObject({ city: "San Jose", radiusMiles: 25 });
  });
  it("does not invent a state for an unknown place", () => {
    const a = areaFromProfile(p({ origin_label: "Nowhereville", origin_lat: null, origin_lng: null }));
    expect(a.state).toBe("");
    expect(a.lat).toBeNull();
    expect(areaLabel(a)).toBe("Nowhereville");
  });
});

describe("areasFromProfiles — bounded, distinct provider queries", () => {
  it("one area per city, widest radius wins, most students first", () => {
    const areas = areasFromProfiles([p(), p({ radius_miles: 50 }), p({ origin_label: "Palo Alto", radius_miles: 10 }), p({ origin_label: "Sunnyvale" }), p({ origin_label: "Oakland" })], 2);
    expect(areas.map((a) => a.city)).toEqual(["San Jose", "Oakland"]);
    expect(areas[0].radiusMiles).toBe(50);
  });
  it("caps the number of areas so growth cannot multiply API calls", () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((c) => p({ origin_label: `City${c}` }));
    expect(areasFromProfiles(many, 3)).toHaveLength(3);
  });
  it("falls back to one default area only when no profile is known", () => {
    expect(areasFromProfiles([])).toEqual([FALLBACK_AREA]);
  });
});

describe("milesToKm", () => {
  it("converts for APIs that take kilometres", () => {
    expect(milesToKm(25)).toBe(40);
    expect(milesToKm(10)).toBe(16);
  });
});
