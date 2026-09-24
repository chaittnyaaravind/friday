import { z } from "zod";
import type { Section } from "./types";

const s = (max = 300) => z.string().trim().max(max);
const opt = (max = 120) => z.string().trim().max(max).nullable();
const entry = z.object({ title: s(160), organization: s(160), location: opt(), start: opt(40), end: opt(40), bullets: z.array(s(600)).max(20) });

export const SECTION_SCHEMA: Record<Section, z.ZodType> = {
  personal: z.object({ field: z.enum(["name", "email", "phone", "location"]), value: s(200).min(1) }),
  link: z.object({ label: s(40).min(1), url: s(300).min(4) }),
  summary: z.object({ text: s(1500).min(1) }),
  education: z.object({ school: s(200), degree: opt(200), start: opt(40), end: opt(40), gpa: opt(10), details: z.array(s(400)).max(12) }),
  experience: entry,
  activity: entry,
  project: z.object({ name: s(160).min(1), technologies: z.array(s(40)).max(30), date: opt(40), link: opt(300), bullets: z.array(s(600)).max(20) }),
  skill: z.object({ name: s(60).min(1), group: opt(60) }),
  certification: z.object({ text: s(300).min(1), group: z.string().optional() }),
  award: z.object({ text: s(300).min(1), group: z.string().optional() }),
  coursework: z.object({ text: s(120).min(1), group: z.string().optional() }),
  other: z.object({ text: s(600).min(1), group: z.string().optional() }),
};

export const SECTIONS = Object.keys(SECTION_SCHEMA) as Section[];
