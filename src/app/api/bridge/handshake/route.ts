import { z } from "zod";
import { body, errorResponse, ok } from "@/lib/api";
import { rematchAll, skillIdMap, syncCatalog } from "@/lib/discovery/agent";
import { IMPORT_DAILY_LIMIT } from "@/lib/discovery/import-scope";
import { importPosting } from "@/lib/discovery/ingest";
import { isHandshakeSender, parseHandshakeAlert } from "@/lib/hunter/handshake-mail";
import { bridgeUser } from "@/lib/hunter/link";
import { enqueue, processQueue } from "@/lib/hunter/pipeline";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export const maxDuration = 300;

const Input = z.object({
  messages: z.array(z.object({
    id: z.string().min(1).max(200),
    from: z.string().max(320),
    receivedAt: z.string().datetime({ offset: true }).nullish(),
    html: z.string().max(600_000),
  })).max(20),
});

/**
 * POST /api/bridge/handshake — Handshake job-alert emails from the student's OWN Gmail, posted by their Apps Script bridge.
 * FRIDAY never contacts Handshake: each job keeps the email's title, employer and link, and is a private import (0009).
 * Each Gmail message is read once. New listings go straight to the hunter, so a card can follow within the same minute.
 */
export async function POST(req: Request) {
  try {
    const db = createSupabaseAdmin();
    const userId = await bridgeUser(db, req);
    const { messages } = await body(req, Input);
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await db.from("job_sources").select("id", { count: "exact", head: true }).eq("imported_by", userId).gte("first_seen_at", since);
    let budget = IMPORT_DAILY_LIMIT - (count ?? 0);
    const report = { messages: 0, alreadyRead: 0, notHandshake: 0, jobs: 0, limited: 0 };
    const jobIds: string[] = [];
    let skills: Map<string, number> | null = null;

    for (const m of messages) {
      if (!isHandshakeSender(m.from)) {
        report.notHandshake++;
        continue;
      }
      const { data: fresh } = await db.from("handshake_mail").upsert({ user_id: userId, gmail_id: m.id, received_at: m.receivedAt ?? null }, { onConflict: "user_id,gmail_id", ignoreDuplicates: true }).select("gmail_id");
      if (!fresh?.length) {
        report.alreadyRead++;
        continue;
      }
      report.messages++;
      const jobs = parseHandshakeAlert(m.html);
      if (jobs.length && !skills) {
        await syncCatalog(db);
        skills = await skillIdMap(db);
      }
      for (const j of jobs) {
        if (budget <= 0) {
          report.limited++;
          continue;
        }
        const { jobId } = await importPosting(db, { url: j.url, title: j.title, company: j.employer ?? "Handshake employer", source: "handshake", onCampus: j.onCampus, description: null }, skills!, userId);
        budget--;
        jobIds.push(jobId);
        report.jobs++;
      }
      await db.from("handshake_mail").update({ jobs_found: jobs.length }).eq("user_id", userId).eq("gmail_id", m.id);
    }

    let queued = 0;
    if (jobIds.length) {
      await rematchAll(db, { userId });
      queued = await enqueue(db, jobIds, { userId });
      if (queued) await processQueue(db, { deadline: Date.now() + 80_000, userId });
    }
    return ok({ ...report, queued });
  } catch (e) {
    return errorResponse(e);
  }
}
