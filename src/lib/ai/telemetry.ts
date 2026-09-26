/**
 * AI call telemetry. One JSON line per provider attempt with exactly these fields — task,
 * provider, model, latency, success and an error CATEGORY — and nothing else. Prompts,
 * responses, resume text and user ids are never passed to this module, so they can't be logged.
 */
export type ErrorCategory = "not_configured" | "auth" | "rate_limit" | "timeout" | "unreachable" | "model_unavailable" | "bad_request" | "unavailable" | "malformed" | "unknown";

export type AiEvent = { evt: "ai_call"; task: string; provider: string; model: string; ms: number; ok: boolean; category?: ErrorCategory };

type Sink = (e: AiEvent) => void;
const consoleSink: Sink = (e) => console.info(JSON.stringify(e));
let sink: Sink = consoleSink;

/** Tests (or a metrics backend) can capture events. Passing nothing restores console output. */
export const setAiLogSink = (s?: Sink) => { sink = s ?? consoleSink; };

export function logAi(e: Omit<AiEvent, "evt">) {
  try {
    sink({ evt: "ai_call", task: e.task, provider: e.provider, model: e.model, ms: Math.round(e.ms), ok: e.ok, ...(e.category ? { category: e.category } : {}) });
  } catch { /* telemetry must never break a request */ }
}

/** Classify a failure from its status alone. The error's message is never inspected or logged. */
export function categoryOf(status: number | null, opts: { timeout?: boolean; malformed?: boolean; notConfigured?: boolean } = {}): ErrorCategory {
  if (opts.notConfigured) return "not_configured";
  if (opts.malformed) return "malformed";
  if (opts.timeout) return "timeout";
  if (status === null) return "unknown";
  if (status === 0) return "unreachable";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 404) return "model_unavailable"; // hosted catalogs list models an account may not be able to call
  if (status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "unknown";
}
