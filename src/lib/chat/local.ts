/**
 * FRIDAY Local — the chat engine that needs no AI provider. It reads the student's
 * question with deterministic rules (./intent), answers from the real database, and
 * links everything it mentions. It never invents a listing, status or date.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchJobs, type JobFilters, type JobListItem } from "@/lib/data/jobs";
import { skillBySlug } from "@/lib/domain/skills";
import { ISSS_NOTICE, ISSS_ON_CAMPUS_URL, ISSS_URL, learnSuggestion, type Gap, type Reason } from "@/lib/domain/match";
import { ago, deadlineLabel, shortDate, STATUS_LABEL, TYPE_LABEL } from "@/lib/format";
import { loadProfileItems, loadTailorJob, resumeStatus } from "@/lib/resume/profile";
import { tailorProposal } from "@/lib/resume/tailor";
import { discoverHref, hasStructure, keywords, parseIntent, type CompanyRef, type Intent } from "./intent";

type Msg = { role: "user" | "assistant"; content: string };
export type LocalAnswer = { text: string; tools: string[] };
type JobRef = { id: string; title: string; company: string; score: number | null; strong: Reason[]; missing: Gap[] };

export const HELP = [
  "Here's what I can do:",
  "",
  "- **Find jobs** — “SJSU jobs posted this week”, “backend internships within 10 miles”, “remote React internships”",
  "- **Your matches** — “which internships match my Java skills?”, “best matches at Cisco”",
  "- **What to learn** — “what should I learn for my top match?”",
  "- **Companies** — “which companies are hiring CS interns around San Jose?”",
  "- **Deadlines** — “internship deadlines this month”",
  "- **Your tracker** — “my applications”, “which applications need follow-up?”",
  "- **Resume** — “resume status”, “tailor my resume for Cisco”",
  "- **Work authorization** — general CPT/OPT notes with SJSU ISSS links",
].join("\n");

/** Match reasons that are actual skills (not "On campus", "Computer Science student", …). */
const skillsOf = (r: Reason[]) => r.filter((x) => x.kind === "skill").map((x) => x.label);
const tidy = (lines: string[]) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

function jobLine(j: JobListItem): string {
  const bits = [
    j.score != null ? `${j.score}% match` : null,
    TYPE_LABEL[j.employment_type] ?? null,
    j.is_on_campus ? "SJSU campus" : j.distance_miles != null ? `${j.distance_miles.toFixed(1)} mi` : j.city ?? j.location_text,
    j.pay_text,
    `posted ${ago(j.posted_at ?? j.discovered_at)}`,
    deadlineLabel(j.deadline)?.text ?? null,
  ].filter(Boolean);
  const skills = skillsOf(j.strong ?? []);
  const why = skills.length ? ` — you have ${skills.slice(0, 3).join(", ")}` : "";
  return `- **[${j.title} — ${j.company_name}](/jobs/${j.id})** · ${bits.join(" · ")}${why}`;
}

function describe(f: JobFilters, companyNames: string[]): string {
  const parts: string[] = [];
  if (f.postedWithinDays === 1) parts.push("posted today");
  else if (f.postedWithinDays) parts.push(`posted in the last ${f.postedWithinDays} days`);
  if (f.deadlineWithinDays) parts.push(`closing in the next ${f.deadlineWithinDays} days`);
  if (f.maxMiles) parts.push(`within ${f.maxMiles} miles`);
  if (f.remoteOnly) parts.push("remote");
  if (f.skills?.length) parts.push(`using ${f.skills.map((s) => skillBySlug(s)?.name ?? s).join(" or ")}`);
  if (companyNames.length) parts.push(`at ${companyNames.join(", ")}`);
  if (f.q) parts.push(`matching “${f.q}”`);
  return parts.length ? ` ${parts.join(", ")}` : "";
}

