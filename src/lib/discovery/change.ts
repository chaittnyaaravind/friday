/**
 * Change detection for catalog jobs. A posting's "content" is the handful of fields a student would notice
 * changing; hashing them lets an ingest run tell NEW from UPDATED without comparing whole descriptions, and
 * recording WHICH fields changed gives `job_events` something a person can read.
 *
 * Pure and deterministic. Whitespace is collapsed before hashing so a re-flowed description is not "an update".
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Fields whose change is an "update". Everything else on a job row (verification time, status…) is FRIDAY's own. */
export const TRACKED_FIELDS = ["title", "department", "employment_type", "location_text", "pay_text", "deadline", "apply_url"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type JobContent = Partial<Record<TrackedField | "description", unknown>>;

const squash = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Hash of the description text alone (whitespace-insensitive). */
export const descriptionHash = (row: JobContent) => sha(squash(row.description));

/** Hash of every tracked field plus the description. Stable for equal content, different for any real change. */
export function contentHash(row: JobContent): string {
  return sha(JSON.stringify([...TRACKED_FIELDS.map((f) => [f, squash(row[f])]), ["description", descriptionHash(row)]]));
}

export type FieldChange = { from: string | null; to: string | null };
export type Changes = Partial<Record<TrackedField | "description", FieldChange | { changed: true }>>;

const clip = (v: unknown): string | null => {
  const s = squash(v);
  return s ? s.slice(0, 300) : null;
};

/**
 * What changed between the stored job and the freshly read one. Tracked fields report before/after (clipped);
 * the description reports only that it changed, since its full text is not an audit-log value.
 */
export function diffContent(prev: JobContent & { description_hash?: string | null }, next: JobContent): Changes {
  const out: Changes = {};
  for (const f of TRACKED_FIELDS) {
    if (squash(prev[f]) !== squash(next[f])) out[f] = { from: clip(prev[f]), to: clip(next[f]) };
  }
  if (prev.description_hash && prev.description_hash !== descriptionHash(next)) out.description = { changed: true };
  return out;
}

export type JobEventKind = "new" | "updated" | "closed" | "reopened" | "expired";

export type JobEventRow = {
  job_id: string;
  kind: JobEventKind;
  source: string | null;
  run_id: string | null;
  changes: Record<string, unknown>;
};

/** Insert events in chunks. Events are an audit trail: a failure to write one is raised, never swallowed. */
export async function writeJobEvents(db: SupabaseClient, rows: JobEventRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("job_events").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`job_events insert failed: ${error.message}`);
  }
  return rows.length;
}
