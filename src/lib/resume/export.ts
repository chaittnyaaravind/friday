/**
 * Export a reviewed ResumeDoc to PDF (pdf-lib) or DOCX (docx). Both render exactly the
 * document the user approved — no generated text, no hidden layers, no custom metadata.
 * Template: single column, standard fonts, real text (ATS-readable), no images or tables.
 */
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ResumeDoc } from "./types";

// ───────────────────────── PDF ─────────────────────────

const PAGE = { w: 612, h: 792 };
const M = { x: 50, top: 48, bottom: 48 };
const INK = rgb(0.08, 0.08, 0.08);
const SOFT = rgb(0.32, 0.32, 0.32);

export async function renderPdf(doc: ResumeDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Deterministic, honest metadata only.
  pdf.setTitle(doc.header.name ? `${doc.header.name} — Resume` : "Resume");
  pdf.setAuthor(doc.header.name || "");
  pdf.setProducer("FRIDAY");
  pdf.setCreator("FRIDAY");
  pdf.setSubject("");
  pdf.setKeywords([]);

  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const W = PAGE.w - M.x * 2;

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

  if (doc.header.name) {
    need(26);
    draw(doc.header.name, (PAGE.w - width(bold, doc.header.name, 19)) / 2, 19, bold);
    y -= 17;
  }
  if (doc.header.contact.some((c) => c.trim())) {
    for (const l of wrap(doc.header.contact.filter((c) => c.trim()).join("  |  "), reg, 9.5, W)) {
      need(12);
      draw(l, (PAGE.w - width(reg, l, 9.5)) / 2, 9.5, reg, SOFT);
      y -= 12;
    }
  }
  y -= 6;

  for (const s of doc.sections) {
    need(30);
    y -= 6;
    draw(s.title.toUpperCase(), M.x, 10.5, bold);
    page.drawLine({ start: { x: M.x, y: y - 3.5 }, end: { x: PAGE.w - M.x, y: y - 3.5 }, thickness: 0.6, color: SOFT });
    y -= 16;
    for (const e of s.entries) {
      need(28);
      const metaW = e.meta ? width(reg, e.meta, 9.5) : 0;
      const headLines = wrap(e.heading, bold, 10.5, W - metaW - 12);
      draw(headLines[0] ?? "", M.x, 10.5, bold);
      if (e.meta) draw(e.meta, PAGE.w - M.x - metaW, 9.5, reg, SOFT);
      y -= 13;
      for (const extra of headLines.slice(1)) { need(13); draw(extra, M.x, 10.5, bold); y -= 13; }
      if (e.subheading) para(e.subheading, M.x, 10, ital, W, 12.5);
      for (const b of e.bullets) {
        const lines = wrap(b.text, reg, 10, W - 14);
        lines.forEach((l, i) => {
          need(13);
          if (i === 0) draw("•", M.x + 3, 10, reg);
          draw(l, M.x + 14, 10, reg);
          y -= 13;
        });
      }
      y -= 5;
    }
    for (const l of s.lines) {
      const m = l.text.match(/^([^:]{1,40}):\s(.+)$/);
      if (m && s.kind === "skills") {
        // The separating space is real text in the value run, so ATS parsers read "Label: value".
        const label = `${m[1]}:`;
        const lw = width(bold, label, 10);
        const lines = wrap(m[2], reg, 10, W - lw - width(reg, " ", 10));
        lines.forEach((t, i) => {
          need(13);
          if (i === 0) draw(label, M.x, 10, bold);
          draw(` ${t}`, M.x + lw, 10, reg);
          y -= 13;
        });
      } else para(l.text, M.x, 10, reg, W, 13);
    }
    y -= 2;
  }
  return pdf.save();
}

// ───────────────────────── DOCX ─────────────────────────

export async function renderDocx(doc: ResumeDoc): Promise<Buffer> {
  const FONT = "Calibri";
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color });
  const RIGHT = [{ type: TabStopType.RIGHT, position: 10080 }];
  const kids: Paragraph[] = [];
  if (doc.header.name) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [run(doc.header.name, { bold: true, size: 36 })] }));
  if (doc.header.contact.some((c) => c.trim())) kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(doc.header.contact.filter((c) => c.trim()).join(" | "), { size: 18, color: "444444" })] }));
  for (const s of doc.sections) {
    kids.push(new Paragraph({
      spacing: { before: 160, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "555555", space: 2 } },
      children: [run(s.title.toUpperCase(), { bold: true, size: 21 })],
    }));
    for (const e of s.entries) {
      kids.push(new Paragraph({ tabStops: RIGHT, spacing: { before: 60 }, children: [run(e.heading, { bold: true, size: 21 }), ...(e.meta ? [run(`\t${e.meta}`, { size: 19, color: "444444" })] : [])] }));
      if (e.subheading) kids.push(new Paragraph({ children: [run(e.subheading, { italics: true })] }));
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
