import type { ResumeDoc } from "@/lib/resume/types";
import { cx } from "../ui";

/**
 * Paper preview — mirrors the PDF/DOCX template (single column, ATS-friendly).
 * Always rendered on white regardless of app theme, like the exported file.
 */
export function ResumePreview({ doc, className }: { doc: ResumeDoc; className?: string }) {
  return (
    <article
      aria-label="Resume preview"
      className={cx("mx-auto w-full max-w-[816px] bg-white px-[7%] py-[6%] text-[#141414] shadow-[0_30px_60px_-30px_rgb(0_0_0/.6)] [font-family:Helvetica,Arial,sans-serif]", className)}
      style={{ borderRadius: 4 }}
    >
      {doc.header.name && <h1 className="text-center text-[22px] font-bold leading-tight tracking-normal">{doc.header.name}</h1>}
      {!!doc.header.contact.length && <p className="mt-1 text-center text-[11px] text-[#525252]">{doc.header.contact.join("  |  ")}</p>}
      {doc.sections.map((s) => (
        <section key={s.id} className="mt-4">
          <h2 className="border-b border-[#555] pb-0.5 text-[12px] font-bold uppercase tracking-[0.02em]">{s.title}</h2>
          {s.entries.map((e) => (
            <div key={e.id} className="mt-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-bold">{e.heading}</span>
                {e.meta && <span className="shrink-0 text-[11px] text-[#525252]">{e.meta}</span>}
              </div>
              {e.subheading && <p className="text-[12px] italic">{e.subheading}</p>}
              {!!e.bullets.length && (
                <ul className="mt-0.5 list-disc pl-5 text-[12px] leading-[1.45]">
                  {e.bullets.map((b) => <li key={b.id}>{b.text}</li>)}
                </ul>
              )}
            </div>
          ))}
          {s.lines.map((l) => {
            const m = s.kind === "skills" ? l.text.match(/^([^:]{1,40}):\s(.+)$/) : null;
            return (
              <p key={l.id} className="mt-1 text-[12px] leading-[1.45]">
                {m ? <><span className="font-bold">{m[1]}:</span> {m[2]}</> : l.text}
              </p>
            );
          })}
        </section>
      ))}
    </article>
  );
}
