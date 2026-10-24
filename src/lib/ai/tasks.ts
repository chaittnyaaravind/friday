/**
 * Optional AI tasks (job analysis, cover letters) on a free LLM provider (see ./client).
 * Every output is JSON-mode and schema-validated with one repair retry.
 * The resume system does NOT use these — parsing, building and tailoring are local and
 * deterministic (src/lib/resume), so they keep working with no AI at all.
 */
import "server-only";
import { z } from "zod";
import { cached } from "./cache";
import { AiMalformedError, complete } from "./client";
import type { AiTask } from "./routing";
import { styleFor } from "@/lib/writing/style";

/** The JSON object in a model reply: as-is, unfenced, or the first `{` … last `}` if it added prose around it. */
export function extractJson(reply: string): unknown {
  const text = reply.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new SyntaxError("no JSON object");
  }
}

/**
 * JSON completion validated against a zod schema, with one repair retry. Shared by the resume editor.
 * The repair attempt goes to a DIFFERENT provider when one is available: a model that just returned
 * an unreadable answer is the wrong place to ask again.
 */
export async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  task?: AiTask;
}): Promise<z.infer<T>> {
  const system = `${opts.system}\n\nReply with ONE JSON object only, no prose or code fences, matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(opts.schema))}`;
  let feedback = "";
  const skip: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({ task: opts.task, skipProviders: skip, json: true, maxTokens: opts.maxTokens ?? 2048, messages: [{ role: "system", content: system }, { role: "user", content: opts.user + feedback }] });
    skip.push(res.provider);
    try {
      const parsed = opts.schema.safeParse(extractJson(res.content ?? ""));
      if (parsed.success) return parsed.data;
      feedback = `\n\nYour previous reply did not match the schema: ${parsed.error.message.slice(0, 400)}. Return corrected JSON.`;
    } catch {
      feedback = "\n\nYour previous reply was not valid JSON. Return only a valid JSON object.";
    }
  }
  throw new AiMalformedError();
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

/** Cached for 30 minutes per posting: the same description is analyzed once, however many times it's opened. */
export async function analyzeJob(title: string, company: string, description: string): Promise<JobAnalysis> {
  const user = `<title>${title}</title>\n<company>${company}</company>\n<posting>\n${description.slice(0, 40_000)}\n</posting>`;
  return cached({ op: "job-analysis", user }, () => structured({
    schema: JobAnalysis,
    task: "job_matching",
    system:
      "You read job postings for a student career assistant. Extract only what the posting states. Skills must be specific and short (a technology, language, framework, or CS concept) — not soft skills or vague phrases. Do not guess.",
    user,
  }));
}

// ───────────────────────── Cover letter ─────────────────────────

export const CoverLetter = z.object({ letter: z.string(), grounded_in: z.array(z.string()).describe("Resume items the letter relies on") });

export async function writeCoverLetter(resume: unknown, job: { title: string; company: string; description: string }, name: string | null) {
  return structured({
    schema: CoverLetter,
    task: "resume_rewrite",
    system: `You write a concise, specific cover letter for a student applying to the job in <job>. Use only facts from <resume>; the posting tells you what the employer needs, never what the student has done. No invented experience, metrics, availability or enthusiasm.\n\n${styleFor("cover_letter")}`,
    user: `<resume>\n${JSON.stringify(resume)}\n</resume>\n<student_name>${name ?? ""}</student_name>\n<job title="${job.title}" company="${job.company}">\n${job.description.slice(0, 20_000)}\n</job>`,
  });
}

// ───────────────────────── Application answers ─────────────────────────

export const DraftAnswer = z.object({
  answer: z.string().describe("The draft answer, or an empty string when the facts cannot answer the question"),
  grounded_in: z.array(z.string()).describe("The profile facts the answer relies on, quoted"),
  missing: z.string().nullable().describe("What real information the student would need to add to answer well, or null"),
});

/**
 * Draft ONE short application answer from approved profile facts. Callers must have already refused personal declarations
 * (apply/questions.ts) and must check the result for unsupported claims and style before showing it.
 */
export async function draftAnswer(question: string, facts: unknown, job: { title: string; company: string; description: string }) {
  return structured({
    schema: DraftAnswer,
    task: "resume_rewrite",
    maxTokens: 700,
    system: `You draft a short answer to one job-application question for a student, using ONLY the facts in <facts>. The posting in <job> says what the employer needs; it is never evidence about the student. If the facts do not support an answer, return an empty answer and say in "missing" what the student should add. Never state work authorization, availability, schedule, pay expectations, references or anything about the student's legal status, health or identity.\n\n${styleFor("answer")}`,
    user: `<question>${question.slice(0, 500)}</question>\n<facts>\n${JSON.stringify(facts).slice(0, 20_000)}\n</facts>\n<job title="${job.title}" company="${job.company}">\n${job.description.slice(0, 12_000)}\n</job>`,
  });
}
