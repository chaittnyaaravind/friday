import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { claude, FALLBACK_BETA, friendlyAiError, isAiConfigured, isAiUnavailable, MODEL } from "@/lib/ai/client";
import { answerLocally } from "@/lib/chat/local";
import { searchJobs } from "@/lib/data/jobs";
import { loadProfileItems } from "@/lib/resume/profile";
import { tailorProposal } from "@/lib/resume/tailor";
import { authGuidance, ISSS_NOTICE } from "@/lib/domain/match";
import { createSupabaseServer } from "@/lib/supabase/server";

export const maxDuration = 120;

type Db = Awaited<ReturnType<typeof createSupabaseServer>>;
type Tool = Anthropic.Beta.BetaTool & { schema: z.ZodType; run: (db: Db, userId: string, input: never) => Promise<unknown> };

const def = <S extends z.ZodObject>(name: string, description: string, schema: S, run: (db: Db, userId: string, input: z.infer<S>) => Promise<unknown>): Tool => ({
  name,
  description,
  input_schema: z.toJSONSchema(schema) as Anthropic.Beta.BetaTool.InputSchema,
  eager_input_streaming: true,
  schema,
  run: run as Tool["run"],
});

const TOOLS: Tool[] = [
  def(
    "search_opportunities",
    "Search FRIDAY's verified catalog of SJSU on-campus jobs and Silicon Valley internships, ranked by the user's match. Use for any 'find/show me jobs' request.",
    z.object({
      query: z.string().optional().describe("Keywords, e.g. 'java backend' or a company name"),
      type: z.enum(["internship", "on_campus", "part_time", "full_time", "research", "co_op"]).optional(),
      on_campus: z.boolean().optional(),
      max_miles: z.number().optional().describe("Distance from the user's origin (default SJSU)"),
      posted_within_days: z.number().optional(),
      category: z.string().optional().describe("e.g. 'AI/ML', 'Backend', 'Frontend', 'Embedded', 'QA/SDET'"),
      skill: z.string().optional().describe("Taxonomy slug like 'java', 'react', 'python'"),
      sort: z.enum(["match", "new", "distance", "deadline"]).optional(),
      limit: z.number().max(15).optional(),
    }),
    async (db, _u, i) => {
      const { jobs, total } = await searchJobs(db, {
        q: i.query, types: i.type ? [i.type] : undefined, onCampus: i.on_campus, maxMiles: i.max_miles,
        postedWithinDays: i.posted_within_days, categories: i.category ? [i.category] : undefined,
        skills: i.skill ? [i.skill] : undefined, sort: i.sort, limit: i.limit ?? 8,
      });
      return {
        total,
        results: jobs.map((j) => ({
          id: j.id, link: `/jobs/${j.id}`, title: j.title, company: j.company_name, type: j.employment_type,
          where: j.is_on_campus ? "SJSU Campus" : j.city ?? j.location_text, miles: j.distance_miles, score: j.score,
          strong: j.strong?.map((s) => s.label), missing: j.missing?.map((m) => m.label), pay: j.pay_text, deadline: j.deadline,
          posted: j.posted_at ?? j.discovered_at, source: j.sources[0]?.name,
        })),
      };
    },
  ),
  def("get_opportunity", "Full details for one opportunity: requirements, the user's match explanation, sources and work-authorization notes.", z.object({ job_id: z.string() }), async (db, userId, { job_id }) => {
    const [{ data: job }, { data: m }, { data: p }] = await Promise.all([
      db.from("jobs").select("id, title, description, employment_type, is_on_campus, city, pay_text, hours_text, deadline, apply_url, last_verified_at, companies(name), job_requirements(label, kind), job_sources(source_name, is_official)").eq("id", job_id).maybeSingle(),
      db.from("job_matches").select("score, strong, missing, difficulty, distance_miles").eq("job_id", job_id).eq("user_id", userId).maybeSingle(),
      db.from("profiles").select("work_authorization").eq("id", userId).single(),
    ]);
    if (!job) return { error: "Not found" };
    return {
      ...job, description: job.description?.slice(0, 6000), link: `/jobs/${job.id}`, match: m,
      authorization: authGuidance(p?.work_authorization ?? null, { employmentType: job.employment_type, isOnCampus: job.is_on_campus, description: job.description }),
    };
  }),
  def("list_applications", "The user's tracked applications with status, dates and next follow-up.", z.object({ status: z.string().optional() }), async (db, userId, { status }) => {
    let q = db.from("applications").select("id, company_name, job_title, status, applied_at, follow_up_at, interview_at, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(40);
    if (status) q = q.eq("status", status);
    return (await q).data;
  }),
  def("list_follow_ups", "Open follow-ups and upcoming interviews, soonest first.", z.object({}), async (db, userId) => {
    const [{ data: f }, { data: i }] = await Promise.all([
      db.from("follow_ups").select("due_at, note, applications(company_name, job_title, status)").eq("user_id", userId).is("done_at", null).order("due_at").limit(20),
      db.from("interviews").select("scheduled_at, kind, applications(company_name, job_title)").eq("user_id", userId).gte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(10),
    ]);
    return { follow_ups: f, interviews: i };
  }),
  def("get_profile", "The user's profile: major, graduation year, skills, location preferences, work authorization.", z.object({}), async (db, userId) => {
    const { data } = await db.from("profiles").select("full_name, major, graduation_year, work_authorization, origin_label, radius_miles, workplace, desired_titles, profile_skills(skills(slug, name))").eq("id", userId).single();
    return data;
  }),
  def("skill_gap", "What the user is missing for a specific opportunity, with concrete ways to learn each skill.", z.object({ job_id: z.string() }), async (db, userId, { job_id }) => {
    const { data: m } = await db.from("job_matches").select("missing, strong").eq("job_id", job_id).eq("user_id", userId).maybeSingle();
    return { missing: m?.missing ?? [], already_strong: m?.strong ?? [] };
  }),
  def("tailor_resume", "Compare the user's CONFIRMED profile with one opportunity (no AI): matched skills, missing skills (never added), relevant experience, and a link to review and create the tailored resume.", z.object({ job_id: z.string() }), async (db, userId, { job_id }) => {
    const [items, { data: job }] = await Promise.all([
      loadProfileItems(db, userId),
      db.from("jobs").select("id, title, description, companies(name), job_requirements(label)").eq("id", job_id).maybeSingle(),
    ]);
    if (!job) return { error: "Opportunity not found." };
    if (!items.length) return { error: "Upload a resume on the Resume page first." };
    const p = tailorProposal(items, { id: job.id, title: job.title, company: (job.companies as unknown as { name: string } | null)?.name ?? "", description: job.description ?? "", requirements: ((job.job_requirements as { label: string }[]) ?? []).map((r) => r.label) });
    return { review_and_create_link: `/resume/tailor/${job.id}`, matched: p.skills.filter((s) => s.status === "confirmed").map((s) => s.name), not_in_profile: p.skills.filter((s) => s.status === "not_in_profile").map((s) => s.name), relevant_experience: p.relevant.experience.map((r) => r.label), proposed_changes: p.changes.reorder };
  }),
];

const Body = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40) });