function noun(f: JobFilters) {
  const cat = f.categories?.[0] ? `${f.categories[0]} ` : "";
  if (f.onCampus) return "SJSU on-campus jobs";
  if (f.types?.includes("internship")) return `${cat}internships`;
  if (f.types?.includes("part_time")) return `${cat}part-time roles`;
  if (f.types?.includes("full_time")) return `${cat}full-time roles`;
  if (f.types?.includes("research")) return "research positions";
  return `${cat}opportunities`;
}

async function search(db: SupabaseClient, intent: Intent, text: string, limit = 8): Promise<LocalAnswer> {
  let f: JobFilters = { ...intent.filters, limit };
  // No structured filter recognised → search the words they used.
  if (!hasStructure(f)) {
    const q = keywords(text);
    if (q) f = { ...f, q, sort: "relevance" };
  }
  const { jobs, total } = await searchJobs(db, f);
  const what = `${noun(f)}${describe(f, intent.companyNames)}`;
  if (!jobs.length) {
    const wider: JobFilters = { ...f, q: undefined, postedWithinDays: undefined, deadlineWithinDays: undefined, maxMiles: f.maxMiles ? f.maxMiles * 2 : undefined, sort: "match" };
    const { total: widerTotal } = await searchJobs(db, { ...wider, limit: 1 });
    return {
      tools: ["search_opportunities"],
      text: tidy([
        `I found no ${what} in FRIDAY's verified listings.`,
        "",
        widerTotal ? `Loosening the filters finds **${widerTotal}** — [see them in Discover](${discoverHref(wider)}).` : "Try fewer filters, or run a fresh search from the Dashboard.",
      ]),
    };
  }
  const order = { distance: "closest first", deadline: "soonest deadline first", new: "newest first", first_seen: "most recently found first", relevance: "best keyword match first", match: "best match first" }[f.sort ?? "match"];
  return {
    tools: ["search_opportunities"],
    text: tidy([
      `**${total}** ${what} — ${order}:`,
      "",
      ...jobs.map(jobLine),
      "",
      total > jobs.length ? `[See all ${total} in Discover →](${discoverHref(f)}) · or say “more”` : `[Open in Discover →](${discoverHref(f)})`,
    ]),
  };
}

/** The job the student means: an id they pasted, a company they named, or their best match. */
async function pickJob(db: SupabaseClient, userId: string, intent: Intent): Promise<JobRef | null> {
  if (intent.jobId) {
    const [{ data: job }, { data: m }] = await Promise.all([
      db.from("jobs").select("id, title, companies(name)").eq("id", intent.jobId).maybeSingle(),
      db.from("job_matches").select("score, strong, missing").eq("job_id", intent.jobId).eq("user_id", userId).maybeSingle(),
    ]);
    if (job) return { id: job.id, title: job.title, company: (job.companies as unknown as { name: string } | null)?.name ?? "", score: m?.score ?? null, strong: (m?.strong as Reason[]) ?? [], missing: (m?.missing as Gap[]) ?? [] };
  }
  const f: JobFilters = { ...intent.filters, postedWithinDays: undefined, sort: "match", limit: 1 };
  const j = (await searchJobs(db, f)).jobs[0] ?? (intent.companyNames.length ? null : (await searchJobs(db, { sort: "match", limit: 1 })).jobs[0]);
  return j ? { id: j.id, title: j.title, company: j.company_name, score: j.score, strong: j.strong ?? [], missing: j.missing ?? [] } : null;
}

async function skillGap(db: SupabaseClient, userId: string, intent: Intent): Promise<LocalAnswer> {
  const job = await pickJob(db, userId, intent);
  if (!job) return { tools: ["search_opportunities"], text: `I couldn't find ${intent.companyNames.length ? `an opening at ${intent.companyNames.join(", ")}` : "a matching opportunity"} yet.` };
  const lines = [
    `For **[${job.title} — ${job.company}](/jobs/${job.id})**${job.score != null ? ` (${job.score}% match)` : ""}:`,
    "",
    skillsOf(job.strong).length ? `**You already have:** ${skillsOf(job.strong).join(", ")}` : "",
    "",
  ];
  if (!job.missing.length) lines.push("Nothing required is missing from your profile — this is a strong fit. Tailor your resume and apply.");
  else {
    lines.push("**To close the gap:**", "");
    for (const m of job.missing.slice(0, 6)) lines.push(`- **${m.label}**${m.kind === "preferred" ? " (preferred)" : ""} — ${learnSuggestion(m.label)}`);
  }
  lines.push("", `[Create a tailored resume for this role →](/resume/tailor/${job.id})`);
  return { tools: ["search_opportunities", "skill_gap"], text: tidy(lines) };
}

