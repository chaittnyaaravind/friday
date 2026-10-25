import { errorResponse, HttpError } from "@/lib/api";
import { parseTest } from "@/lib/resume/parse-test";
import { isTemplateId, templateById } from "@/lib/resume/templates";
import type { ResumeDoc } from "@/lib/resume/types";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/resumes/versions/:id/parse-test?template= — render this version exactly as it would download, read the PDF's
 * text layer back the way an ATS does, and report what came out. Read-only; nothing is saved.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/resumes/versions/[id]/parse-test">) {
  try {
    const { id } = await ctx.params;
    const db = await createSupabaseServer();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return Response.json({ error: "Sign in required" }, { status: 401 });
    const { data: v } = await db.from("resume_versions").select("*").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (!v) throw new HttpError(404, "Resume version not found");
    if (v.kind === "legacy") throw new HttpError(409, "Legacy drafts can't be tested. Build a new version from your profile.");
    const asked = new URL(req.url).searchParams.get("template");
    const template = templateById(isTemplateId(asked) ? asked : (v.template as string | undefined)).id;
    return Response.json({ test: await parseTest(v.content as ResumeDoc, template) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