function system(profile: { full_name: string | null; major: string | null; work_authorization: string | null; origin_label: string } | null) {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return `You are FRIDAY, a career agent for San José State University students focused on SJSU on-campus jobs and Silicon Valley CS internships.
Today is ${today}. The user is ${profile?.full_name ?? "an SJSU student"}${profile?.major ? `, ${profile.major}` : ""}. Search origin: ${profile?.origin_label ?? "SJSU Campus"}.

How you work:
- Use tools for anything about jobs, applications, follow-ups, or the user's profile. Never invent listings, companies, pay, deadlines or statuses.
- When you mention an opportunity, link it as [Title — Company](/jobs/<id>).
- Explain matches with the concrete reasons the tools return (strong matches, missing skills). No mystery scores.
- For skill gaps, suggest a specific small project or resource per missing skill.
- You cannot submit applications. Never say an application was submitted; the user marks that themselves.
- Work authorization: share only the informational notes the tools return, never legal advice, never claim CPT/OPT approval. Always include: "${ISSS_NOTICE}" when the topic comes up.
- Be concise and direct. Short paragraphs or tight lists.`;
}

/**
 * Which engine answers: FRIDAY_CHAT_ENGINE = "auto" (default) | "local" | "claude".
 * In auto mode Claude is used when it works; if it's unconfigured or unavailable (no key,
 * no credits, outage) FRIDAY Local answers instead and Claude is skipped for 10 minutes.
 */
