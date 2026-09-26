/**
 * Deterministic requirement extraction from a job description. Splits the text into
 * "required" and "preferred" sections by their headings, then maps each section to
 * taxonomy skills. the AI can refine this later (POST /api/agent/analyze-job), but
 * the feed never waits on a model call.
 */
import { extractSkills } from "./skills";

export type ExtractedRequirement = { slug: string; kind: "required" | "preferred" };

const PREFERRED_HEAD = /^\s*(?:[•*\-–]\s*)?(?:preferred|bonus|nice[- ]to[- ]haves?|pluses|plus if|it'?s a plus|desired|additional|ideal(?:ly)?|what would make you stand out|you might also have|extra credit)\b.*$/i;
const REQUIRED_HEAD = /^\s*(?:[•*\-–]\s*)?(?:(?:minimum|basic|required|key)\s+(?:qualifications|requirements)|requirements|qualifications|what you(?:'ll)? (?:need|bring)|who you are|you (?:have|should have|will need)|about you|must[- ]haves?|skills)\b.*$/i;
const OTHER_HEAD = /^\s*(?:about (?:us|the (?:team|company|role))|what you(?:'ll)? do|responsibilities|benefits|perks|compensation|pay|salary|equal opportunity|our (?:mission|culture)|the role|why join|how we work|location)\b.*$/i;

type Section = "required" | "preferred" | "other" | "none";

export function extractRequirements(description: string, maxRequired = 10): ExtractedRequirement[] {
  if (!description) return [];
  const lines = description.split(/\n+/);
  const buckets: Record<Section, string[]> = { required: [], preferred: [], other: [], none: [] };
  let section: Section = "none";
  for (const line of lines) {
    const short = line.trim().length < 80;
    if (short && PREFERRED_HEAD.test(line)) section = "preferred";
    else if (short && REQUIRED_HEAD.test(line)) section = "required";
    else if (short && OTHER_HEAD.test(line)) section = "other";
    buckets[section].push(line);
    // inline cues inside a single bullet
    if (section !== "preferred" && /\b(?:preferred|a plus|nice to have|bonus)\b/i.test(line)) buckets.preferred.push(line);
  }

  const required = new Set(extractSkills(buckets.required.join("\n")));
  const preferred = new Set(extractSkills(buckets.preferred.join("\n")));
  // Bullet-level "preferred/plus" cue wins over the section it sits in.
  for (const s of preferred) required.delete(s);

  // No structured sections: fall back to the whole text (minus boilerplate) as required.
  if (required.size === 0 && preferred.size === 0) {
    for (const s of extractSkills([...buckets.none, ...buckets.other].join("\n"))) required.add(s);
  }

  const out: ExtractedRequirement[] = [...required].slice(0, maxRequired).map((slug) => ({ slug, kind: "required" as const }));
  for (const slug of preferred) if (!required.has(slug)) out.push({ slug, kind: "preferred" });
  return out.slice(0, maxRequired + 8);
}
