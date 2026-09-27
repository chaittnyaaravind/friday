/**
 * Where a student is searching. Derived from the profile FRIDAY already stores (origin_label, origin_lat/lng,
 * radius_miles, workplace) — not a second source of truth. SJSU campus resolves to San Jose.
 */
import { BAY_AREA_CITIES } from "./geo";

export type SearchArea = {
  city: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
  radiusMiles: number;
  /** Whether the student wants remote roles included. */
  remote: boolean;
};

export type ProfileLocation = {
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  radius_miles: number | null;
  workplace: string | null;
};

/** Used only when nothing about the student's location is known (a fresh install with no profiles). */
export const FALLBACK_AREA: SearchArea = { city: "San Jose", state: "CA", country: "US", lat: 37.3382, lng: -121.8863, radiusMiles: 25, remote: true };

const clampRadius = (n: number | null | undefined) => Math.max(5, Math.min(100, Math.round(n ?? FALLBACK_AREA.radiusMiles)));

export function areaFromProfile(p: Partial<ProfileLocation> | null | undefined): SearchArea {
  const label = (p?.origin_label ?? "").trim();
  const city = !label || /sjsu|san jos/i.test(label) ? "San Jose" : label;
  // Every supported origin is SJSU or a Bay Area city, so the state is California; nothing else is inferred.
  const known = /san jose/i.test(city) || BAY_AREA_CITIES.some((c) => c.name.toLowerCase() === city.toLowerCase());
  return {
    city,
    state: known ? "CA" : "",
    country: "US",
    lat: p?.origin_lat ?? (city === "San Jose" ? FALLBACK_AREA.lat : null),
    lng: p?.origin_lng ?? (city === "San Jose" ? FALLBACK_AREA.lng : null),
    radiusMiles: clampRadius(p?.radius_miles),
    remote: (p?.workplace ?? "any") !== "onsite",
  };
}

/**
 * The distinct areas worth querying a provider for, most-populated first: one per city (widest radius wins),
 * capped so a growing user base cannot multiply API calls.
 */
export function areasFromProfiles(rows: Partial<ProfileLocation>[], max = 3): SearchArea[] {
  const byCity = new Map<string, { area: SearchArea; users: number }>();
  for (const r of rows) {
    const a = areaFromProfile(r);
    const key = a.city.toLowerCase();
    const cur = byCity.get(key);
    if (!cur) byCity.set(key, { area: a, users: 1 });
    else {
      cur.users++;
      cur.area = { ...cur.area, radiusMiles: Math.max(cur.area.radiusMiles, a.radiusMiles), remote: cur.area.remote || a.remote };
    }
  }
  const out = [...byCity.values()].sort((x, y) => y.users - x.users || x.area.city.localeCompare(y.area.city)).slice(0, max).map((v) => v.area);
  return out.length ? out : [FALLBACK_AREA];
}

export const milesToKm = (miles: number) => Math.round(miles * 1.609344);

/** "San Jose, CA" — the form both people and provider APIs expect. */
export const areaLabel = (a: Pick<SearchArea, "city" | "state">) => (a.state ? `${a.city}, ${a.state}` : a.city);
