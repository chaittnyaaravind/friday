import { takeAiQuota } from "@/lib/ai/quota";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { complete, friendlyAiError, isAiConfigured, isAiUnavailable, type ChatMessage, type ToolSpec } from "@/lib/ai/client";
import { answerLocally } from "@/lib/chat/local";
import { searchJobs } from "@/lib/data/jobs";
import { loadProfileItems } from "@/lib/resume/profile";
import { tailorProposal } from "@/lib/resume/tailor";
import { authGuidance, ISSS_NOTICE } from "@/lib/domain/match";
import { createSupabaseServer } from "@/lib/supabase/server";

export const maxDuration = 120;

type Db = Awaited<ReturnType<typeof createSupabaseServer>>;
type Tool = { name: string; description: string; input_schema: unknown; schema: z.ZodType; run: (db: Db, userId: string, input: never) => Promise<unknown> };

const def = <S extends z.ZodObject>(name: string, description: string, schema: S, run: (db: Db, userId: string, input: z.infer<S>) => Promise<unknown>): Tool => ({
  name,
  description,
  input_schema: z.toJSONSchema(schema),
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
      db.from("follow_ups").select("due_at, note, applications!follow_ups_parent_owner_fk(company_name, job_title, status)").eq("user_id", userId).is("done_at", null).order("due_at").limit(20),
      db.from("interviews").select("scheduled_at, kind, applications!interviews_parent_owner_fk(company_name, job_title)").eq("user_id", userId).gte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(10),
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
 * Which engine answers: FRIDAY_CHAT_ENGINE = "auto" (default) | "local" | "ai".
 * In auto mode the free LLM provider (see lib/ai/client) is used when it works; if it's
 * unconfigured or unavailable (no key, rate limit, outage) FRIDAY Local answers instead and
 * the provider is skipped for 10 minutes.
 */
const ENGINE = (process.env.FRIDAY_CHAT_ENGINE ?? "auto").toLowerCase();
const RETRY_AI_MS = 10 * 60_000;
let aiDownUntil = 0;

const wantsAi = () => ENGINE !== "local" && isAiConfigured() && (ENGINE === "ai" || Date.now() >= aiDownUntil);

/** POST /api/chat — FRIDAY assistant, streamed as SSE: `data: {"type":"mode"|"text"|"tool"|"done"|"error", ...}` */
export async function POST(req: Request) {
  let db: Db;
  let userId: string;
  let history: z.infer<typeof Body>["messages"];
  let sys: string;
  let aiAllowed = false;
  try {
    db = await createSupabaseServer();
    const { data } = await db.auth.getUser();
    if (!data.user) return Response.json({ error: "Sign in required" }, { status: 401 });
    userId = data.user.id;
    history = Body.parse(await req.json()).messages;
    const { data: profile } = await db.from("profiles").select("full_name, major, work_authorization, origin_label").eq("id", userId).single();
    sys = system(profile);
    // Past today's AI allowance FRIDAY still answers, locally, from the same catalog and tracker.
    aiAllowed = wantsAi() && (await takeAiQuota(userId, "chat"));
  } catch (e) {
    return errorResponse(e);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let sentText = false;
      try {
        if (aiAllowed) {
          try {
            send({ type: "mode", mode: "ai" });
            await runAi(db, userId, sys, history, (t) => { sentText = true; send({ type: "text", text: t }); }, (name) => send({ type: "tool", name }));
            send({ type: "done" });
            return;
          } catch (e) {
            // Mid-answer failures are reported; a provider that can't be reached hands over to Local.
            if (sentText || !isAiUnavailable(e) || ENGINE === "ai") throw e;
            aiDownUntil = Date.now() + RETRY_AI_MS;
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

/** Tool-use loop over an OpenAI-compatible provider. Throws before any text if the provider is unreachable. */
async function runAi(db: Db, userId: string, sys: string, history: z.infer<typeof Body>["messages"], onText: (t: string) => void, onTool: (name: string) => void) {
  const messages: ChatMessage[] = [{ role: "system", content: sys }, ...history];
  const tools: ToolSpec[] = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  for (let turn = 0; turn < 6; turn++) {
    const res = await complete({ messages, tools, maxTokens: 2048 });
    if (!res.toolCalls.length) {
      // Free tiers don't stream tool turns, so send the finished answer in line-sized chunks.
      for (const chunk of (res.content ?? "").match(/[^\n]*\n?/g) ?? []) if (chunk) onText(chunk);
      return;
    }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    for (const c of res.toolCalls) {
      const tool = TOOLS.find((t) => t.name === c.function.name);
      onTool(c.function.name);
      let content: string;
      try {
        const parsed = tool?.schema.safeParse(JSON.parse(c.function.arguments || "{}"));
        content = !tool || !parsed?.success ? "INVALID_INPUT" : JSON.stringify(await tool.run(db, userId, parsed.data as never));
      } catch (e) {
        content = e instanceof Error ? e.message : "Tool failed";
      }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
}
