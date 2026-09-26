"use client";

import { type ReactNode } from "react";
import type { LineRef } from "@/lib/resume/edits";
import { templateById, type TemplateId } from "@/lib/resume/templates";
import type { DocLine, DocSection, ResumeDoc } from "@/lib/resume/types";
import { cx } from "../ui";

/**
 * Paper preview — the same document, template and proportions as the PDF export. Sizes are
 * in `cqw` of a 612pt Letter page, so the page scales to any width exactly like the file
 * does. Always white, regardless of app theme, like the exported file.
 *
 * When `onSelect` is given, each bullet/line is clickable (click a bullet → inline AI actions).
 */
const PAGE_W = 612;
const PAGE_H = 792;
const cq = (pt: number) => `${((pt / PAGE_W) * 100).toFixed(3)}cqw`;
const INK = "#141414";
const SOFT = "#525252";

type Interaction = {
  selected: string | null;
  flagged?: ReadonlySet<string>;
  accent: string;
  onSelect?: (ref: LineRef) => void;
  renderActions?: (ref: LineRef, kind: DocSection["kind"]) => ReactNode;
};

type Props = {
  doc: ResumeDoc;
  template?: TemplateId;
  className?: string;
  selected?: string | null;
  /** Line ids to underline (e.g. findings from an analysis). */
  flagged?: ReadonlySet<string>;
  onSelect?: (ref: LineRef) => void;
  /** Rendered under the selected line (the inline AI toolbar). */
  renderActions?: (ref: LineRef, kind: DocSection["kind"]) => ReactNode;
};

function Line({ line, sectionId, entryId, kind, ix, children }: { line: DocLine; sectionId: string; entryId: string | null; kind: DocSection["kind"]; ix: Interaction; children: ReactNode }) {
  if (!ix.onSelect) return <>{children}</>;
  const ref: LineRef = { sectionId, entryId, lineId: line.id };
  const isSel = ix.selected === line.id;
  const select = ix.onSelect;
  return (
    <span className="relative block">
      {line.origin === "ai" && <span aria-hidden title="Rewritten with AI — see History" className="absolute -left-[3.2%] top-[0.45em] size-[0.42em] rounded-full" style={{ background: ix.accent }} />}
      <span
        role="button"
        tabIndex={0}
        aria-pressed={isSel}
        onClick={() => select(ref)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(ref); } }}
        className={cx("block cursor-pointer rounded-[2px] outline-none transition-colors duration-150 hover:bg-[#fff3ea] focus-visible:bg-[#fff3ea]", isSel && "bg-[#ffe6d2] hover:bg-[#ffe6d2]", ix.flagged?.has(line.id) && "underline decoration-[#d08a1f] decoration-dotted underline-offset-[0.22em]")}
      >
        {children}
      </span>
      {isSel && ix.renderActions && <span className="absolute left-0 top-full z-30 mt-1 block w-max max-w-full text-left [font-family:var(--font-sans)] [font-size:13px] [font-weight:400] [font-style:normal] [line-height:1.3]">{ix.renderActions(ref, kind)}</span>}
    </span>
  );
}

export function ResumePreview({ doc, template = "classic", className, selected = null, flagged, onSelect, renderActions }: Props) {
  const T = templateById(template);
  const accent = `rgb(${T.accent.map((v) => Math.round(v * 255)).join(" ")})`;
  const head = T.section.style;
  const ix: Interaction = { selected, flagged, accent, onSelect, renderActions };

  return (
    <div className={cx("[container-type:inline-size]", className)}>
      <article
        aria-label="Resume preview"
        className="relative mx-auto w-full bg-white"
        style={{
          color: INK,
          fontFamily: T.font === "serif" ? '"Times New Roman", Times, serif' : "Helvetica, Arial, sans-serif",
          padding: `${cq(T.margin.top)} ${cq(T.margin.x)} ${cq(T.margin.bottom)}`,
          minHeight: cq(PAGE_H),
          borderRadius: 4,
          boxShadow: "0 1px 1px rgb(38 26 18 / .06), 0 8px 12px -6px rgb(38 26 18 / .18), 0 34px 60px -28px rgb(0 0 0 / .55)",
          // A faint rule where each Letter page would end in the PDF.
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${cq(PAGE_H)} - 1px), rgb(20 20 20 / .13) calc(${cq(PAGE_H)} - 1px), rgb(20 20 20 / .13) ${cq(PAGE_H)})`,
        }}
      >
        {doc.header.name && <h1 style={{ margin: 0, textAlign: T.header.align, fontSize: cq(T.header.name), fontWeight: T.header.nameBold ? 700 : 400, lineHeight: 1.15 }}>{doc.header.name}</h1>}
        {!!doc.header.contact.length && <p style={{ margin: `${cq(3)} 0 0`, textAlign: T.header.align, fontSize: cq(T.header.contact), color: SOFT }}>{doc.header.contact.join("  |  ")}</p>}

        {doc.sections.map((s) => (
          <section key={s.id} style={{ marginTop: cq(T.section.before + 8) }}>
            <h2
              style={{
                margin: 0, fontSize: cq(T.section.size), fontWeight: head === "plain" ? 400 : 700, textTransform: "uppercase",
                color: head === "accent" ? accent : head === "plain" ? SOFT : INK,
                borderBottom: head === "plain" ? "none" : `1px solid ${head === "accent" ? "#bbb" : "#555"}`, paddingBottom: cq(2.5),
              }}
            >
              {s.title}
            </h2>

            {s.entries.map((e) => (
              <div key={e.id} style={{ marginTop: cq(T.entry.gap + 3) }}>
                <div className="flex items-baseline justify-between gap-3">
                  <span style={{ fontSize: cq(T.entry.head), fontWeight: 700 }}>{e.heading}</span>
                  {e.meta && <span className="shrink-0" style={{ fontSize: cq(T.entry.meta), color: SOFT }}>{e.meta}</span>}
                </div>
                {e.subheading && <p style={{ margin: 0, fontSize: cq(T.entry.sub), fontStyle: "italic" }}>{e.subheading}</p>}
                {!!e.bullets.length && (
                  <ul style={{ margin: `${cq(1.5)} 0 0`, paddingLeft: cq(14), fontSize: cq(T.body.size), lineHeight: T.body.lead / T.body.size, listStyleType: "disc" }}>
                    {e.bullets.map((b) => (
                      <li key={b.id}>
                        <Line line={b} sectionId={s.id} entryId={e.id} kind={s.kind} ix={ix}>{b.text}</Line>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {s.lines.map((l) => {
              const m = s.kind === "skills" ? l.text.match(/^([^:]{1,40}):\s(.+)$/) : null;
              return (
                <div key={l.id} style={{ margin: `${cq(3)} 0 0`, fontSize: cq(T.body.size), lineHeight: T.body.lead / T.body.size }}>
                  <Line line={l} sectionId={s.id} entryId={null} kind={s.kind} ix={ix}>
                    {m ? <><b>{m[1]}:</b> {m[2]}</> : l.text}
                  </Line>
                </div>
              );
            })}
          </section>
        ))}
      </article>
    </div>
  );
}