async function tailor(db: SupabaseClient, userId: string, intent: Intent): Promise<LocalAnswer> {
  const job = await pickJob(db, userId, intent);
  if (!job) return { tools: ["tailor_resume"], text: "Tell me which role — e.g. “tailor my resume for Cisco”." };
  const items = await loadProfileItems(db, userId);
  if (!items.some((i) => i.status !== "requires_confirmation")) return { tools: ["tailor_resume"], text: "Upload and review your resume first — tailoring only uses information you've confirmed. [Go to Resume →](/resume)" };
  const p = tailorProposal(items, await loadTailorJob(db, job.id));
  const have = p.skills.filter((s) => s.status === "confirmed").map((s) => s.name);
  const lack = p.skills.filter((s) => s.status === "not_in_profile").map((s) => s.name);
  return {
    tools: ["tailor_resume"],
    text: tidy([
      `Tailoring for **[${job.title} — ${job.company}](/jobs/${job.id})**:`,
      "",
      `- **Matched:** ${have.length ? have.join(", ") : "none of the detected requirements yet"}`,
      `- **Not in your profile (never added):** ${lack.length ? lack.join(", ") : "nothing"}`,
      ...(p.relevant.experience.length ? [`- **Most relevant experience:** ${p.relevant.experience.slice(0, 3).map((r) => r.label).join("; ")}`] : []),
      ...p.changes.reorder.map((r) => `- **Reorder:** ${r}`),
      "",
      `Nothing is created until you accept. [Review the changes →](/resume/tailor/${job.id})`,
    ]),
  };
}

async function resume(db: SupabaseClient, userId: string): Promise<LocalAnswer> {
  const s = await resumeStatus(db, userId);
  const mark = (ok: boolean) => (ok ? "✓" : "○");
  const n = s.needsConfirmation;
  return {
    tools: ["get_profile"],
    text: tidy([
      "**Your resume status**",
      "",
      `- ${mark(s.uploaded)} Resume uploaded`,
      `- ${mark(s.extracted > 0)} ${s.extracted} items extracted`,
      `- ${n ? "⚠" : mark(s.reviewed)} Profile reviewed${n ? ` — ${n} item${n === 1 ? " needs" : "s need"} review` : ""}`,
      `- ${mark(Boolean(s.latestVersion))} Resume ready${s.latestVersion ? ` — [${s.latestVersion.label}](/resume/${s.latestVersion.id})` : ""}`,
      "",
      !s.uploaded ? "[Upload your resume →](/resume)" : n || !s.reviewed ? "[Review what FRIDAY found →](/resume/review)" : "[Open your resumes →](/resume)",
    ]),
  };
}

