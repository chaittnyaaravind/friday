import { ArrowUpRight } from "lucide-react";
import { ImportDialog, RunAgentButton } from "@/components/actions";
import { Feed } from "@/components/feed";
import { Card, Label, Notice, PageHeader } from "@/components/ui";
import { SJSU_LINKS } from "@/lib/discovery/registry";
import { ISSS_NOTICE, ISSS_ON_CAMPUS_URL } from "@/lib/domain/match";
import { loadSourceHealthForScopes } from "@/lib/data/source-status";
import { CAMPUS_NOT_COVERED } from "@/lib/domain/campus";
import { minutesAgoLabel, minutesSince } from "@/lib/discovery/health";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "SJSU On-Campus" };

export default async function SjsuJobs({ searchParams }: PageProps<"/sjsu">) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = await createSupabaseServer();
  const [{ data: profile }, { data: pages }] = await Promise.all([
    db.from("profiles").select("work_authorization").eq("id", user.id).single(),
    db.from("companies").select("slug, name, careers_url, last_crawled_at").eq("is_sjsu", true).eq("discoverable", true).order("name"),
  ]);
  const health = await loadSourceHealthForScopes(db, (pages ?? []).map((p) => p.slug as string));

  return (
    <>
      <PageHeader
        eyebrow="SJSU On-Campus"
        title={<>Work on <span className="serif-em">campus</span>.</>}
        sub="Student assistant, research, lab, library and peer-educator jobs — read from SJSU's official hiring pages and the Student Union's and Research Foundation's own job boards. Handshake postings can be imported in one step."
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
          campus
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
            <Label>Sources FRIDAY reads</Label>
            <ul className="flex flex-col gap-2">
              {(pages ?? []).map((p) => {
                // From the recorded check for this page — not from "was it ever crawled".
                const h = health.get(p.slug);
                const failing = (h?.consecutive_failures ?? 0) > 0;
                const label = h?.last_success_at ? `checked ${minutesAgoLabel(minutesSince(h.last_success_at))}` : p.last_crawled_at ? "checked" : "not checked yet";
                return (
                  <li key={p.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <a href={p.careers_url ?? "#"} target="_blank" rel="noopener noreferrer" className="truncate text-muted hover:text-text">{p.name.replace(/^SJSU /, "")}</a>
                    <span className={`label shrink-0 !text-[9.5px] ${failing ? "!text-amber" : ""}`}>{failing ? `failing · ${label}` : label}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <Label>Campus employers FRIDAY does not read</Label>
            <p className="text-[12.5px] leading-snug text-muted">A gap in FRIDAY&apos;s coverage, not a sign these employers have no jobs. Check them directly.</p>
            <ul className="flex flex-col gap-3">
              {CAMPUS_NOT_COVERED.map((c) => (
                <li key={c.name} className="flex flex-col gap-0.5 text-[13px]">
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 text-text hover:underline">{c.name}<ArrowUpRight size={13} className="shrink-0 text-dim" /></a>
                  <span className="text-[12px] leading-snug text-muted">{c.reason} <span className="text-dim">Checked {c.checkedOn}.</span></span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
