import { ResumeReview } from "@/components/resume/review";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { loadProfileItems } from "@/lib/resume/profile";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Review your profile" };

export default async function ReviewPage() {
  const user = await requireUser();
  const db = await createSupabaseServer();
  const items = await loadProfileItems(db, user.id);

  return (
    <>
      <PageHeader
        eyebrow="Resume · Review"
        title={<>Here&rsquo;s what FRIDAY <span className="serif-em">found</span>.</>}
        sub="Check every item. Confirm what's right, fix what isn't, delete what shouldn't be there. Only confirmed information is ever used on a resume."
      />
      {items.length ? (
        <ResumeReview initial={items} />
      ) : (
        <EmptyState
          title="Nothing to review yet"
          body="Upload your resume and FRIDAY reads it with its own parser (no AI involved) and lists everything it found here for you to check."
          action={<LinkButton href="/resume" variant="primary">Upload a resume</LinkButton>}
        />
      )}
    </>
  );
}
