import { Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ResumeStatus } from "@/lib/resume/profile";
import { cx } from "../ui";

/** Upload → extract → review → ready, with a direct link to whatever needs attention. */
export function ResumeSteps({ status: s, className }: { status: ResumeStatus; className?: string }) {
  const steps: { label: string; done: boolean; warn?: string; href?: string }[] = [
    { label: "Resume uploaded", done: s.uploaded, href: "/resume" },
    { label: s.extracted ? `${s.extracted} items extracted` : "Information extracted", done: s.extracted > 0, href: "/resume/review" },
    {
      label: "Profile reviewed",
      done: s.reviewed && !s.needsConfirmation,
      warn: s.needsConfirmation ? `${s.needsConfirmation} item${s.needsConfirmation === 1 ? "" : "s"} need${s.needsConfirmation === 1 ? "s" : ""} review` : s.extracted && !s.reviewed ? "Not reviewed yet" : undefined,
      href: "/resume/review",
    },
    { label: "Resume ready", done: Boolean(s.latestVersion), href: s.latestVersion ? `/resume/${s.latestVersion.id}` : "/resume" },
  ];
  return (
    <ol className={cx("flex flex-col gap-2", className)}>
      {steps.map((st) => (
        <li key={st.label}>
          <Link href={st.href ?? "/resume"} className="group flex items-center gap-2.5 text-[14px]">
            {st.warn ? (
              <TriangleAlert size={15} className="shrink-0 text-amber" />
            ) : st.done ? (
              <Check size={15} className="shrink-0 text-moss" />
            ) : (
              <span className="grid size-[15px] shrink-0 place-items-center"><span className="size-1.5 rounded-full bg-hairline-strong" /></span>
            )}
            <span className={cx(st.done || st.warn ? "text-text" : "text-dim", "group-hover:text-accent")}>{st.warn ? `${st.label} — ${st.warn}` : st.label}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
