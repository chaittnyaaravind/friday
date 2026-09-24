import { ArrowUpRight } from "lucide-react";
import { ImportDialog, RunAgentButton } from "@/components/actions";
import { Feed } from "@/components/feed";
import { Card, Label, Notice, PageHeader } from "@/components/ui";
import { SJSU_LINKS } from "@/lib/discovery/registry";
import { ISSS_NOTICE, ISSS_ON_CAMPUS_URL } from "@/lib/domain/match";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "SJSU On-Campus" };

export default async function SjsuJobs({ searchParams }: PageProps<"/sjsu">) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [{ data: profile }, { data: pages }] = await Promise.all([
    db.from("profiles").select("work_authorization").eq("id", user.id).single(),
    db.from("companies").select("name, careers_url, last_crawled_at").eq("is_sjsu", true).eq("discoverable", true).order("name"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="SJSU On-Campus"
        title={<>Work on <span className="serif-em">campus</span>.</>}
        sub="Student assistant, library, tutoring, lab and department jobs — read directly from official SJSU hiring pages. Handshake postings can be imported in one step."
        actions={<><ImportDialog onCampus defaultSource="handshake" trigger="Import from Handshake" /><RunAgentButton scope="sjsu" label="Check SJSU pages" /></>}
      />

      {profile?.work_authorization === "f1" && (
        <Notice tone="moss" title="On-campus employment is generally the most accessible option for F-1 students" className="mb-8">
          Hour limits apply during the academic term. {ISSS_NOTICE}{" "}
          <a className="underline decoration-hairline-strong underline-offset-4 hover:text-text" href={ISSS_ON_CAMPUS_URL} target="_blank" rel="noopener noreferrer">ISSS on-campus employment →</a>
        </Notice>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
        <Feed
          searchParams={sp}
          preset={{ onCampus: true, sort: sp.sort ? undefined : "new" }}
          lockTypes
          empty={{
            title: "No on-campus postings on official pages right now",
            body: "Most SJSU student jobs are posted on Handshake. Open Handshake, then import any listing here so FRIDAY can track it with everything else.",
            action: <ImportDialog onCampus defaultSource="handshake" trigger="Import from Handshake" />,
          }}
        />
        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-1 p-2">
            <Label className="px-3 pb-1 pt-2">Where SJSU posts jobs</Label>
            {SJSU_LINKS.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="group flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-[rgb(var(--ink)/.05)]">
                <span className="flex items-center justify-between text-[14px]">{l.label}<ArrowUpRight size={14} className="text-dim group-hover:text-text" /></span>
                <span className="text-[12px] leading-snug text-muted">{l.note}</span>
              </a>
            ))}
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <Label>Official pages FRIDAY checks daily</Label>
            <ul className="flex flex-col gap-2">
              {(pages ?? []).map((p) => (
                <li key={p.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <a href={p.careers_url ?? "#"} target="_blank" rel="noopener noreferrer" className="truncate text-muted hover:text-text">{p.name.replace(/^SJSU /, "")}</a>
                  <span className="label shrink-0 !text-[9.5px]">{p.last_crawled_at ? "checked" : "pending"}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
