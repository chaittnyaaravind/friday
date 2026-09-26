/**
 * Export a reviewed ResumeDoc to PDF (pdf-lib) or DOCX (docx). Both render exactly the
 * document the user approved — no generated text, no hidden layers, no custom metadata.
 * Every template is single column, standard fonts, real text (ATS-readable), no images or
 * tables; a template changes presentation only (see ./templates).
 */
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { templateById, type TemplateId } from "./templates";
import type { ResumeDoc } from "./types";

// ───────────────────────── PDF ─────────────────────────

const PAGE = { w: 612, h: 792 };
const INK = rgb(0.08, 0.08, 0.08);
const SOFT = rgb(0.32, 0.32, 0.32);
const FAINT = rgb(0.72, 0.72, 0.72);

export async function renderPdf(doc: ResumeDoc, template: TemplateId = "classic"): Promise<Uint8Array> {
  const T = templateById(template);
  const M = T.margin;
  const pdf = await PDFDocument.create();
  // Deterministic, honest metadata only.
  pdf.setTitle(doc.header.name ? `${doc.header.name} — Resume` : "Resume");
  pdf.setAuthor(doc.header.name || "");
  pdf.setProducer("FRIDAY");
  pdf.setCreator("FRIDAY");
  pdf.setSubject("");
  pdf.setKeywords([]);

  const serif = T.font === "serif";
  const reg = await pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await pdf.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  const W = PAGE.w - M.x * 2;
  const accent = rgb(...T.accent);

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M.top;
  const need = (h: number) => {
    if (y - h < M.bottom) {
      page = pdf.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M.top;
    }
  };
  const clean = (font: PDFFont, s: string) => {
    const ok = new Set(font.getCharacterSet());
    return [...s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')].map((ch) => (ok.has(ch.codePointAt(0)!) ? ch : ch === "→" ? "->" : "?")).join("");
  };
  const width = (font: PDFFont, s: string, size: number) => font.widthOfTextAtSize(clean(font, s), size);
  // Every string is drawn as ONE text run. Letter-spacing is deliberately not emulated in the PDF
  // (per-glyph drawing makes ATS parsers read "E D U C A T I O N"); tracking applies to DOCX only.
  const draw = (s: string, x: number, size: number, font: PDFFont, color = INK) => page.drawText(clean(font, s), { x, y, size, font, color });
  const wrap = (s: string, font: PDFFont, size: number, max: number) => {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (width(font, next, size) > max && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const para = (s: string, x: number, size: number, font: PDFFont, max: number, lead = size * 1.32) => {
    for (const l of wrap(s, font, size, max)) {
      need(lead);
      draw(l, x, size, font);
      y -= lead;
    }
  };
  const alignX = (text: string, font: PDFFont, size: number) => (T.header.align === "center" ? (PAGE.w - width(font, text, size)) / 2 : M.x);

  const nameFont = T.header.nameBold ? bold : reg;
  if (doc.header.name) {
    need(26);
    draw(doc.header.name, alignX(doc.header.name, nameFont, T.header.name), T.header.name, nameFont);
    y -= T.header.nameGap;
  }
  if (doc.header.contact.some((c) => c.trim())) {
    for (const l of wrap(doc.header.contact.filter((c) => c.trim()).join("  |  "), reg, T.header.contact, W)) {
      need(12);
      draw(l, alignX(l, reg, T.header.contact), T.header.contact, reg, SOFT);
      y -= T.header.contactLead;
    }
  }
  y -= 6;

  for (const s of doc.sections) {
    need(30);
    y -= T.section.before;
    const title = s.title.toUpperCase();
    draw(title, M.x, T.section.size, T.section.style === "plain" ? reg : bold, T.section.style === "accent" ? accent : T.section.style === "plain" ? SOFT : INK);
    if (T.section.style !== "plain") {
      page.drawLine({ start: { x: M.x, y: y - 3.5 }, end: { x: PAGE.w - M.x, y: y - 3.5 }, thickness: T.section.style === "accent" ? 0.5 : 0.6, color: T.section.style === "accent" ? FAINT : SOFT });
    }
    y -= T.section.after;
    for (const e of s.entries) {
      need(28);
      const metaW = e.meta ? width(reg, e.meta, T.entry.meta) : 0;
      const headLines = wrap(e.heading, bold, T.entry.head, W - metaW - 12);
      draw(headLines[0] ?? "", M.x, T.entry.head, bold);
      if (e.meta) draw(e.meta, PAGE.w - M.x - metaW, T.entry.meta, reg, SOFT);
      y -= T.entry.lead;
      for (const extra of headLines.slice(1)) { need(13); draw(extra, M.x, T.entry.head, bold); y -= T.entry.lead; }
      if (e.subheading) para(e.subheading, M.x, T.entry.sub, ital, W, T.entry.subLead);
      for (const b of e.bullets) {
        const lines = wrap(b.text, reg, T.body.size, W - 14);
        lines.forEach((l, i) => {
          need(T.body.lead);
          if (i === 0) draw("•", M.x + 3, T.body.size, reg);
          draw(l, M.x + 14, T.body.size, reg);
          y -= T.body.lead;
        });
      }
      y -= T.entry.gap;
    }
    for (const l of s.lines) {
      const m = l.text.match(/^([^:]{1,40}):\s(.+)$/);
      if (m && s.kind === "skills") {
        // The separating space is real text in the value run, so ATS parsers read "Label: value".
        const label = `${m[1]}:`;
        const lw = width(bold, label, T.body.size);
        const lines = wrap(m[2], reg, T.body.size, W - lw - width(reg, " ", T.body.size));
        lines.forEach((t, i) => {
          need(T.body.lead);
          if (i === 0) draw(label, M.x, T.body.size, bold);
          draw(` ${t}`, M.x + lw, T.body.size, reg);
          y -= T.body.lead;
        });
      } else para(l.text, M.x, T.body.size, reg, W, T.body.lead);
    }
    y -= T.sectionGap;
  }
  return pdf.save();
}

// ───────────────────────── DOCX ─────────────────────────

export async function renderDocx(doc: ResumeDoc, template: TemplateId = "classic"): Promise<Buffer> {
  const T = templateById(template);
  const FONT = T.font === "serif" ? "Times New Roman" : "Calibri";
  const hp = (pt: number) => Math.round(pt * 2); // docx sizes are half-points
  const hex = (c: [number, number, number]) => c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string; spacing?: number } = {}) =>
    new TextRun({ text, font: FONT, size: o.size ?? hp(T.body.size), bold: o.bold, italics: o.italics, color: o.color, characterSpacing: o.spacing });
  const RIGHT = [{ type: TabStopType.RIGHT, position: 10080 }];
  const align = T.header.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const kids: Paragraph[] = [];
  if (doc.header.name) kids.push(new Paragraph({ alignment: align, spacing: { after: 40 }, children: [run(doc.header.name, { bold: T.header.nameBold, size: hp(T.header.name) })] }));
  if (doc.header.contact.some((c) => c.trim())) kids.push(new Paragraph({ alignment: align, spacing: { after: 160 }, children: [run(doc.header.contact.filter((c) => c.trim()).join(" | "), { size: hp(T.header.contact), color: "444444" })] }));
  for (const s of doc.sections) {
    const style = T.section.style;
    kids.push(new Paragraph({
      spacing: { before: 160, after: 80 },
      ...(style === "plain" ? {} : { border: { bottom: { style: BorderStyle.SINGLE, size: style === "accent" ? 4 : 6, color: style === "accent" ? "BBBBBB" : "555555", space: 2 } } }),
      children: [run(s.title.toUpperCase(), { bold: style !== "plain", size: hp(T.section.size), color: style === "accent" ? hex(T.accent) : style === "plain" ? "555555" : undefined, spacing: Math.round(T.section.tracking * 10) })],
    }));
    for (const e of s.entries) {
      kids.push(new Paragraph({ tabStops: RIGHT, spacing: { before: 60 }, children: [run(e.heading, { bold: true, size: hp(T.entry.head) }), ...(e.meta ? [run(`\t${e.meta}`, { size: hp(T.entry.meta), color: "444444" })] : [])] }));
      if (e.subheading) kids.push(new Paragraph({ children: [run(e.subheading, { italics: true, size: hp(T.entry.sub) })] }));
      for (const b of e.bullets) kids.push(new Paragraph({ bullet: { level: 0 }, children: [run(b.text)] }));
    }
    for (const l of s.lines) {
      const m = s.kind === "skills" ? l.text.match(/^([^:]{1,40}):\s(.+)$/) : null;
      kids.push(new Paragraph({ spacing: { after: 40 }, children: m ? [run(`${m[1]}: `, { bold: true }), run(m[2])] : [run(l.text)] }));
    }
  }
  const d = new Document({
    creator: "FRIDAY",
    title: doc.header.name ? `${doc.header.name} — Resume` : "Resume",
    description: "",
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children: kids }],
  });
  return Packer.toBuffer(d);
}
