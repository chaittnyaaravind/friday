/**
 * Optional Claude tasks (job analysis, cover letters). Every output is schema-validated.
 * The resume system does NOT use these — parsing, building and tailoring are local and
 * deterministic (src/lib/resume), so they keep working with zero API credits.
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

// ───────────────────────── Cover letter ─────────────────────────

export const CoverLetter = z.object({ letter: z.string(), grounded_in: z.array(z.string()).describe("Resume items the letter relies on") });

export async function writeCoverLetter(resume: unknown, job: { title: string; company: string; description: string }, name: string | null) {
  return structured({
    schema: CoverLetter,
    effort: "medium",
    system:
      "You write a concise, specific cover letter (under 280 words) for a student. Use only facts from <resume>. No invented experience, metrics, or enthusiasm clichés ('I am thrilled', 'passionate'). Plain, confident, human. Sign with the student's name if provided.",
    user: `<resume>\n${JSON.stringify(resume)}\n</resume>\n<student_name>${name ?? ""}</student_name>\n<job title="${job.title}" company="${job.company}">\n${job.description.slice(0, 20_000)}\n</job>`,
  });
}
