import Link from "next/link";
import { notFound } from "next/navigation";
import { ResumeEditor } from "@/components/resume/editor";
import { Notice, PageHeader } from "@/components/ui";
import { loadProfileItems } from "@/lib/resume/profile";
import type { ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Resume editor" };

export default async function EditorPage({ params }: PageProps<"/resume/[versionId]">) {
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) notFound();
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data: v } = await db
    .from("resume_versions")
    .select("id, label, kind, content, job_id, jobs(title, companies(name))")
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
  return (
    <>
      <PageHeader
        eyebrow={job ? `Resume · Tailored for ${job.companies?.name ?? job.title}` : "Resume · Editor"}
        title={<>Edit, <span className="serif-em">then</span> export.</>}
        sub="Changes save automatically. The preview on the right is exactly what the PDF and DOCX will contain."
        actions={back}
      />
      <ResumeEditor id={v.id} label={v.label} initial={doc} verification={validateDoc(doc, items)} />
    </>
  );
}
