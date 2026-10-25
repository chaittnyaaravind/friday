import mammoth from "mammoth";
import { extractText } from "unpdf";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { layoutPdf, renderDocx, renderPdf } from "./export";
import { DEFAULT_TEMPLATE, isTemplateId, templateById, TEMPLATES } from "./templates";
import type { ResumeDoc } from "./types";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc: ResumeDoc = {
  version: 1,
  header: { name: "Ada Student", contact: ["San Jose, CA", "ada@example.com"], origin: "user" },
  sections: [
    { id: "edu", kind: "education", title: "Education", lines: [], entries: [{ id: "e0", sourceItemId: null, heading: "San Jose State University", subheading: "B.S. Computer Science", meta: "Aug 2022 – May 2026", origin: "user", bullets: [] }] },
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Software Intern", subheading: "Campus IT", meta: "Jun 2025 – Aug 2025", origin: "user", bullets: [line("b1", "Built REST APIs with Python"), line("b2", "Wrote SQL reports for the help desk")] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, SQL")] },
  ],
};
const words = (s: string) => s.replace(/[•\s]+/g, " ").trim().toLowerCase();

describe("templates", () => {
  it("ships the five requested templates", () => {
    expect(TEMPLATES.map((t) => t.label)).toEqual(["Classic ATS", "Modern ATS", "Software Engineer", "Student / New Grad", "Minimal"]);
    expect(isTemplateId("modern")).toBe(true);
    expect(isTemplateId("fancy")).toBe(false);
    expect(templateById("nope").id).toBe(DEFAULT_TEMPLATE);
  });

  it("changing the template never changes the content: every template's PDF and DOCX carry the same text", async () => {
    const pdfText = new Set<string>();
    const docxText = new Set<string>();
    for (const t of TEMPLATES) {
      pdfText.add(words((await extractText(await renderPdf(doc, t.id), { mergePages: true })).text));
      docxText.add(words((await mammoth.extractRawText({ buffer: await renderDocx(doc, t.id) })).value));
    }
    expect(pdfText.size).toBe(1);
    expect(docxText.size).toBe(1);
    expect([...pdfText][0]).toContain("built rest apis with python");
    expect([...pdfText][0]).toContain("languages: python, sql");
  });

  it("the default export is the Classic ATS template", async () => {
    const a = (await extractText(await renderPdf(doc), { mergePages: true })).text;
    const b = (await extractText(await renderPdf(doc, "classic"), { mergePages: true })).text;
    expect(a).toBe(b);
  });

  it("templates differ in presentation (the PDFs are not byte-identical)", async () => {
    const sizes = new Set<number>();
    for (const t of TEMPLATES) sizes.add((await renderPdf(doc, t.id)).byteLength);
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("does not mutate the document it renders", async () => {
    const before = JSON.stringify(doc);
    await renderPdf(doc, "student");
    await renderDocx(doc, "minimal");
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("one-page fit", () => {
  const withBullets = (n: number): ResumeDoc => ({
    ...doc,
    sections: [...doc.sections, { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "Project", subheading: "TypeScript", meta: "2026", origin: "user", bullets: Array.from({ length: n }, (_, i) => line(`p${i}`, `Built feature number ${i} of a browser app that sends files directly between two devices over WebRTC`)) }] }],
  });
  const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

  it("tightens a resume that barely runs over onto one page, keeping every word", async () => {
    const T = templateById("classic");
    let n = 10;
    while ((await layoutPdf(withBullets(n), T)).pages === 1) n++; // the first length that overflows at the template's own size
    const bytes = await renderPdf(withBullets(n));
    expect(await pages(bytes)).toBe(1);
    expect(words((await extractText(bytes, { mergePages: true })).text)).toContain(`feature number ${n - 1} of`);
  });

  it("never shrinks past the floor: a long resume keeps the template's size across pages", async () => {
    const bytes = await renderPdf(withBullets(80));
    expect(await pages(bytes)).toBeGreaterThan(1);
    expect(await pages(bytes)).toBe((await layoutPdf(withBullets(80), templateById("classic"))).pages);
  });
});
