import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { HttpError, ok, withUser } from "@/lib/api";
import { friendlyAiError, isAiConfigured } from "@/lib/ai/client";
import { parseResume, type ParsedResume } from "@/lib/ai/tasks";
import { rematchAll } from "@/lib/discovery/agent";
import { extractSkills, resolveSkill } from "@/lib/domain/skills";

const TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};
const MAX_BYTES = 5 * 1024 * 1024;

async function toText(file: File, ext: string) {
  const buf = Buffer.from(await file.arrayBuffer());
  if (ext === "pdf") return (await extractText(new Uint8Array(buf), { mergePages: true })).text;
  if (ext === "docx") return (await mammoth.extractRawText({ buffer: buf })).value;
  return buf.toString("utf8");
}

/** GET /api/resumes — your resumes and tailored versions (newest first). */
export const GET = withUser(async ({ db, user }) => {
  const [{ data: resumes, error }, { data: versions }] = await Promise.all([
    db.from("resumes").select("id, file_name, mime_type, parsed, is_primary, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    db.from("resume_versions").select("id, resume_id, job_id, label, created_at, jobs(title, companies(name))").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  return ok({ resumes, versions });
});

/**
 * POST /api/resumes (multipart: file) — upload, extract text, parse, and sync skills.
 * The file lives in a private bucket under your user id; only you can read it.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a resume file");
  const ext = TYPES[file.type];
  if (!ext) throw new HttpError(415, "Upload a PDF, DOCX, or TXT resume");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Resume must be under 5 MB");

  const rawText = (await toText(file, ext)).replace(/\u0000/g, "").trim();
  if (rawText.length < 80) throw new HttpError(422, "Couldn't read text from that file. If it's a scanned PDF, export it as a text PDF or DOCX.");

  const path = `${user.id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from("resumes").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  // Parse with Claude when configured; otherwise fall back to deterministic skill extraction.
  let parsed: ParsedResume | null = null;
  let parseNote: string | null = null;
  if (isAiConfigured()) {
    try {
      parsed = await parseResume(rawText);
    } catch (e) {
      parseNote = `${friendlyAiError(e) ?? "AI parsing failed."} Skills were extracted directly from your resume text instead.`;
    }
  } else {
    parseNote = "AI parsing is not configured (ANTHROPIC_API_KEY). Skills were extracted directly from your resume text.";
  }

  const { count } = await db.from("resumes").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const makePrimary = !count || form.get("primary") === "true";
  if (makePrimary) await db.from("resumes").update({ is_primary: false }).eq("user_id", user.id).eq("is_primary", true);
  const { data: resume, error } = await db
    .from("resumes")
    .insert({ user_id: user.id, file_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, raw_text: rawText, parsed, is_primary: makePrimary })
    .select("id")
    .single();
  if (error) throw error;

  // Resume skills join the profile (manual skills are kept).
  const slugs = new Set<string>([...extractSkills(rawText), ...((parsed?.skills ?? []).map(resolveSkill).filter(Boolean) as string[])]);
  if (slugs.size) {
    const { data: rows } = await db.from("skills").select("id").in("slug", [...slugs]);
    if (rows?.length) {
      await db.from("profile_skills").upsert(rows.map((r) => ({ user_id: user.id, skill_id: r.id, source: "resume" })), { onConflict: "user_id,skill_id", ignoreDuplicates: true });
    }
  }
  await rematchAll(db, { userId: user.id });
  return ok({ id: resume.id, parsed, skills: [...slugs], note: parseNote });
});
