/**
 * Resume templates. A template is presentation only — typeface, sizes, spacing, header
 * alignment and heading style. Every template renders the SAME ResumeDoc, in the same
 * section order, with the same text; switching template can never change the content.
 * All five are single-column, real text, standard fonts (ATS-readable).
 */
export type TemplateId = "classic" | "modern" | "software" | "student" | "minimal";

export type TemplateSpec = {
  id: TemplateId;
  label: string;
  blurb: string;
  /** PDF: Helvetica / Times. DOCX: Calibri / Times New Roman. Preview: sans / serif stack. */
  font: "sans" | "serif";
  margin: { x: number; top: number; bottom: number };
  header: { align: "center" | "left"; name: number; nameBold: boolean; nameGap: number; contact: number; contactLead: number };
  section: { style: "rule" | "accent" | "plain"; size: number; before: number; after: number; tracking: number };
  entry: { head: number; meta: number; lead: number; sub: number; subLead: number; gap: number };
  body: { size: number; lead: number };
  sectionGap: number;
  /** Accent color as 0–1 RGB (used by "accent" headings only). */
  accent: [number, number, number];
};

const BASE = { sectionGap: 2, accent: [0.76, 0.25, 0.05] as [number, number, number] };

export const TEMPLATES: TemplateSpec[] = [
  {
    id: "classic", label: "Classic ATS", blurb: "Centered header, ruled headings. The safest choice for applicant tracking systems.",
    font: "sans", margin: { x: 50, top: 48, bottom: 48 },
    header: { align: "center", name: 19, nameBold: true, nameGap: 17, contact: 9.5, contactLead: 12 },
    section: { style: "rule", size: 10.5, before: 6, after: 16, tracking: 0 },
    entry: { head: 10.5, meta: 9.5, lead: 13, sub: 10, subLead: 12.5, gap: 5 },
    body: { size: 10, lead: 13 }, ...BASE,
  },
  {
    id: "modern", label: "Modern ATS", blurb: "Left-aligned header with an accent-colored heading style. Still plain, parseable text.",
    font: "sans", margin: { x: 52, top: 50, bottom: 48 },
    header: { align: "left", name: 22, nameBold: true, nameGap: 20, contact: 9.5, contactLead: 12 },
    section: { style: "accent", size: 10.5, before: 8, after: 15, tracking: 0.6 },
    entry: { head: 10.5, meta: 9.5, lead: 13, sub: 10, subLead: 12.5, gap: 6 },
    body: { size: 10, lead: 13.2 }, ...BASE,
  },
  {
    id: "software", label: "Software Engineer", blurb: "Dense and skimmable: tighter leading so projects, stack and experience fit one page.",
    font: "sans", margin: { x: 44, top: 40, bottom: 40 },
    header: { align: "left", name: 20, nameBold: true, nameGap: 17, contact: 9, contactLead: 11.5 },
    section: { style: "rule", size: 10, before: 4, after: 14, tracking: 0.3 },
    entry: { head: 10, meta: 9, lead: 12.2, sub: 9.5, subLead: 11.8, gap: 4 },
    body: { size: 9.5, lead: 12.2 }, ...BASE,
  },
  {
    id: "student", label: "Student / New Grad", blurb: "Serif and roomy, easy to read when the resume is one page of coursework, projects and activities.",
    font: "serif", margin: { x: 54, top: 52, bottom: 50 },
    header: { align: "center", name: 20, nameBold: true, nameGap: 18, contact: 10, contactLead: 12.5 },
    section: { style: "rule", size: 11, before: 8, after: 17, tracking: 0.2 },
    entry: { head: 11, meta: 10, lead: 13.8, sub: 10.5, subLead: 13.2, gap: 7 },
    body: { size: 10.5, lead: 13.8 }, ...BASE,
  },
  {
    id: "minimal", label: "Minimal", blurb: "Quiet: no rules, small tracked headings, generous white space.",
    font: "sans", margin: { x: 58, top: 56, bottom: 52 },
    header: { align: "left", name: 18, nameBold: false, nameGap: 18, contact: 9.5, contactLead: 12.5 },
    section: { style: "plain", size: 9.5, before: 10, after: 15, tracking: 1 },
    entry: { head: 10.5, meta: 9.5, lead: 13.5, sub: 10, subLead: 13, gap: 7 },
    body: { size: 10, lead: 13.6 }, ...BASE,
  },
];

export const DEFAULT_TEMPLATE: TemplateId = "classic";
export const isTemplateId = (v: unknown): v is TemplateId => TEMPLATES.some((t) => t.id === v);
export const templateById = (id: string | null | undefined): TemplateSpec => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
