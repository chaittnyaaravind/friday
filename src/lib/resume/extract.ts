/**
 * File → plain text, locally (no network, no AI). The original bytes are never modified;
 * callers store the untouched upload separately.
 */
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { decodeEntities } from "@/lib/domain/normalize";

export const RESUME_TYPES: Record<string, "pdf" | "docx" | "txt"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export async function extractResumeText(bytes: Uint8Array, kind: "pdf" | "docx" | "txt"): Promise<string> {
  // Copy so parsers that detach/transfer the buffer can never touch the caller's original.
  const copy = bytes.slice();
  if (kind === "pdf") return (await extractText(copy, { mergePages: true })).text;
  if (kind === "docx") {
    // HTML keeps list items, so bullets survive; raw text would drop them.
    const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(copy) });
    return decodeEntities(
      value
        .replace(/<li[^>]*>/gi, "\n• ")
        .replace(/<\/(p|li|h[1-6]|tr)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/t[dh]>/gi, "  ")
        .replace(/<[^>]+>/g, ""),
    );
  }
  return new TextDecoder().decode(copy);
}
