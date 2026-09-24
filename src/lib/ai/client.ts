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

/** Turn Claude API failures into a sentence a student can act on (never raw JSON). */
export function friendlyAiError(e: unknown): string | null {
  if (e instanceof AiNotConfiguredError) return "FRIDAY AI isn't configured yet (ANTHROPIC_API_KEY).";
  if (e instanceof AiRefusalError) return "FRIDAY can't help with that request.";
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "FRIDAY AI is busy right now — try again in a minute.";
  if (e instanceof Anthropic.APIError) {
    if (/credit balance/i.test(e.message)) return "Your Anthropic account has no API credits. Add credits at console.anthropic.com → Plans & Billing.";
    if (e.status && e.status >= 500) return "Claude is temporarily unavailable — try again shortly.";
    return "FRIDAY AI couldn't complete that request.";
  }
  return null;
}

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
