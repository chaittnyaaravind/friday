import { HttpError, withUser } from "@/lib/api";

/** GET /api/resumes/:id/original — a short-lived link to your untouched uploaded file. */
export const GET = withUser<{ id: string }>(async ({ db, user }, { id }) => {
  const { data: r } = await db.from("resumes").select("file_path, file_name").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!r) throw new HttpError(404, "Upload not found");
  const { data, error } = await db.storage.from("resumes").createSignedUrl(r.file_path, 120, { download: r.file_name });
  if (error || !data) throw error ?? new HttpError(500, "Couldn't create a download link");
  return Response.redirect(data.signedUrl, 302);
});
