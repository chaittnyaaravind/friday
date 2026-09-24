import Link from "next/link";
import { notFound } from "next/navigation";
import { TailorReview } from "@/components/resume/tailor";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { loadProfileItems, loadTailorJob } from "@/lib/resume/profile";
import { tailorProposal } from "@/lib/resume/tailor";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Tailor resume" };

export default async function TailorPage({ params }: PageProps<"/resume/tailor/[jobId]">) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [items, job] = await Promise.all([loadProfileItems(db, user.id), loadTailorJob(db, jobId).catch(() => null)]);
  if (!job) notFound();

  const header = (
    <PageHeader
      eyebrow={`Tailor · ${job.company || "Opportunity"}`}
      title={<>{job.title}</>}
      sub="FRIDAY compares the posting with your confirmed profile. It can reorder and choose what to show — it never adds a skill or experience you haven't confirmed."
      actions={<Link href={`/jobs/${job.id}`} className="text-[13px] text-muted hover:text-text">← Back to the role</Link>}
    />
  );

  if (!items.some((i) => i.status !== "requires_confirmation")) {
    return (
      <>
        {header}
        <EmptyState title="Review your profile first" body="Tailoring only uses information you've confirmed. Upload your resume and check what FRIDAY found." action={<LinkButton href="/resume" variant="primary">Go to Resume</LinkButton>} />
      </>
    );
  }

  return (
    <>
      {header}
      <TailorReview proposal={tailorProposal(items, job)} />
    </>
  );
}
