/**
 * Claude access for FRIDAY. Server-only; the API key never reaches the browser.
 * Model: Claude Opus 5 with adaptive thinking. Server-side refusal fallbacks are on
 * ("default" routing), so a declined request is retried on a fallback model in-call.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
    this.name = "AiNotConfiguredError";
  }
}

export class AiRefusalError extends Error {
  constructor(public category: string | null) {
    super("Claude declined this request.");
    this.name = "AiRefusalError";
  }
}

let client: Anthropic | null = null;
export function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiNotConfiguredError();
  client ??= new Anthropic();
  return client;
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
