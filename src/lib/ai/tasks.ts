/**
 * Structured Claude tasks. Every output is schema-validated, and tailoring output is
 * additionally checked against the user's own resume so nothing can be invented:
 * skills, employers, titles, projects and schools that aren't in the source are dropped.
 */
import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { AiRefusalError, claude, FALLBACK_BETA, MODEL } from "./client";

async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const res = await claude().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (res.stop_reason === "refusal") throw new AiRefusalError(res.stop_details?.category ?? null);
  if (!res.parsed_output) throw new Error(res.stop_reason === "max_tokens" ? "Claude's answer was cut off — try a shorter document." : "Claude returned an unreadable answer.");
  return res.parsed_output as z.infer<T>;
}

// ───────────────────────── Resume parsing ─────────────────────────

export const ParsedResume = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  summary: z.string().nullable(),
  education: z.array(z.object({ school: z.string(), degree: z.string().nullable(), field: z.string().nullable(), start: z.string().nullable(), end: z.string().nullable(), gpa: z.string().nullable(), details: z.array(z.string()) })),
  experience: z.array(z.object({ title: z.string(), organization: z.string(), location: z.string().nullable(), start: z.string().nullable(), end: z.string().nullable(), bullets: z.array(z.string()) })),
  projects: z.array(z.object({ name: z.string(), technologies: z.array(z.string()), link: z.string().nullable(), bullets: z.array(z.string()) })),
  skills: z.array(z.string()),
  certifications: z.array(z.string()),
  awards: z.array(z.string()),
});
export type ParsedResume = z.infer<typeof ParsedResume>;

export async function parseResume(rawText: string): Promise<ParsedResume> {
  return structured({
    schema: ParsedResume,
    effort: "low",
    system:
      "You extract structured data from a student's resume. Copy facts exactly as written. Never infer, embellish, or add anything that is not literally present. Use null for missing fields and empty arrays for missing sections. `skills` lists every technology, language, framework and tool named anywhere in the resume (including inside bullets and project tech stacks), each once, using its common name.",
    user: `<resume>\n${rawText}\n</resume>`,
  });
}

// ───────────────────────── Job analysis ─────────────────────────

export const JobAnalysis = z.object({
  required: z.array(z.string()).describe("Concrete required skills/technologies/knowledge, short names (e.g. 'Java', 'REST APIs', 'Data Structures')"),
  preferred: z.array(z.string()).describe("Nice-to-have skills, short names"),
  degree: z.string().nullable().describe("Degree/enrollment requirement as stated, or null"),
  graduation_window: z.string().nullable(),
  experience_level: z.enum(["student", "new_grad", "experienced", "unknown"]),
  work_authorization_note: z.string().nullable().describe("Any citizenship, clearance or sponsorship statement quoted from the posting, or null"),
  summary: z.string().describe("Two plain sentences: what the role does and who it is for"),
});
export type JobAnalysis = z.infer<typeof JobAnalysis>;

export async function analyzeJob(title: string, company: string, description: string): Promise<JobAnalysis> {
  return structured({
    schema: JobAnalysis,
    effort: "low",
    system:
      "You read job postings for a student career assistant. Extract only what the posting states. Skills must be specific and short (a technology, language, framework, or CS concept) — not soft skills or vague phrases. Do not guess.",
    user: `<title>${title}</title>\n<company>${company}</company>\n<posting>\n${description.slice(0, 40_000)}\n</posting>`,
  });
}

// ───────────────────────── Tailoring (no fabrication) ─────────────────────────

export const TailoredResume = z.object({
  summary: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(z.object({ title: z.string(), organization: z.string(), start: z.string().nullable(), end: z.string().nullable(), bullets: z.array(z.string()) })),
  projects: z.array(z.object({ name: z.string(), technologies: z.array(z.string()), bullets: z.array(z.string()) })),
  education: z.array(z.object({ school: z.string(), degree: z.string().nullable(), field: z.string().nullable(), end: z.string().nullable(), gpa: z.string().nullable() })),
  changes: z.array(z.object({ what: z.string(), why: z.string() })),
  suggestions: z.array(z.string()).describe("Honest ways to close gaps (e.g. build a small project) — never claims to add to the resume"),
});
export type TailoredResume = z.infer<typeof TailoredResume>;

