import { errorResponse, HttpError } from "@/lib/api";
import { renderDocx, renderPdf } from "@/lib/resume/export";
import { loadProfileItems } from "@/lib/resume/profile";
import { isTemplateId, templateById } from "@/lib/resume/templates";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/resumes/versions/:id/export?format=pdf|docx — download exactly the reviewed
 * document. Refuses (422) if anything in it isn't backed by your confirmed profile.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/resumes/versions/[id]/export">) {
  try {
    const { id } = await ctx.params;
    const format = new URL(req.url).searchParams.get("format") === "docx" ? "docx" : "pdf";
    const db = await createSupabaseServer();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return Response.json({ error: "Sign in required" }, { status: 401 });
    // select("*"): keeps working on a database that hasn't applied the template column yet.
    const { data: v } = await db.from("resume_versions").select("*").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (!v) throw new HttpError(404, "Resume version not found");
    if (v.kind === "legacy") throw new HttpError(409, "Legacy drafts can't be exported. Build a new version from your profile.");
    const doc = v.content as ResumeDoc;
    const check = validateDoc(doc, await loadProfileItems(db, auth.user.id));
    if (!check.ok) return Response.json({ error: "Some content isn't backed by your confirmed profile. Fix or confirm it before exporting.", issues: check.issues }, { status: 422 });

    const name = `${(doc.header.name || "Resume").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_")}_${v.label.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_")}`.slice(0, 90);
    // ?template= previews another look without saving it; otherwise the version's saved template. Presentation only.
    const asked = new URL(req.url).searchParams.get("template");
    const template = templateById(isTemplateId(asked) ? asked : (v.template as string | undefined)).id;
    const bytes = format === "pdf" ? await renderPdf(doc, template) : await renderDocx(doc, template);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${name}.${format}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
