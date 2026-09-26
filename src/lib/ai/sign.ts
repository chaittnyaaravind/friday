/**
 * Server-signed AI text. A line marked origin "ai" in a resume claims "FRIDAY's AI wrote this and the fact guard passed it".
 * That claim must not be forgeable by a client, so the server signs every guard-approved suggestion it hands out
 * (HMAC over the user id, the exact text and the evidence basis) and refuses to persist AI-labelled text without a valid
 * signature. Text the user writes, edits, or attests to becomes origin "user" — the user is the source of truth for that —
 * so it never needs one.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/api";
import type { DocLine, ResumeDoc } from "@/lib/resume/types";
import { AiNotConfiguredError } from "./client";

const secret = () => process.env.AI_SIGNING_SECRET || process.env.SUPABASE_SECRET_KEY || "";
export const signingAvailable = () => secret().length >= 16;

const mac = (userId: string, text: string, basis: string) =>
  createHmac("sha256", secret()).update(JSON.stringify(["friday-ai-line-v1", userId, text, basis])).digest("hex").slice(0, 32);

export function signAiText(userId: string, text: string, basis: string): string {
  if (!signingAvailable()) throw new AiNotConfiguredError();
  return mac(userId, text, basis);
}

export function verifyAiText(userId: string, text: string, basis: string, sig: string | undefined): boolean {
  if (!sig || !signingAvailable()) return false;
  const want = Buffer.from(mac(userId, text, basis));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The AI-labelled lines of a document, with where they are. */
function* aiLines(doc: ResumeDoc): Generator<{ where: string; line: DocLine }> {
  for (const s of doc.sections) {
    for (const e of s.entries) for (const line of e.bullets) if (line.origin === "ai") yield { where: `${s.title} · ${e.heading || "entry"}`, line };
    for (const line of s.lines) if (line.origin === "ai") yield { where: s.title, line };
  }
}

const key = (l: DocLine) => JSON.stringify([l.text, l.ai?.basis ?? null, l.ai?.sig ?? null]);

/**
 * Throws 422 if `doc` contains an AI-labelled line that this server didn't produce for this user. A line already stored,
 * unchanged, in `stored` is allowed to stay (it was accepted under an earlier version of this check).
 */
export function assertAiLinesSigned(doc: ResumeDoc, userId: string, stored?: ResumeDoc | null) {
  const grandfathered = new Set<string>();
  if (stored) for (const { line } of aiLines(stored)) grandfathered.add(key(line));
  const bad = [...aiLines(doc)].filter(({ line }) => !(line.ai && verifyAiText(userId, line.text, line.ai.basis, line.ai.sig)) && !grandfathered.has(key(line)));
  if (bad.length) {
    throw new HttpError(422, `Rejected: ${bad.length} line${bad.length === 1 ? " is" : "s are"} labelled AI-written but weren't produced by FRIDAY's AI for this account (or were changed afterwards). Edit the text yourself instead — “${bad[0].line.text.slice(0, 80)}” in ${bad[0].where}.`);
  }
}
