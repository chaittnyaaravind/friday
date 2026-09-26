/**
 * Version-history helpers (pure). A version keeps an append-only list of revisions:
 * "original" (the state it was created in), one per accepted AI edit, one per settled run of
 * user edits, and one per restore. Nothing here deletes or rewrites a revision — restoring
 * writes the old content back as a NEW revision, so every earlier state stays recoverable.
 */
import { diffLines, type DiffLine } from "./diff";
import { docToText } from "./generate";
import type { ResumeDoc } from "./types";

export type RevisionSource = "original" | "ai" | "user" | "restore" | "checkpoint";

/** What an AI revision changed — the audit trail for "every AI modification must be traceable". */
export type RevisionTrace = {
  op: string;
  where: string;
  before: string;
  after: string;
  reason?: string;
  via?: "ai" | "local";
  /** New facts the user explicitly attested to when accepting. */
  attested?: string[];
};

export type Revision = {
  id: string;
  version_id: string;
  label: string;
  source: RevisionSource;
  content: ResumeDoc;
  trace: RevisionTrace | null;
  created_at: string;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Titles of the sections that differ between two documents (plus "Header" / "Section order"). */
export function changedSections(a: ResumeDoc, b: ResumeDoc): string[] {
  const out: string[] = [];
  if (!same(a.header, b.header)) out.push("Header");
  const byIdA = new Map(a.sections.map((s) => [s.id, s]));
  const byIdB = new Map(b.sections.map((s) => [s.id, s]));
  for (const s of b.sections) {
    const before = byIdA.get(s.id);
    if (!before || !same(before, s)) out.push(s.title);
  }
  for (const s of a.sections) if (!byIdB.has(s.id)) out.push(s.title);
  if (!out.length && !same(a.sections.map((s) => s.id), b.sections.map((s) => s.id))) out.push("Section order");
  return [...new Set(out)];
}

/** "Edited Projects", "Edited Experience and Skills", "Edited 3 sections". */
export function userEditLabel(a: ResumeDoc, b: ResumeDoc): string {
  const c = changedSections(a, b);
  if (!c.length) return "Edited resume";
  if (c.length === 1) return c[0] === "Section order" ? "Reordered sections" : `Edited ${c[0]}`;
  if (c.length === 2) return `Edited ${c[0]} and ${c[1]}`;
  return `Edited ${c.length} sections`;
}

export const hasChanged = (a: ResumeDoc | null, b: ResumeDoc) => !a || !same(a, b);

/** Line diff between two documents' text (for Compare). */
export const diffDocs = (a: ResumeDoc, b: ResumeDoc): DiffLine[] => diffLines(docToText(a).split("\n"), docToText(b).split("\n"));

/** Oldest → newest numbering: the first revision is "Version 1". Returns newest first for display. */
export function numbered<T extends { created_at: string }>(revs: T[]): (T & { number: number })[] {
  return [...revs].sort((x, y) => x.created_at.localeCompare(y.created_at)).map((r, i) => ({ ...r, number: i + 1 })).reverse();
}
