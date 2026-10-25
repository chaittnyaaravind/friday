import { z } from "zod";

/** Wire schema for a ResumeDoc — shared by the version and revision routes so both validate identically. */
const origin = z.enum(["profile", "user", "ai"]);
const ai = z.object({ basis: z.string().max(6000), op: z.string().max(40), at: z.string().max(40), sig: z.string().max(64).optional() });
// `terms`: ATS respellings tailoring made on this line ("nodejs" → "Node.js"). Kept on save, or validateDoc could no longer
// undo them and would reject the respelled skill as unconfirmed. undoTerms only honours pairs naming the same skill.
const terms = z.array(z.object({ from: z.string().max(80), to: z.string().max(80) })).max(20);
const line = z.object({ id: z.string().max(40), text: z.string().max(2000), origin, sourceItemId: z.string().max(60).nullable(), ai: ai.optional(), terms: terms.optional() });

export const KindSchema = z.enum(["summary", "education", "experience", "projects", "skills", "certifications", "awards", "coursework", "activities"]);

export const DocSchema = z.object({
  version: z.literal(1),
  header: z.object({ name: z.string().max(200), contact: z.array(z.string().max(300)).max(12), origin }),
  sections: z.array(z.object({
    id: z.string().max(40),
    kind: KindSchema,
    title: z.string().max(80),
    entries: z.array(z.object({ id: z.string().max(40), sourceItemId: z.string().max(60).nullable(), heading: z.string().max(300), subheading: z.string().max(400), meta: z.string().max(120), origin, bullets: z.array(line).max(30) })).max(40),
    lines: z.array(line).max(60),
  })).max(20),
});

export const TraceSchema = z.object({
  op: z.string().max(40),
  where: z.string().max(200),
  before: z.string().max(2000),
  after: z.string().max(2000),
  reason: z.string().max(400).optional(),
  via: z.enum(["ai", "local"]).optional(),
  attested: z.array(z.string().max(200)).max(20).optional(),
});

export const TEMPLATE_IDS = ["classic", "modern", "software", "student", "minimal"] as const;
export const TemplateSchema = z.enum(TEMPLATE_IDS);
