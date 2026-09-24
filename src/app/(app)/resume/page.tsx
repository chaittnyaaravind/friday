import Link from "next/link";
import { Reveal } from "@/components/motion";
import { ResumeUpload, VersionView } from "@/components/resume-studio";
import { Card, Chip, Label, PageHeader, SectionHeader, cx } from "@/components/ui";
import type { ParsedResume } from "@/lib/ai/tasks";
import { ago } from "@/lib/format";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Resume" };

export default async function ResumePage({ searchParams }: PageProps<"/resume">) {
  const { version } = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [{ data: resumes }, { data: versions }, { data: skills }] = await Promise.all([
    db.from("resumes").select("id, file_name, raw_text, parsed, is_primary, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    db.from("resume_versions").select("id, label, created_at, resume_id, job_id").eq("user_id", user.id).order("created_at", { ascending: false }),
    db.from("profile_skills").select("source, skills(name, category)").eq("user_id", user.id),
  ]);
  const primary = resumes?.find((r) => r.is_primary) ?? resumes?.[0];
  const parsed = primary?.parsed as ParsedResume | null;
  const selectedId = typeof version === "string" ? version : null;
  const { data: selected } = selectedId
    ? await db.from("resume_versions").select("id, label, content, resume_id").eq("id", selectedId).eq("user_id", user.id).maybeSingle()
    : { data: null };
  const selectedResume = selected ? resumes?.find((r) => r.id === selected.resume_id) : null;
  const contact = [parsed?.email, parsed?.phone, parsed?.location, ...(parsed?.links ?? []).map((l) => l.url)].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        eyebrow="Resume"
        title={<>Your resume, <span className="serif-em">honestly</span> tailored.</>}
        sub="Upload once. FRIDAY extracts your skills to rank every opportunity, then drafts job-specific versions that only reorder and emphasize what you actually did."
      />

      {selected && selectedResume ? (
        <section className="mb-16 flex flex-col gap-5">
          <SectionHeader eyebrow="Tailored version" title={selected.label} action={<Link href="/resume" className="text-[13px] text-muted hover:text-text">Close</Link>} />
          <VersionView label={selected.label} tailored={(selected.content as { tailored: Parameters<typeof VersionView>[0]["tailored"] }).tailored} original={selectedResume.raw_text} name={parsed?.name ?? null} contact={contact} />
        </section>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-6">
          <ResumeUpload hasResume={Boolean(primary)} />
          {!!resumes?.length && (
            <Card className="flex flex-col divide-y-[0.5px] divide-hairline-strong">
              <Label className="px-5 pb-2 pt-4">Uploads</Label>
              {resumes.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0 truncate text-[13.5px]">{r.file_name}</span>
                  <span className="label shrink-0">{r.is_primary ? "primary" : ago(r.created_at)}</span>
                </div>
              ))}
            </Card>
          )}
          <Card className="flex flex-col gap-3 p-5">
            <Label>Tailored versions</Label>
            {versions?.length ? (
              <ul className="flex flex-col gap-1">
                {versions.map((v) => (
                  <li key={v.id}>
                    <Link href={`/resume?version=${v.id}`} className={cx("flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-[rgb(var(--ink)/.05)]", v.id === selectedId && "bg-[rgb(var(--ink)/.06)]")}>
                      <span className="truncate">{v.label}</span>
                      <span className="label shrink-0">{ago(v.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">Open any opportunity and choose “Tailor my resume”.</p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <SectionHeader eyebrow="Used for matching" title="Your skills" action={<Link href="/settings#skills" className="text-[13px] text-muted hover:text-text">Edit</Link>} />
            <div className="flex flex-wrap gap-1.5">
              {skills?.length ? skills.map((s) => {
                const k = s.skills as unknown as { name: string } | null;
                return k ? <Chip key={k.name} tone={s.source === "resume" ? "moss" : "neutral"}>{k.name}</Chip> : null;
              }) : <p className="text-[13.5px] text-muted">No skills yet — upload a resume or add them in Settings.</p>}
            </div>
            {!!skills?.length && <p className="text-[12px] text-dim"><span className="text-moss">Green</span> came from your resume; neutral ones you added yourself.</p>}
          </section>

          {parsed && (
            <Reveal as="section" className="flex flex-col gap-4">
              <SectionHeader eyebrow="Extracted from your resume" title="What FRIDAY read" />
              <div className="grid gap-3 md:grid-cols-2">
                <Card className="flex flex-col gap-3 p-5">
                  <Label>Experience</Label>
                  {parsed.experience.length ? parsed.experience.map((e, i) => (
                    <div key={i}>
                      <p className="text-[14px]">{e.title}</p>
                      <p className="text-[12.5px] text-muted">{e.organization}{e.start ? ` · ${e.start}${e.end ? ` – ${e.end}` : ""}` : ""}</p>
                    </div>
                  )) : <p className="text-[13px] text-muted">None listed.</p>}
                </Card>
                <Card className="flex flex-col gap-3 p-5">
                  <Label>Projects</Label>
                  {parsed.projects.length ? parsed.projects.map((p, i) => (
                    <div key={i}>
                      <p className="text-[14px]">{p.name}</p>
                      <p className="text-[12.5px] text-muted">{p.technologies.join(", ")}</p>
                    </div>
                  )) : <p className="text-[13px] text-muted">None listed.</p>}
                </Card>
                <Card className="flex flex-col gap-3 p-5 md:col-span-2">
                  <Label>Education</Label>
                  {parsed.education.map((e, i) => (
                    <p key={i} className="text-[14px]">{e.school} <span className="text-muted">— {[e.degree, e.field].filter(Boolean).join(", ")}{e.end ? ` · ${e.end}` : ""}{e.gpa ? ` · GPA ${e.gpa}` : ""}</span></p>
                  ))}
                </Card>
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </>
  );
}