const TAILOR_SYSTEM = `You tailor a student's resume to one job posting.

Hard rules — breaking any of these is a failure:
- Use ONLY facts present in <resume>. Never invent jobs, internships, degrees, skills, projects, certifications, metrics, dates, or achievements.
- You may reorder sections and bullets, choose which items to include, tighten wording, and mirror the posting's terminology ONLY where the resume already shows that exact skill or experience.
- Every bullet must be traceable to a bullet in the resume. Do not add numbers or outcomes that are not there.
- \`skills\` must be a subset of skills in the resume, ordered by relevance to the posting.
- If the posting asks for something the resume lacks, do not add it — list an honest way to build it in \`suggestions\`.
- \`changes\` explains each meaningful edit in one short line.`;

export async function tailorResume(resume: ParsedResume, job: { title: string; company: string; description: string }): Promise<TailoredResume> {
  const draft = await structured({
    schema: TailoredResume,
    effort: "high",
    system: TAILOR_SYSTEM,
    user: `<resume>\n${JSON.stringify(resume)}\n</resume>\n<job title="${job.title}" company="${job.company}">\n${job.description.slice(0, 30_000)}\n</job>`,
  });
  return enforceNoFabrication(resume, draft);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

/** Deterministic guard: drop anything the model returned that isn't in the source resume. */
export function enforceNoFabrication(src: ParsedResume, out: TailoredResume): TailoredResume {
  const srcText = norm(JSON.stringify(src));
  const srcSkills = new Set([...src.skills, ...src.projects.flatMap((p) => p.technologies)].map(norm));
  const orgs = new Set(src.experience.map((e) => norm(e.organization)));
  const titles = new Set(src.experience.map((e) => norm(e.title)));
  const projects = new Set(src.projects.map((p) => norm(p.name)));
  const schools = new Set(src.education.map((e) => norm(e.school)));
  const dropped: string[] = [];

  const skills = out.skills.filter((s) => (srcSkills.has(norm(s)) || srcText.includes(norm(s)) ? true : (dropped.push(`skill "${s}"`), false)));
  const experience = out.experience.filter((e) =>
    orgs.has(norm(e.organization)) && titles.has(norm(e.title)) ? true : (dropped.push(`role "${e.title} @ ${e.organization}"`), false),
  );
  const projectsOut = out.projects
    .filter((p) => (projects.has(norm(p.name)) ? true : (dropped.push(`project "${p.name}"`), false)))
    .map((p) => ({ ...p, technologies: p.technologies.filter((t) => srcSkills.has(norm(t)) || srcText.includes(norm(t))) }));
  const education = out.education.filter((e) => (schools.has(norm(e.school)) ? true : (dropped.push(`school "${e.school}"`), false)));

  return {
    ...out,
    skills,
    experience,
    projects: projectsOut,
    education,
    changes: dropped.length ? [...out.changes, { what: `Removed ${dropped.join(", ")}`, why: "Not found in your original resume — FRIDAY never adds experience you didn't provide." }] : out.changes,
  };
}

// ───────────────────────── Cover letter ─────────────────────────

export const CoverLetter = z.object({ letter: z.string(), grounded_in: z.array(z.string()).describe("Resume items the letter relies on") });

export async function writeCoverLetter(resume: ParsedResume, job: { title: string; company: string; description: string }, name: string | null) {
  return structured({
    schema: CoverLetter,
    effort: "medium",
    system:
      "You write a concise, specific cover letter (under 280 words) for a student. Use only facts from <resume>. No invented experience, metrics, or enthusiasm clichés ('I am thrilled', 'passionate'). Plain, confident, human. Sign with the student's name if provided.",
    user: `<resume>\n${JSON.stringify(resume)}\n</resume>\n<student_name>${name ?? ""}</student_name>\n<job title="${job.title}" company="${job.company}">\n${job.description.slice(0, 20_000)}\n</job>`,
  });
}
