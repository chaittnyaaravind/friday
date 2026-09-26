/**
 * Task → provider/model routing. The ONLY place a model id is chosen; nothing else in the app
 * names a model. Each task has an ordered list of preferred routes; providers that aren't
 * configured are skipped, and the client then falls back to whatever else is configured
 * (Groq / Gemini / OpenRouter / Ollama, in the user's preferred order).
 *
 * Override any task with an env var:  AI_TASK_<TASK>="provider[:model][,provider[:model]…]"
 *   AI_TASK_RESUME_REWRITE="nvidia:moonshotai/kimi-k2.6,gemini,groq"
 *   AI_TASK_JOB_MATCHING="gemini"          (use the provider's default model)
 *   AI_TASK_RESUME_ANALYSIS="default"      (back to the built-in route)
 *
 * Model ids below are entries of NVIDIA's public catalog (integrate.api.nvidia.com/v1/models).
 */
export const AI_TASKS = ["resume_rewrite", "resume_analysis", "job_matching", "semantic_search", "document_parsing", "ats_analysis"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export type Route = { provider: string; model?: string };

const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";

/**
 * Why each default (all verified against a live NVIDIA account):
 *  - every structured-JSON task → Nemotron 3 Super first. It was the only model that answered real requests
 *    reliably. Nemotron 3.5 Lightning is kept as the NVIDIA fallback but is NOT primary: it is a reasoning
 *    model that, on a real 700-token request, spent its whole budget "thinking" and timed out. Free-tier
 *    latency also varies a lot (0.4s–20s+), so a fallback that is fast on a 1-token probe proves little.
 *  - semantic search  → Nemotron 3 Embed 1B (retrieval embeddings, query/passage modes; 2048 dims).
 *  - document parsing → Nemotron Parse (page image → text with layout).
 * Not routed: Nemotron Nano and Kimi K2.6 (HTTP 404 "not found for account"), DeepSeek V4.1 Flash (timed out).
 */
export const AI_TASK_CONFIG: Record<AiTask, Route[]> = {
  resume_rewrite: [{ provider: "nvidia", model: SUPER }, { provider: "nvidia", model: LIGHTNING }],
  resume_analysis: [{ provider: "nvidia", model: SUPER }, { provider: "nvidia", model: LIGHTNING }],
  ats_analysis: [{ provider: "nvidia", model: SUPER }, { provider: "nvidia", model: LIGHTNING }],
  job_matching: [{ provider: "nvidia", model: SUPER }, { provider: "nvidia", model: LIGHTNING }],
  semantic_search: [{ provider: "nvidia", model: "nvidia/nemotron-3-embed-1b" }],
  document_parsing: [{ provider: "nvidia", model: "nvidia/nemotron-parse" }],
};

/**
 * Models verified live to honour `chat_template_kwargs: { enable_thinking: false }` (valid JSON, no reasoning
 * text, `finish_reason: stop`). The parameter is sent ONLY for these, and only on JSON requests — other models
 * may reject an unknown template argument.
 */
export const THINKING_DISABLE_SUPPORTED: ReadonlySet<string> = new Set([`nvidia:${SUPER}`, `nvidia:${LIGHTNING}`]);

/** "nvidia:moonshotai/kimi-k2.6,gemini" → routes. Splits on the FIRST colon, so ids like "x/y:free" survive. */
export function parseRoutes(value: string): Route[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(":");
    const provider = (i < 0 ? s : s.slice(0, i)).trim().toLowerCase();
    const model = i < 0 ? undefined : s.slice(i + 1).trim() || undefined;
    return { provider, model };
  }).filter((r) => r.provider);
}

export function routesFor(task: AiTask, env: Record<string, string | undefined> = process.env): Route[] {
  const override = env[`AI_TASK_${task.toUpperCase()}`]?.trim();
  if (override && override.toLowerCase() !== "default") {
    const parsed = parseRoutes(override);
    if (parsed.length) return parsed;
  }
  return AI_TASK_CONFIG[task];
}