const ENGINE = (process.env.FRIDAY_CHAT_ENGINE ?? "auto").toLowerCase();
const RETRY_CLAUDE_MS = 10 * 60_000;
let claudeDownUntil = 0;

const wantsClaude = () => ENGINE !== "local" && isAiConfigured() && (ENGINE === "claude" || Date.now() >= claudeDownUntil);

/** POST /api/chat — FRIDAY assistant, streamed as SSE: `data: {"type":"mode"|"text"|"tool"|"done"|"error", ...}` */
export async function POST(req: Request) {
  let db: Db;
  let userId: string;
  let history: z.infer<typeof Body>["messages"];
  let sys: string;
  try {
    db = await createSupabaseServer();
    const { data } = await db.auth.getUser();
    if (!data.user) return Response.json({ error: "Sign in required" }, { status: 401 });
    userId = data.user.id;
    history = Body.parse(await req.json()).messages;
    const { data: profile } = await db.from("profiles").select("full_name, major, work_authorization, origin_label").eq("id", userId).single();
    sys = system(profile);
  } catch (e) {
    return errorResponse(e);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let sentText = false;
      try {
        if (wantsClaude()) {
          try {
            send({ type: "mode", mode: "claude" });
            await runClaude(db, userId, sys, history, (t) => { sentText = true; send({ type: "text", text: t }); }, (name) => send({ type: "tool", name }));
            send({ type: "done" });
            return;
          } catch (e) {
            // Mid-answer failures are reported; a Claude that can't be reached hands over to Local.
            if (sentText || !isAiUnavailable(e) || ENGINE === "claude") throw e;
            claudeDownUntil = Date.now() + RETRY_CLAUDE_MS;
          }
        }
        send({ type: "mode", mode: "local" });
        const answer = await answerLocally(db, userId, history);
        for (const name of answer.tools) send({ type: "tool", name });
        for (const chunk of answer.text.match(/[^\n]*\n?/g) ?? []) if (chunk) send({ type: "text", text: chunk });
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: friendlyAiError(e) ?? (e instanceof Error ? e.message : "Something went wrong") });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}

/** Claude tool-use loop. Throws before any text if Claude is unreachable. */
async function runClaude(db: Db, userId: string, sys: string, history: z.infer<typeof Body>["messages"], onText: (t: string) => void, onTool: (name: string) => void) {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  for (let turn = 0; turn < 6; turn++) {
    const s = claude().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: sys,
      tools: TOOLS.map(({ name, description, input_schema, eager_input_streaming }) => ({ name, description, input_schema, eager_input_streaming })),
      messages,
    });
    for await (const ev of s) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onText(ev.delta.text);
    }
    const msg = await s.finalMessage();
    if (msg.stop_reason === "refusal") {
      onText("FRIDAY can't help with that request.");
      return;
    }
    // Only run tools on a clean tool_use stop (a max_tokens stop may carry truncated input).
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !calls.length) return;

    messages.push({ role: "assistant", content: msg.content });
    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = TOOLS.find((t) => t.name === c.name);
        onTool(c.name);
        const parsed = tool?.schema.safeParse(c.input);
        if (!tool || !parsed?.success) return { type: "tool_result", tool_use_id: c.id, is_error: true, content: "INVALID_INPUT" };
        try {
          return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(await tool.run(db, userId, parsed.data as never)) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: c.id, is_error: true, content: e instanceof Error ? e.message : "Tool failed" };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
}
