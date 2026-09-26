/**
 * Document parsing for uploaded resume IMAGES (scans, screenshots, photos) with NVIDIA Nemotron
 * Parse. PDFs, DOCX and TXT keep their deterministic local extractors — this only handles what
 * they can't read. The output is plain text that then goes through the same deterministic
 * parser as any other resume; if parsing fails nothing is returned (no guessed text).
 */
import "server-only";
import { AiHttpError, chainFor, completeWith, runChain, type Completion } from "./client";

export const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg"> = { "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg" };

const SKIP = /^(?:page-header|page-footer|picture|footnote)$/i;

/** Walk whatever structure the parser returned and keep the text, in reading order. */
export function flattenParsed(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string" && o.text.trim()) {
      const type = typeof o.type === "string" ? o.type : "";
      if (SKIP.test(type)) return;
      const t = o.text.trim();
      out.push(/^list-item$/i.test(type) && !/^[•\-*·]/.test(t) ? `• ${t}` : t);
    } else for (const k of Object.keys(o)) if (typeof o[k] === "object") visit(o[k]);
  };
  visit(value);
  return out;
}

/** Markdown → the plain-text conventions the resume parser understands (• bullets, no emphasis, no table pipes). */
export function markdownToText(md: string): string {
  return md
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\|?\s*[-:| ]{3,}\s*\|?\s*$/gm, "")
    .replace(/\s*\|\s*/g, "  ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** Text from a parse completion: the markdown_bbox tool call (JSON items) when present, else the message content. */
export function textFromParse(c: Pick<Completion, "content" | "toolCalls">): string {
  for (const call of c.toolCalls) {
    try {
      const lines = flattenParsed(JSON.parse(call.function.arguments));
      if (lines.length) return lines.join("\n");
    } catch { /* fall through to content */ }
  }
  const content = (c.content ?? "").trim();
  if (!content) return "";
  try {
    const lines = flattenParsed(JSON.parse(content));
    if (lines.length) return lines.join("\n");
  } catch { /* not JSON: markdown */ }
  return markdownToText(content);
}

/** Read a resume image. Throws (AiNotConfiguredError / AiHttpError) when parsing isn't possible — never returns guessed text. */
export async function parseDocumentImage(bytes: Uint8Array, mime: "image/png" | "image/jpeg"): Promise<string> {
  const url = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  const chain = chainFor("document_parsing", { generic: false });
  const { value } = await runChain("document_parsing", chain, async (cfg, timeoutMs) => {
    const c = await completeWith(cfg, {
      task: "document_parsing", timeoutMs, maxTokens: 4096, toolChoice: null,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }],
      tools: [{ type: "function", function: { name: "markdown_bbox" } }],
    });
    const text = textFromParse(c);
    if (text.length < 20) throw new AiHttpError(502, "The parser returned no text");
    return text;
  }, { timeoutMs: 45_000, budgetMs: 50_000 });
  return value;
}
