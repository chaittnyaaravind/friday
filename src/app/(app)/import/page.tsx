import { ImportDialog } from "@/components/actions";
import { BookmarkletCard } from "@/components/bookmarklet";
import { PageHeader } from "@/components/ui";
import { CAPTURE_LIMITS, clip, sourceFromUrl } from "@/lib/discovery/capture";

export const metadata = { title: "Import" };

/** Landing page for the "Send to FRIDAY" bookmarklet: shows how to install it, and — when it was just clicked on a job — the pre-filled import to confirm. */
export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  const url = clip(sp.url, CAPTURE_LIMITS.url);
  const title = clip(sp.title, CAPTURE_LIMITS.title);
  const captured = /^https?:\/\//i.test(url) && title.length >= 2;

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title={<>One click, <span className="serif-em">any</span> listing.</>}
        sub="Bring in jobs from Handshake, LinkedIn, Indeed or an employer site without copying and pasting. You always review before anything is saved."
        actions={<ImportDialog defaultSource="other" trigger="Import manually" />}
      />
      {captured && (
        <ImportDialog
          defaultOpen
          trigger="Review captured listing"
          initial={{
            url,
            title,
            company: clip(sp.company, CAPTURE_LIMITS.company),
            location: clip(sp.location, CAPTURE_LIMITS.location),
            description: clip(sp.description, CAPTURE_LIMITS.description),
            source: sourceFromUrl(url),
          }}
        />
      )}
      <BookmarkletCard />
    </>
  );
}
