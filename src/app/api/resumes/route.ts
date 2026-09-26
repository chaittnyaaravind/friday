import { createHash, randomUUID } from "node:crypto";
import { HttpError, ok, withUser } from "@/lib/api";
import { IMAGE_TYPES, parseDocumentImage } from "@/lib/ai/documents";
import { isAiUnavailable } from "@/lib/ai/client";
import { extractResumeText, RESUME_TYPES } from "@/lib/resume/extract";
import { parseResumeText } from "@/lib/resume/parse";
import { storeParsedFacts, syncMatchingSkills } from "@/lib/resume/profile";

const MAX_BYTES = 5 * 1024 * 1024;

/** GET /api/resumes — your uploaded originals and resume versions (newest first). */
export const GET = withUser(async ({ db, user }) => {
  const [{ data: resumes, error }, { data: versions }] = await Promise.all([
    db.from("resumes").select("id, file_name, mime_type, is_primary, parser, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    db.from("resume_versions").select("id, label, kind, job_id, source_version_id, created_at, updated_at").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);
  if (error) throw error;
  return ok({ resumes, versions });
});

/**
 * POST /api/resumes (multipart: file) — store the untouched original, parse it LOCALLY
 * (no AI) for PDF/DOCX/TXT — or read a PNG/JPG image with the document parser, whose facts all
 * need your confirmation — and add the extracted facts to your Candidate Profile for review.
 * Nothing is added to a resume until you've reviewed it.
 */
export const POST = withUser(async ({ db, user, req }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Attach a resume file");
  // Images (scans, screenshots, photos) can't be read by the local extractors; they go to the document parser.
  const imageMime = IMAGE_TYPES[file.type] ?? (/\.png$/i.test(file.name) ? "image/png" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : undefined);
  const kind = imageMime ? "image" : RESUME_TYPES[file.type] ?? (/\.pdf$/i.test(file.name) ? "pdf" : /\.docx$/i.test(file.name) ? "docx" : /\.txt$/i.test(file.name) ? "txt" : undefined);
  if (!kind) throw new HttpError(415, "Upload a PDF, DOCX, TXT, PNG or JPG resume");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Resume must be under 5 MB");

  const original = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(original).digest("hex");
  let rawText: string;
  let parser = "local";
  if (kind === "image") {
    try {
      rawText = await parseDocumentImage(original, imageMime!);
      parser = "nemotron-parse";
    } catch (e) {
      // No local OCR exists, so there is nothing to fall back to — say so, and point at the files that DO work locally.
      if (isAiUnavailable(e)) throw new HttpError(503, "Reading an image needs FRIDAY's document parser (NVIDIA_API_KEY), and it isn't available right now. Upload a text PDF, DOCX or TXT instead — those are read locally.");
      throw e;
    }
    rawText = rawText.replace(/\u0000/g, "").trim();
  } else {
    rawText = (await extractResumeText(original, kind)).replace(/\u0000/g, "").trim();
  }
  if (rawText.length < 40) throw new HttpError(422, "Couldn't read text from that file. If it's a scanned PDF, upload it as a PNG or JPG image, or export a text PDF or DOCX.");

  // The original bytes are stored exactly as uploaded and never modified.
  const ext = kind === "image" ? (imageMime === "image/png" ? "png" : "jpg") : kind;
  const path = `${user.id}/${randomUUID()}.${ext}`;
  const contentType = kind === "image" ? imageMime! : kind === "pdf" ? "application/pdf" : kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain";
  const { error: upErr } = await db.storage.from("resumes").upload(path, original, { contentType, upsert: false });
  if (upErr) throw upErr;

  const parsedLocal = parseResumeText(rawText);
  // Text read from an image may contain misreads, so nothing from it is trusted until the user confirms it.
  const parsed = kind === "image"
    ? { ...parsedLocal, facts: parsedLocal.facts.map((f) => ({ ...f, status: "requires_confirmation" as const, note: f.note ?? "Read from an image by AI — check that it's correct" })) }
    : parsedLocal;
  await db.from("resumes").update({ is_primary: false }).eq("user_id", user.id).eq("is_primary", true);
  const { data: resume, error } = await db
    .from("resumes")
    .insert({
      user_id: user.id, file_path: path, file_name: file.name.slice(0, 200), mime_type: contentType, raw_text: rawText,
      parsed: { sha256, facts: parsed.facts, unknownHeadings: parsed.unknownHeadings, parsedAt: new Date().toISOString() },
      parser, is_primary: true,
    })
    .select("id")
    .single();
  if (error) throw error;

  const counts = await storeParsedFacts(db, user.id, resume.id, parsed.facts);
  // New facts arrived → the profile needs another look before building a resume.
  if (counts.added) await db.from("profiles").update({ resume_reviewed_at: null }).eq("id", user.id);
  await syncMatchingSkills(db, user.id);
  return ok({ id: resume.id, sha256, ...counts, unknownHeadings: parsed.unknownHeadings });
});
