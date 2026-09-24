import { ImportDialog, RunAgentButton } from "@/components/actions";
import { Feed } from "@/components/feed";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Discover" };

export default async function Discover({ searchParams }: PageProps<"/discover">) {
  return (
    <>
      <PageHeader
        eyebrow="Discover"
        title={<>Every opportunity, <span className="serif-em">verified</span>.</>}
        sub="SJSU on-campus jobs, Silicon Valley internships and student-friendly roles from official employer sources — deduplicated, ranked for you, and re-checked daily."
        actions={<><ImportDialog defaultSource="linkedin" /><RunAgentButton /></>}
      />
      <Feed searchParams={await searchParams} empty={{ title: "No opportunities match these filters", body: "Clear a filter or two, or run FRIDAY to check every source again." }} />
    </>
  );
}
