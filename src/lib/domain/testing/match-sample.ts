import type { MatchJob, MatchProfile } from "../match";

/**
 * A deterministic sample of profile × job pairs for property-style tests of the match engine: the same seed always gives
 * the same pairs, so a hash of the engine's output over the sample pins its behavior exactly.
 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const SKILL_SETS = [[], ["java", "sql"], ["java", "sql", "spring", "aws"], ["python", "ml", "pytorch"], ["embedded", "verilog", "fpga"], ["react", "typescript", "nodejs", "sql"]];
const MAJORS = [null, "Computer Science", "Business Administration", "Electrical Engineering", "Data Science", "Computer Engineering"];
const TITLES = ["Software Engineering Intern", "New Grad Software Engineer", "Research Scientist PhD", "Student Assistant", "Embedded Firmware Intern", "Marketing Intern", "Data Analyst Intern"];
const DESCRIPTIONS = ["", "PhD required", "Master's degree required", "3+ years of professional experience", "Great team.", "Security clearance required"];
const REQ_SETS: MatchJob["requirements"][] = [
  [],
  [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "spring", label: "Spring Boot", kind: "required" }, { slug: "aws", label: "AWS", kind: "preferred" }],
  [{ slug: "aws", label: "AWS", kind: "preferred" }, { slug: "react", label: "React", kind: "preferred" }],
  [{ slug: "java", label: "Java", kind: "required" }, { slug: "sql", label: "SQL", kind: "required" }, { slug: "spring", label: "Spring", kind: "required" }, { slug: "kubernetes", label: "Kubernetes", kind: "required" }],
  [{ slug: "python", label: "Python", kind: "required" }],
  [{ slug: null, label: "Strong communication", kind: "required" }, { slug: "embedded", label: "Embedded", kind: "required" }],
];
const PLACES = [
  { lat: 37.3541, lng: -121.9552, city: "Santa Clara" },
  { lat: 37.3352, lng: -121.8811, city: "San Jose" },
  { lat: 40.7128, lng: -74.006, city: "New York" },
  { lat: null, lng: null, city: null },
] as const;

export function sample(n: number, seed = 20260927): { profile: MatchProfile; job: MatchJob }[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const place = pick(r, PLACES);
    const isOnCampus = r() < 0.25;
    const profile: MatchProfile = {
      major: pick(r, MAJORS),
      skills: [...pick(r, SKILL_SETS)],
      origin: { lat: 37.3352, lng: -121.8811 },
      radiusMiles: pick(r, [5, 25, 60]),
      workplace: pick(r, ["any", "remote", "onsite", "hybrid"] as const),
      desiredTitles: pick(r, [[], ["Software Engineering Intern"], ["Data"]]),
    };
    const job: MatchJob = {
      title: pick(r, TITLES),
      employmentType: isOnCampus ? "on_campus" : pick(r, ["internship", "full_time", "part_time", "co_op", "research"] as const),
      category: pick(r, ["Software Engineering", "Embedded", "Product/Technical", "Campus", "AI/ML", null]),
      isOnCampus,
      lat: place.lat, lng: place.lng, city: place.city,
      isRemote: r() < 0.25, isHybrid: r() < 0.2,
      description: pick(r, DESCRIPTIONS),
      requirements: pick(r, REQ_SETS),
    };
    return { profile, job };
  });
}
