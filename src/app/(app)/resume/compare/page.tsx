import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, cx } from "@/components/ui";
import { diffLines } from "@/lib/resume/diff";
import { docToText } from "@/lib/resume/generate";
import type { ResumeDoc } from "@/lib/resume/types";
import { createSupabaseServer, requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Compare resumes" };

export default async function ComparePage({ searchParams }: PageProps<"/resume/compare">) {
  const { a, b } = await searchParams;
  if (typeof a !== "string" || typeof b !== "string") notFound();
  const user = await requireUser();
  const db = await createSupabaseServer();
  const { data } = await db.from("resume_versions").select("id, label, kind, content").eq("user_id", user.id).in("id", [a, b]);
  const va = data?.find((v) => v.id === a);
  const vb = data?.find((v) => v.id === b);
  if (!va || !vb || va.kind === "legacy" || vb.kind === "legacy") notFound();

  const lines = (d: ResumeDoc) => docToText(d).split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const diff = diffLines(lines(va.content as ResumeDoc), lines(vb.content as ResumeDoc));
  const changed = diff.filter((d) => d.kind !== "same").length;

  return (
    <>
      <PageHeader
        eyebrow="Resume · Compare"
        title={<>{va.label} <span className="serif-em">vs</span> {vb.label}</>}
        sub={changed ? `${changed} line${changed === 1 ? "" : "s"} differ.` : "These versions are identical."}
        actions={<Link href="/resume" className="text-[13px] text-muted hover:text-text">← All resumes</Link>}
      />
      <Card className="overflow-x-auto p-2 font-mono text-[12.5px] leading-[1.6]">
        {diff.map((d, i) => (
          <div key={i} className={cx("whitespace-pre-wrap rounded px-3", d.kind === "added" && "bg-moss-soft text-moss", d.kind === "removed" && "bg-accent-soft text-accent line-through decoration-[0.5px]", d.kind === "same" && "text-muted")}>
            <span className="mr-3 select-none opacity-60">{d.kind === "added" ? "+" : d.kind === "removed" ? "−" : " "}</span>{d.text}
          </div>
        ))}
      </Card>
      <p className="mt-3 text-[12px] text-dim"><span className="text-accent">−</span> only in {va.label} · <span className="text-moss">+</span> only in {vb.label}</p>
    </>
  );
}
