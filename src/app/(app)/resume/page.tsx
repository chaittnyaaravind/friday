import Link from "next/link";
import { ResumeUpload } from "@/components/resume-studio";
import { ResumeSteps } from "@/components/resume/status";
import { BuildResumeButton, VersionList, type VersionRow } from "@/components/resume/versions";
import { Card, Chip, Label, LinkButton, PageHeader, SectionHeader } from "@/components/ui";
import { ago } from "@/lib/format";
import { resumeStatus } from "@/lib/resume/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Resume" };

export default async function ResumePage() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [status, { data: resumes }, { data: versions }, { data: skills }] = await Promise.all([
    resumeStatus(db, user.id),
    db.from("resumes").select("id, file_name, is_primary, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    db.from("resume_versions").select("id, label, kind, is_master, updated_at, source_version_id, jobs(title, companies(name))").eq("user_id", user.id).order("updated_at", { ascending: false }),
    db.from("profile_skills").select("source, skills(name)").eq("user_id", user.id),
  ]);

  const rows: VersionRow[] = (versions ?? []).map((v) => {
    const job = v.jobs as unknown as { title: string; companies: { name: string } | null } | null;
    return { id: v.id, label: v.label, kind: v.kind, when: ago(v.updated_at), job: job ? job.companies?.name ?? job.title : null, copied: Boolean(v.source_version_id), master: Boolean(v.is_master) };
  });
  const canBuild = status.extracted > 0;

  return (
    <>
      <PageHeader
        eyebrow="Resume"
        title={<>Your resume, <span className="serif-em">only</span> what&rsquo;s true.</>}
        sub="FRIDAY reads your resume with its own parser — no AI — shows you everything it found, and builds resumes only from what you've confirmed. Your original file is never changed."
        actions={canBuild ? <LinkButton href="/resume/review">Review profile</LinkButton> : undefined}
      />

      <div className="grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-6">
          <ResumeUpload hasResume={status.uploaded} />
          <Card className="flex flex-col gap-3 p-5">
            <Label>Status</Label>
            <ResumeSteps status={status} />
          </Card>
          {!!resumes?.length && (
            <Card className="flex flex-col divide-y-[0.5px] divide-hairline-strong">
              <Label className="px-5 pb-2 pt-4">Original uploads</Label>
              {resumes.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <a href={`/api/resumes/${r.id}/original`} className="min-w-0 truncate text-[13.5px] hover:text-accent" title="Download the original, unchanged">{r.file_name}</a>
                  <span className="label shrink-0">{r.is_primary ? "latest" : ago(r.created_at)}</span>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-4">
            <SectionHeader eyebrow="Your resumes" title="Versions" action={canBuild ? <BuildResumeButton label="New from profile" /> : undefined} />
            <VersionList versions={rows} />
            <p className="text-[12.5px] leading-relaxed text-dim">For a specific role, open any opportunity and choose <span className="text-muted">Create tailored resume</span>. Every version is separate — editing one never changes another.</p>
          </section>

          <section className="flex flex-col gap-4">
            <SectionHeader eyebrow="Used for matching" title="Your skills" action={<Link href="/resume/review" className="text-[13px] text-muted hover:text-text">Review</Link>} />
            <div className="flex flex-wrap gap-1.5">
              {skills?.length ? skills.map((s) => {
                const k = s.skills as unknown as { name: string } | null;
                return k ? <Chip key={k.name} tone={s.source === "resume" ? "moss" : "neutral"}>{k.name}</Chip> : null;
              }) : <p className="text-[13.5px] text-muted">No skills yet — upload a resume or add them in Settings.</p>}
            </div>
            {!!skills?.length && <p className="text-[12px] text-dim"><span className="text-moss">Green</span> came from your reviewed resume; neutral ones you added in Settings. Skills awaiting confirmation aren&rsquo;t used.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
