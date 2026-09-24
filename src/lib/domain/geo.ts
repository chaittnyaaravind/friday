/**
 * Location intelligence. Job locations arrive as free text ("San Jose, CA",
 * "USA, CA, Santa Clara", "Remote - US", "2 Locations"). We resolve them against a
 * table of Bay Area cities so distance can be computed locally — the user's origin
 * never leaves our server.
 */
export type City = { name: string; lat: number; lng: number; rank: number };

export const SJSU = { label: "SJSU Campus", lat: 37.3352, lng: -121.8811 };

// rank = spec priority (1 = San Jose). Unranked Bay Area cities get 20.
export const BAY_AREA_CITIES: City[] = [
  { name: "San Jose", lat: 37.3382, lng: -121.8863, rank: 1 },
  { name: "Santa Clara", lat: 37.3541, lng: -121.9552, rank: 2 },
  { name: "Sunnyvale", lat: 37.3688, lng: -122.0363, rank: 3 },
  { name: "Mountain View", lat: 37.3861, lng: -122.0839, rank: 4 },
  { name: "Cupertino", lat: 37.323, lng: -122.0322, rank: 5 },
  { name: "Milpitas", lat: 37.4323, lng: -121.8996, rank: 6 },
  { name: "Fremont", lat: 37.5485, lng: -121.9886, rank: 7 },
  { name: "Palo Alto", lat: 37.4419, lng: -122.143, rank: 8 },
  { name: "Menlo Park", lat: 37.453, lng: -122.1817, rank: 9 },
  { name: "Campbell", lat: 37.2872, lng: -121.95, rank: 10 },
  { name: "Los Gatos", lat: 37.2358, lng: -121.9624, rank: 11 },
  { name: "Saratoga", lat: 37.2638, lng: -122.023, rank: 12 },
  { name: "Los Altos", lat: 37.3852, lng: -122.1141, rank: 12 },
  { name: "Morgan Hill", lat: 37.1305, lng: -121.6544, rank: 13 },
  { name: "Newark", lat: 37.5297, lng: -122.0402, rank: 13 },
  { name: "Redwood City", lat: 37.4852, lng: -122.2364, rank: 14 },
  { name: "San Carlos", lat: 37.5072, lng: -122.2605, rank: 15 },
  { name: "Belmont", lat: 37.5202, lng: -122.2758, rank: 15 },
  { name: "Foster City", lat: 37.5585, lng: -122.2711, rank: 15 },
  { name: "San Mateo", lat: 37.563, lng: -122.3255, rank: 16 },
  { name: "Burlingame", lat: 37.5779, lng: -122.3481, rank: 17 },
  { name: "San Bruno", lat: 37.6305, lng: -122.4111, rank: 18 },
  { name: "South San Francisco", lat: 37.6547, lng: -122.4077, rank: 18 },
  { name: "Hayward", lat: 37.6688, lng: -122.0808, rank: 18 },
  { name: "Union City", lat: 37.5934, lng: -122.0439, rank: 18 },
  { name: "Pleasanton", lat: 37.6624, lng: -121.8747, rank: 18 },
  { name: "Dublin", lat: 37.7022, lng: -121.9358, rank: 19 },
  { name: "Livermore", lat: 37.6819, lng: -121.768, rank: 19 },
  { name: "San Ramon", lat: 37.7799, lng: -121.978, rank: 19 },
  { name: "Walnut Creek", lat: 37.9101, lng: -122.0652, rank: 20 },
  { name: "Oakland", lat: 37.8044, lng: -122.2712, rank: 20 },
  { name: "Emeryville", lat: 37.8313, lng: -122.2852, rank: 20 },
  { name: "Berkeley", lat: 37.8715, lng: -122.273, rank: 20 },
  { name: "San Francisco", lat: 37.7749, lng: -122.4194, rank: 20 },
  { name: "Scotts Valley", lat: 37.0511, lng: -122.0147, rank: 21 },
  { name: "Santa Cruz", lat: 36.9741, lng: -122.0308, rank: 21 },
  { name: "Gilroy", lat: 37.0058, lng: -121.5683, rank: 21 },
];

const CITY_ALIASES: Record<string, string> = {
  "san josé": "San Jose", sj: "San Jose", "sf": "San Francisco", "s.f.": "San Francisco",
  "bay area": "San Jose", "silicon valley": "San Jose", "south bay": "San Jose",
  "mtv": "Mountain View", "sunnyvale campus": "Sunnyvale", "ssf": "South San Francisco",
};

export type ResolvedLocation = {
  city: string | null;
  lat: number | null;
  lng: number | null;
  isRemote: boolean;
  isHybrid: boolean;
  inBayArea: boolean;
  inUS: boolean;
};

const US_HINT = /\b(?:ca|california|usa|u\.s\.|united states|us|wa|washington|ny|new york|tx|texas|ma|or|co|il|ga|nc|va|az|ut|remote\s*[-–(]?\s*us)\b/i;
const NON_US = /\b(?:india|bangalore|bengaluru|hyderabad|pune|chennai|china|shanghai|beijing|shenzhen|taiwan|taipei|hsinchu|japan|tokyo|korea|seoul|singapore|israel|tel aviv|yokneam|ireland|dublin, ireland|cork|uk|united kingdom|london|germany|berlin|munich|france|paris|canada|toronto|vancouver|mexico|brazil|poland|romania|vietnam|malaysia|philippines|costa rica|netherlands|amsterdam|spain|italy|australia|sydney)\b/i;

export function resolveLocation(text: string | null | undefined): ResolvedLocation {
  const raw = (text ?? "").trim();
  const t = raw.toLowerCase();
  const isRemote = /\bremote\b|\banywhere\b|work from home|\bwfh\b/.test(t);
  const isHybrid = /\bhybrid\b/.test(t);

  let match: City | undefined;
  for (const [alias, name] of Object.entries(CITY_ALIASES)) {
    if (new RegExp(`\\b${alias.replace(/\./g, "\\.")}\\b`).test(t)) match = BAY_AREA_CITIES.find((c) => c.name === name);
  }
  // Prefer the highest-priority (lowest rank) city when several are listed.
  for (const c of BAY_AREA_CITIES) {
    if (new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(t.replace(/josé/g, "jose")) && (!match || c.rank < match.rank)) match = c;
  }
  // "Dublin" is ambiguous — only the Bay Area one if CA context exists.
  if (match?.name === "Dublin" && !/\bca\b|california/.test(t)) match = undefined;

  const nonUS = NON_US.test(t) && !match;
  return {
    city: match?.name ?? null,
    lat: match?.lat ?? null,
    lng: match?.lng ?? null,
    isRemote,
    isHybrid,
    inBayArea: Boolean(match),
    inUS: Boolean(match) || (!nonUS && (US_HINT.test(raw) || isRemote)),
  };
}

/** Great-circle distance in miles. */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const RADIUS_PRESETS = [
  { label: "Within 5 miles", miles: 5 },
  { label: "Within 10 miles", miles: 10 },
  { label: "Within 25 miles", miles: 25 },
  { label: "Anywhere in Silicon Valley", miles: 45 },
] as const;
