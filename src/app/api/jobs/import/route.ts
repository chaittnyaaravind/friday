import { z } from "zod";
import { body, HttpError, ok, withUser } from "@/lib/api";
import { rematchAll, skillIdMap, syncCatalog } from "@/lib/discovery/agent";
import { IMPORT_DAILY_LIMIT, isHttpUrl } from "@/lib/discovery/import-scope";
import { importPosting } from "@/lib/discovery/ingest";
import { createSupabaseAdmin } from "@/lib/supabase/server";

const Input = z.object({
  url: z.string().url().max(2000).refine(isHttpUrl, "Only http(s) links can be imported"),
  title: z.string().min(2).max(200),
  company: z.string().min(1).max(120),
  location: z.string().max(200).nullish(),
  description: z.string().max(60_000).nullish(),
  pay: z.string().max(120).nullish(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  source: z.enum(["handshake", "linkedin", "indeed", "other"]),
  onCampus: z.boolean().optional(),
});

/**
 * POST /api/jobs/import — add a listing from Handshake / LinkedIn / Indeed / anywhere by
 * pasting it. FRIDAY never logs into those sites; the user brings the listing.
 * Imported jobs are deduplicated against everything already discovered, then saved for you.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const input = await body(req, Input);
  // A student can import a generous number of listings per day, not an unlimited stream.
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await db.from("job_sources").select("id", { count: "exact", head: true }).eq("imported_by", user.id).gte("first_seen_at", since);
  if ((count ?? 0) >= IMPORT_DAILY_LIMIT) throw new HttpError(429, `You've imported ${IMPORT_DAILY_LIMIT} listings today — that's the daily limit. Try again tomorrow.`);
  const admin = createSupabaseAdmin();
  await syncCatalog(admin);
  const { jobId, merged } = await importPosting(admin, input, await skillIdMap(admin), user.id);
  await db.from("saved_jobs").upsert({ user_id: user.id, job_id: jobId }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
  await rematchAll(db, { userId: user.id });
  return ok({ jobId, merged });
});
