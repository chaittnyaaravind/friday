/**
 * ATS terminology. A keyword filter looks for the job's exact spelling ("Node.js"), so a resume that says "nodejs" can be
 * missed. This module rewrites such a spelling to the job's — and NOTHING else:
 *
 *  - It renames only a skill the line ALREADY names. It never adds one, and never turns a narrower skill into a broader
 *    one: the taxonomy's aliases mix true synonyms ("k8s" = Kubernetes) with sub-skills ("GitHub" ⊂ Git, "Keras" ⊂
 *    TensorFlow, "EC2" ⊂ AWS), and renaming a sub-skill would change what the student claims. So renames come from an
 *    explicit whitelist of pure spelling variants, each of which must also be a taxonomy alias of the same skill.
 *  - It renames only toward the taxonomy's own name, and only when the JOB uses that name.
 *  - It touches only lines FRIDAY built from the profile (origin "profile"): never the student's own words, never an
 *    accepted AI edit, never headings.
 *  - Every rename is recorded on the line (`terms`) so the truth check can undo it and prove it is the same skill, and is
 *    returned as a change with the line before and after so the student sees exactly what moved.
 * Pure and deterministic.
 */
import { extractSkills, resolveSkill, skillBySlug } from "@/lib/domain/skills";
import type { DocLine, ResumeDoc, TermChange } from "./types";

/** Pure spelling variants (canonical slug → variants written differently). Deliberately short. Go, C, R, JS, TS, ML are excluded: too ambiguous to rewrite. */
export const SPELLING_VARIANTS: Record<string, string[]> = {
  nodejs: ["nodejs", "node js"],
  react: ["react.js", "reactjs"],
  nextjs: ["nextjs", "next js"],
  vue: ["vue.js", "vuejs"],
  express: ["express.js", "expressjs"],
  kubernetes: ["k8s"],
  mongodb: ["mongo"],
  postgres: ["postgres"],
  spring: ["springboot"],
  "scikit-learn": ["sklearn", "scikit learn"],
  cpp: ["cpp"],
  csharp: ["c sharp"],
  aws: ["amazon web services"],
  gcp: ["google cloud platform", "gcp"],
  azure: ["microsoft azure"],
  nlp: ["natural language processing"],
  rest: ["rest api", "restful apis"],
};

export type TermChangeRecord = { skill: string; from: string; to: string; where: string; before: string; after: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (s: string, flags = "i") => new RegExp(`(?<![A-Za-z0-9+#])${esc(s)}(?![A-Za-z0-9+#])`, flags);

/**
 * Is `from` → `to` one of the whitelisted pure spelling variants? This — not the taxonomy — is what the truth check trusts,
 * because taxonomy aliases include sub-skills ("Keras" resolves to TensorFlow) and a forged rename must not slip through.
 */
export function isSpellingVariant(from: string, to: string): boolean {
  return Object.entries(SPELLING_VARIANTS).some(([slug, variants]) => skillBySlug(slug)?.name === to && variants.includes(from.toLowerCase()));
}

/** Two spellings are the same skill when the taxonomy resolves both to one entry and neither names more than one skill. */
export function sameSkill(a: string, b: string): boolean {
  const ra = resolveSkill(a);
  return Boolean(ra) && ra === resolveSkill(b) && extractSkills(a).length <= 1 && extractSkills(b).length <= 1;
}

/** The line as the student's profile wrote it: every recorded rename undone. */
export function undoTerms(text: string, terms: TermChange[] | undefined): string {
  let t = text;
  for (const c of [...(terms ?? [])].reverse()) t = t.replace(wordRe(c.to, "g"), c.from);
  return t;
}

export function applyTerminology(doc: ResumeDoc, jobText: string): { doc: ResumeDoc; changes: TermChangeRecord[] } {
  const inJob = new Set(extractSkills(jobText));
  // Candidates: skills the job spells with the taxonomy's own name — the spelling an ATS keyword filter will look for.
  const targets = Object.keys(SPELLING_VARIANTS)
    .filter((slug) => inJob.has(slug))
    .map((slug) => skillBySlug(slug))
    .filter((k): k is NonNullable<typeof k> => Boolean(k) && wordRe(k!.name).test(jobText));
  if (!targets.length) return { doc, changes: [] };

  const changes: TermChangeRecord[] = [];
  const rename = (line: DocLine, where: string): DocLine => {
    if (line.origin !== "profile") return line;
    let text = line.text;
    const terms: TermChange[] = [...(line.terms ?? [])];
    for (const k of targets) {
      if (wordRe(k.name).test(text)) continue; // the line already uses the job's spelling
      for (const variant of SPELLING_VARIANTS[k.slug]) {
        const found = text.match(wordRe(variant));
        if (!found || found[0] === k.name) continue;
        const from = found[0]; // exactly as written
        if (!sameSkill(from, k.name)) continue; // belt and braces: the taxonomy must agree they are one skill
        const before = text;
        text = text.replace(wordRe(variant, "gi"), k.name);
        terms.push({ from, to: k.name });
        changes.push({ skill: k.name, from, to: k.name, where, before, after: text });
        break;
      }
    }
    return text === line.text ? line : { ...line, text, terms };
  };

  const next: ResumeDoc = {
    ...doc,
    sections: doc.sections.map((s) => ({
      ...s,
      entries: s.entries.map((e) => ({ ...e, bullets: e.bullets.map((b) => rename(b, `${s.title} · ${e.heading}`)) })),
      lines: s.lines.map((l) => rename(l, s.title)),
    })),
  };
  return changes.length ? { doc: next, changes } : { doc, changes: [] };
}