async function applications(db: SupabaseClient, userId: string): Promise<LocalAnswer> {
  const { data } = await db.from("applications").select("id, company_name, job_title, status, applied_at, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(40);
  if (!data?.length) return { tools: ["list_applications"], text: "You aren't tracking any applications yet. Open an opportunity and press **Track** to start. [Browse opportunities →](/discover)" };
  const counts = new Map<string, number>();
  for (const a of data) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  return {
    tools: ["list_applications"],
    text: tidy([
      `**${data.length} tracked application${data.length === 1 ? "" : "s"}** — ${[...counts].map(([s, n]) => `${n} ${STATUS_LABEL[s] ?? s}`).join(", ")}`,
      "",
      ...data.slice(0, 10).map((a) => `- **${a.job_title}** at ${a.company_name} · ${STATUS_LABEL[a.status] ?? a.status}${a.applied_at ? ` · applied ${shortDate(a.applied_at)}` : ""} · updated ${ago(a.updated_at)}`),
      "",
      "[Open your tracker →](/applications)",
    ]),
  };
}

async function followUps(db: SupabaseClient, userId: string): Promise<LocalAnswer> {
  const [{ data: f }, { data: iv }] = await Promise.all([
    db.from("follow_ups").select("due_at, note, applications!follow_ups_parent_owner_fk(company_name, job_title)").eq("user_id", userId).is("done_at", null).order("due_at").limit(10),
    db.from("interviews").select("scheduled_at, kind, applications!interviews_parent_owner_fk(company_name, job_title)").eq("user_id", userId).gte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(5),
  ]);
  const app = (a: unknown) => a as { company_name: string; job_title: string } | null;
  if (!f?.length && !iv?.length) return { tools: ["list_follow_ups"], text: "Nothing is waiting on you — no open follow-ups or upcoming interviews. [Open your tracker →](/applications)" };
  const now = Date.now();
  return {
    tools: ["list_follow_ups"],
    text: tidy([
      ...(iv?.length ? ["**Upcoming interviews**", "", ...iv.map((i) => `- ${shortDate(i.scheduled_at)} — **${app(i.applications)?.company_name ?? "Interview"}**${app(i.applications)?.job_title ? `, ${app(i.applications)!.job_title}` : ""}${i.kind ? ` (${i.kind})` : ""}`), ""] : []),
      ...(f?.length ? ["**Follow-ups**", "", ...f.map((x) => `- ${new Date(x.due_at).getTime() < now ? "**Overdue** · " : ""}${shortDate(x.due_at)} — ${app(x.applications)?.company_name ?? ""}${x.note ? `: ${x.note}` : ""}`), ""] : []),
      "[Open your tracker →](/applications)",
    ]),
  };
}

async function companies(db: SupabaseClient, intent: Intent): Promise<LocalAnswer> {
  const f: JobFilters = { ...intent.filters, limit: 150 };
  const { jobs } = await searchJobs(db, f);
  const what = `${noun(f)}${describe(f, intent.companyNames)}`;
  if (!jobs.length) return { tools: ["search_opportunities"], text: `No companies are hiring for ${what} in FRIDAY's listings right now.` };
  const by = new Map<string, { name: string; slug: string; n: number; best: number | null; miles: number | null }>();
  for (const j of jobs) {
    const c = by.get(j.company_slug) ?? { name: j.company_name, slug: j.company_slug, n: 0, best: null, miles: j.distance_miles };
    c.n++;
    if (j.score != null && (c.best == null || j.score > c.best)) c.best = j.score;
    by.set(j.company_slug, c);
  }
  const list = [...by.values()].sort((a, b) => b.n - a.n || (b.best ?? 0) - (a.best ?? 0)).slice(0, 12);
  return {
    tools: ["search_opportunities"],
    text: tidy([
      `**${by.size} compan${by.size === 1 ? "y" : "ies"}** hiring for ${what}:`,
      "",
      ...list.map((c) => `- **[${c.name}](/companies/${c.slug})** · ${c.n} opening${c.n === 1 ? "" : "s"}${c.best != null ? ` · best match ${c.best}%` : ""}${c.miles != null ? ` · ${c.miles.toFixed(1)} mi` : ""}`),
      "",
      `[See the openings in Discover →](${discoverHref(f)})`,
    ]),
  };
}

async function profile(db: SupabaseClient, userId: string): Promise<LocalAnswer> {
  const { data: p } = await db.from("profiles").select("full_name, major, graduation_year, origin_label, radius_miles, desired_titles, profile_skills(skills(name))").eq("id", userId).single();
  const skills = ((p?.profile_skills ?? []) as unknown as { skills: { name: string } | null }[]).map((s) => s.skills?.name).filter(Boolean);
  const titles = (p?.desired_titles as string[] | null) ?? [];
  return {
    tools: ["get_profile"],
    text: tidy([
      `**${p?.full_name ?? "Your profile"}**${p?.major ? ` · ${p.major}` : ""}${p?.graduation_year ? ` · class of ${p.graduation_year}` : ""}`,
      "",
      `- **Searching from:** ${p?.origin_label ?? "SJSU Campus"}, within ${p?.radius_miles ?? 25} miles`,
      ...(titles.length ? [`- **Looking for:** ${titles.join(", ")}`] : []),
      `- **Skills used for matching (${skills.length}):** ${skills.length ? skills.join(", ") : "none yet"}`,
      "",
      "[Edit in Settings →](/settings) · [Review resume facts →](/resume/review)",
    ]),
  };
}

async function jobDetail(db: SupabaseClient, userId: string, intent: Intent): Promise<LocalAnswer> {
  const job = await pickJob(db, userId, intent);
  if (!job) return { tools: ["get_opportunity"], text: "I couldn't find that opportunity." };
  return {
    tools: ["get_opportunity"],
    text: tidy([
      `**[${job.title} — ${job.company}](/jobs/${job.id})**`,
      "",
      job.score != null ? `- **${job.score}% match** — strong: ${skillsOf(job.strong).join(", ") || "—"}` : "",
      `- **Missing:** ${job.missing.map((s) => s.label).join(", ") || "nothing required"}`,
      "",
      `[Create a tailored resume →](/resume/tailor/${job.id})`,
    ]),
  };
}

function workAuth(): LocalAnswer {
  return {
    tools: [],
    text: tidy([
      "General information only — not legal advice:",
      "",
      `- **On-campus jobs** are usually the most accessible option for F-1 students, with hour limits during the academic term. [SJSU on-campus employment](${ISSS_ON_CAMPUS_URL})`,
      "- **Off-campus internships** generally need authorization such as **CPT** or **OPT**. FRIDAY can't determine your eligibility.",
      "- Postings that say “U.S. citizenship required”, “clearance” or “no sponsorship” are flagged on each opportunity page.",
      "",
      `${ISSS_NOTICE} [SJSU ISSS employment](${ISSS_URL})`,
    ]),
  };
}

/** Answer the latest user message using only FRIDAY's own data. */
export async function answerLocally(db: SupabaseClient, userId: string, messages: Msg[]): Promise<LocalAnswer> {
  const users = messages.filter((m) => m.role === "user");
  let text = users[users.length - 1]?.content.trim() ?? "";
  let limit = 8;
  // "more" → repeat the previous question with a longer list.
  if (/^(show )?more( results| please)?[.!]*$|^next$/i.test(text) && users.length > 1) {
    text = users[users.length - 2].content;
    limit = 15;
  }
  const { data: cs } = await db.from("companies").select("slug, name").limit(2000);
  const intent = parseIntent(text, (cs ?? []) as CompanyRef[]);

  switch (intent.kind) {
    case "greeting": {
      const { data: p } = await db.from("profiles").select("full_name").eq("id", userId).single();
      const first = p?.full_name?.split(" ")[0];
      return { tools: [], text: `Hi${first ? ` ${first}` : ""} — what are we hunting for today?\n\n${HELP}` };
    }
    case "help": return { tools: [], text: HELP };
    case "tailor": return tailor(db, userId, intent);
    case "resume": return resume(db, userId);
    case "follow_ups": return followUps(db, userId);
    case "applications": return applications(db, userId);
    case "work_auth": return workAuth();
    case "skill_gap": return skillGap(db, userId, intent);
    case "profile": return profile(db, userId);
    case "job_detail": return jobDetail(db, userId, intent);
    case "deadlines": {
      const f = { ...intent.filters, sort: "deadline" as const, deadlineWithinDays: intent.filters.postedWithinDays ?? 45, postedWithinDays: undefined };
      return search(db, { ...intent, filters: f }, text, limit);
    }
    case "companies": return companies(db, intent);
    default: return search(db, intent, text, limit);
  }
}
