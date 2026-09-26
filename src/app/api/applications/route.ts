import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { place, STATUS_ORDER } from "@/lib/format";

const Create = z.union([
  z.object({ jobId: z.string().uuid(), status: z.enum(STATUS_ORDER).optional() }),
  z.object({
    company_name: z.string().min(1).max(120),
    job_title: z.string().min(1).max(200),
    location: z.string().max(200).nullish(),
    application_url: z.string().url().nullish(),
    source: z.string().max(60).nullish(),
    status: z.enum(STATUS_ORDER).optional(),
    notes: z.string().max(10_000).nullish(),
  }),
]);

/** GET /api/applications — your tracker, grouped by status on the client. */
export const GET = withUser(async ({ db, user }) => {
  const { data, error } = await db
    .from("applications")
    .select("*, jobs(id, deadline, status, is_on_campus, companies(slug)), follow_ups!follow_ups_parent_owner_fk(id, due_at, done_at, note), interviews!interviews_parent_owner_fk(id, scheduled_at, kind)")
    .eq("user_id", user.id)
    .order("position")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ok({ applications: data });
});

/** POST /api/applications — track an opportunity (from a job, or added manually). */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Create);
  let row: Record<string, unknown>;
  if ("jobId" in input) {
    const { data: job } = await db
      .from("jobs")
      .select("id, title, apply_url, discovered_at, is_on_campus, city, location_text, is_remote, companies(name), job_sources(source_name, is_official)")
      .eq("id", input.jobId)
      .maybeSingle();
    if (!job) throw new HttpError(404, "Opportunity not found");
    const sources = (job.job_sources as unknown as { source_name: string; is_official: boolean }[]) ?? [];
    row = {
      job_id: job.id,
      company_name: (job.companies as unknown as { name: string } | null)?.name ?? "Unknown",
      job_title: job.title,
      location: place(job),
      source: (sources.find((s) => s.is_official) ?? sources[0])?.source_name ?? null,
      original_url: job.apply_url,
      application_url: job.apply_url,
      discovered_at: job.discovered_at,
      status: input.status ?? "saved",
    };
  } else {
    row = { ...input, status: input.status ?? "saved", original_url: input.application_url ?? null };
  }

  const { data: app, error } = await db
    .from("applications")
    .upsert({ ...row, user_id: user.id }, { onConflict: "user_id,job_id", ignoreDuplicates: false })
    .select("*")
    .single();
  if (error) throw error;
  await db.from("application_events").insert({ application_id: app.id, user_id: user.id, kind: "created", to_status: app.status });
  return ok({ application: app }, { status: 201 });
});
