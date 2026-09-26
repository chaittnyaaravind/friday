import Link from "next/link";
import { notFound } from "next/navigation";
import { ResumeEditor } from "@/components/resume/editor";
import { Notice, PageHeader } from "@/components/ui";
import { aiProviders } from "@/lib/ai/client";
import { loadProfileItems } from "@/lib/resume/profile";
import { isTemplateId } from "@/lib/resume/templates";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Resume editor" };

export default async function EditorPage({ params }: PageProps<"/resume/[versionId]">) {
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) notFound();
  const user = await requireUser();
  const db = await createSupabaseServer();
  // "*": also picks up the `template` column when migration 0006 is applied, without failing when it isn't.
  const { data: v } = await db
    .from("resume_versions")
    .select("*, jobs(title, companies(name))")
    .eq("id", versionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!v) notFound();

  const job = v.jobs as unknown as { title: string; companies: { name: string } | null } | null;
  const back = <Link href="/resume" className="text-[13px] text-muted hover:text-text">← All resumes</Link>;

  if (v.kind === "legacy") {
    return (
      <>
        <PageHeader eyebrow="Resume · Legacy draft" title={v.label} actions={back} />
        <Notice tone="amber" title="This draft was made by the old AI tailoring and is read-only.">
          It wasn&rsquo;t built from your reviewed profile, so FRIDAY can&rsquo;t verify it. <Link href="/resume" className="text-accent underline-offset-2 hover:underline">Build a new version</Link> from your confirmed information instead.
        </Notice>
      </>
    );
  }

  const items = await loadProfileItems(db, user.id);
  const doc = v.content as ResumeDoc;

  // The state a version was created in is always recoverable: record it before the editor can change anything.
  // Best effort — if history isn't set up yet the editor still works and says so.
  try {
    const { count, error } = await db.from("resume_revisions").select("id", { count: "exact", head: true }).eq("version_id", v.id);
    if (!error && count === 0) await db.from("resume_revisions").insert({ version_id: v.id, user_id: user.id, label: "Original resume", source: "original", content: doc });
  } catch { /* history unavailable */ }

  const providers = aiProviders().map((p) => p.provider);
  return (
    <>
      <PageHeader
        eyebrow={job ? `Resume · Tailored for ${job.companies?.name ?? job.title}` : "Resume · Editor"}
        title={<>Edit, <span className="serif-em">sharpen</span>, export.</>}
        sub="Click any bullet to improve it. AI can reword — it can never add a fact. Changes save automatically, every AI edit is kept in history, and the preview is exactly what the PDF and DOCX contain."
        actions={back}
      />
      <ResumeEditor id={v.id} label={v.label} initial={doc} verification={validateDoc(doc, items)} template={isTemplateId(v.template) ? v.template : "classic"} aiConfigured={providers.length > 0} providers={providers} updatedAt={v.updated_at} />
    </>
  );
}
