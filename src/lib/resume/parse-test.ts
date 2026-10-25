/**
 * The ATS parse test: render the exact PDF the student will send, read it back as plain text the way an applicant tracking
 * system does, and check what came out. Résumé checkers usually SIMULATE this; here it is the real file, the real text
 * layer, and plain pass/fail checks anyone can verify against the extracted text shown with them.
 *
 *   one_page   the file is one page (what campus and entry-level screeners expect)
 *   sections   every section heading is found, in the document's order
 *   entries    every entry's title is found, with its date on the same or the next text line
 *   lines      every line of the resume reached the text layer intact (no dropped or garbled characters)
 *   contact    the email and phone come out exactly as written
 */
import { PDFDocument } from "pdf-lib";
import { extractText } from "unpdf";
import { renderPdf } from "./export";
import type { TemplateId } from "./templates";
import type { ResumeDoc } from "./types";

export type ParseCheck = { id: "one_page" | "sections" | "entries" | "lines" | "contact"; label: string; ok: boolean; detail: string; problems: string[] };
export type ParseTest = { ok: boolean; pages: number; checks: ParseCheck[]; text: string };

/** Lowercase letters and digits only, single spaces: line wraps, bullets and punctuation do not affect a match. */
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9@]+/g, " ").trim();
/** Every character kept (so a symbol turned into "?" is caught); only whitespace, case and the renderer's quote substitution even out. */
const exact = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

export async function parseTest(doc: ResumeDoc, template?: TemplateId): Promise<ParseTest> {
  const bytes = await renderPdf(doc, template);
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  // unpdf transfers (detaches) the buffer it is given, so it gets its own copy.
  const { text: raw } = await extractText(new Uint8Array(bytes), { mergePages: true });
  const text = raw.replace(/\r/g, "");
  const flat = norm(text);
  const rows = text.split("\n").map(norm).filter(Boolean);
  const checks: ParseCheck[] = [];

  checks.push({ id: "one_page", label: "One page", ok: pages === 1, detail: pages === 1 ? "The PDF is one page." : `The PDF runs to ${pages} pages; campus screeners expect one.`, problems: [] });

  let at = -1;
  const outOfOrder: string[] = [];
  const missingSections: string[] = [];
  for (const s of doc.sections) {
    const i = flat.indexOf(norm(s.title), at + 1);
    if (i < 0) (flat.includes(norm(s.title)) ? outOfOrder : missingSections).push(s.title);
    else at = i;
  }
  checks.push({ id: "sections", label: "Sections detected in order", ok: !outOfOrder.length && !missingSections.length,
    detail: missingSections.length ? `Not found: ${missingSections.join(", ")}.` : outOfOrder.length ? `Read out of order: ${outOfOrder.join(", ")}.` : `All ${doc.sections.length} headings read back, in order.`, problems: [...missingSections, ...outOfOrder] });

  const entryProblems: string[] = [];
  const entries = doc.sections.flatMap((s) => s.entries);
  // An entry is looked for after its own section heading: "San José State University" may also appear in the summary.
  let from = 0;
  for (const s of doc.sections) {
    const h = rows.findIndex((row, i) => i >= from && row === norm(s.title));
    if (h >= 0) from = h + 1;
    for (const e of s.entries) {
      const head = norm(e.heading);
      const r = rows.findIndex((row, i) => i >= from && head && row.includes(head.slice(0, 40)));
      if (r < 0) { entryProblems.push(`${e.heading}: title not found`); continue; }
      const meta = norm(e.meta);
      if (meta && !rows.slice(r, r + 2).some((row) => row.includes(meta))) entryProblems.push(`${e.heading}: date “${e.meta}” not next to it`);
      from = r + 1;
    }
  }
  checks.push({ id: "entries", label: "Titles and dates stay together", ok: !entryProblems.length,
    detail: entryProblems.length ? `${entryProblems.length} of ${entries.length} entries read wrong.` : `All ${entries.length} entries read back with their dates.`, problems: entryProblems });

  const lines = doc.sections.flatMap((s) => [...s.lines.map((l) => l.text), ...s.entries.flatMap((e) => [e.subheading, ...e.bullets.map((b) => b.text)])]).filter((t) => t.trim());
  const whole = exact(text);
  const lost = lines.filter((t) => !whole.includes(exact(t)));
  checks.push({ id: "lines", label: "Every line readable", ok: !lost.length,
    detail: lost.length ? `${lost.length} of ${lines.length} lines did not come out intact (often a symbol the font cannot encode).` : `All ${lines.length} lines came out intact.`, problems: lost.slice(0, 6).map((t) => t.slice(0, 90)) });

  const contact = doc.header.contact.filter((c) => /@|\d{3}/.test(c));
  const badContact = contact.filter((c) => !text.replace(/\s+/g, " ").includes(c.trim()));
  checks.push({ id: "contact", label: "Email and phone exact", ok: !badContact.length,
    detail: !contact.length ? "No email or phone on the resume." : badContact.length ? `Changed in the text layer: ${badContact.join(", ")}.` : "Email and phone read back exactly.", problems: badContact });

  return { ok: checks.every((c) => c.ok), pages, checks, text: text.slice(0, 12_000) };
}

/** One line for a Telegram card or a list: "ATS parse test passed (1 page · 7 sections · 28 lines)" or what failed. */
export function parseTestLine(t: ParseTest): string {
  if (t.ok) {
    const s = t.checks.find((c) => c.id === "sections")!.detail.match(/\d+/)?.[0];
    const l = t.checks.find((c) => c.id === "lines")!.detail.match(/\d+/)?.[0];
    return `ATS parse test passed (${t.pages} page · ${s} sections · ${l} lines read back intact)`;
  }
  return `ATS parse test: ${t.checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase()).join(", ")} failed`;
}
