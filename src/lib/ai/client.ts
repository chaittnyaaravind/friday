/**
 * AI access for FRIDAY. Server-only; keys never reach the browser.
 * Talks to any OpenAI-compatible endpoint over fetch (no SDK), so it runs on free tiers:
 *   nvidia (NIM / build.nvidia.com) · groq · gemini (Google AI Studio) · openrouter (":free") · ollama (local)
 * Pick the general preference with AI_PROVIDER (else the first key found). Override AI_MODEL, or
 * point AI_BASE_URL + AI_API_KEY at any compatible server. Per-task models come from ./routing.
 *
 * One attempt loop (`runChain`) serves chat, embeddings and document parsing: it tries each
 * candidate in order, skips ones that recently failed, logs a content-free telemetry line per
 * attempt, and hands the failure to the next candidate. It never fabricates a result.
 */
import "server-only";
import { AI_TASK_CONFIG, routesFor, THINKING_DISABLE_SUPPORTED, type AiTask } from "./routing";
import { categoryOf, logAi, type ErrorCategory } from "./telemetry";

type Preset = { baseUrl: string; model: string; keyEnv: string | null; jsonMode: boolean; reasoning: boolean };

const PRESETS: Record<string, Preset> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY", jsonMode: true, reasoning: false },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", keyEnv: "GEMINI_API_KEY", jsonMode: true, reasoning: false },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3.3-70b-instruct:free", keyEnv: "OPENROUTER_API_KEY", jsonMode: true, reasoning: false },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1", keyEnv: null, jsonMode: true, reasoning: false },
  // NIM's OpenAI-compatible API. Not every hosted model honours response_format, so JSON is requested
  // in the prompt and validated by `structured` (with a repair retry) rather than forced. Its models
  // are reasoning models: extra token headroom, and <think> blocks are stripped from answers.
  nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", model: AI_TASK_CONFIG.job_matching[0].model!, keyEnv: "NVIDIA_API_KEY", jsonMode: false, reasoning: true },
};

export type AiConfig = { provider: string; baseUrl: string; model: string; apiKey: string | null; jsonMode: boolean; reasoning: boolean };

/**
 * Every usable provider, in the order to try them when a task has no specific route. The preferred
 * one (AI_PROVIDER, else the first key found) goes first; the rest follow as automatic fallbacks.
 * Ollama is only used when selected explicitly, because there is no key to detect it by.
 */
export function aiProviders(): AiConfig[] {
  const env = process.env;
  const out: AiConfig[] = [];
  if (env.AI_BASE_URL) out.push({ provider: "custom", baseUrl: env.AI_BASE_URL.replace(/\/$/, ""), model: env.AI_MODEL ?? "default", apiKey: env.AI_API_KEY ?? null, jsonMode: true, reasoning: false });
  const preferred = env.AI_PROVIDER?.toLowerCase();
  const order = [...(preferred && PRESETS[preferred] ? [preferred] : []), ...Object.keys(PRESETS).filter((k) => k !== preferred)];
  let modelApplied = false;
  for (const name of order) {
    const p = PRESETS[name];
    const apiKey = p.keyEnv ? (env[p.keyEnv] ?? null) : null;
    if (p.keyEnv ? !apiKey : name !== preferred) continue;
    // AI_MODEL is written for the first provider only; fallbacks keep their own default model.
    const model = !modelApplied && env.AI_MODEL && !env.AI_BASE_URL ? env.AI_MODEL : p.model;
    modelApplied = true;
    out.push({ provider: name, baseUrl: p.baseUrl, model, apiKey, jsonMode: p.jsonMode, reasoning: p.reasoning });
  }
  return out;
}

/** The first (preferred) provider, or null when none is configured. */
export function aiConfig(): AiConfig | null {
  return aiProviders()[0] ?? null;
}

export function isAiConfigured() {
  return aiProviders().length > 0;
}

/**
 * The attempt order for a task: its routed provider/model entries (those with a key), then every
 * other configured provider on its default model. `generic: false` returns the routed entries only
 * (embeddings and OCR have no meaningful generic fallback — a chat model can't embed or read an image).
 */
export function chainFor(task?: AiTask, o: { skip?: string[]; generic?: boolean } = {}): AiConfig[] {
  const all = aiProviders();
  const out: AiConfig[] = [];
  const add = (c: AiConfig) => {
    if (o.skip?.includes(c.provider) || out.some((x) => x.provider === c.provider && x.model === c.model)) return;
    out.push(c);
  };
  if (task) {
    for (const r of routesFor(task)) {
      const base = all.find((c) => c.provider === r.provider);
      if (base) add({ ...base, model: r.model ?? base.model });
    }
  }
  if (o.generic !== false) for (const c of all) add(c);
  return out;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("No free AI provider is configured (set NVIDIA_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or AI_PROVIDER=ollama)");
    this.name = "AiNotConfiguredError";
  }
}

/** HTTP failure from the provider, or the provider being unreachable (status 0). */
export class AiHttpError extends Error {
  constructor(public status: number, message: string, public timeout = false) {
    super(message);
    this.name = "AiHttpError";
  }
}

/** The model answered, but not in the shape we asked for (bad JSON, schema mismatch). */
export class AiMalformedError extends Error {
  constructor() {
    super("The AI returned an answer FRIDAY couldn't read. Nothing was changed — try again.");
    this.name = "AiMalformedError";
  }
}

export class AiRefusalError extends Error {
  constructor(public category: string | null = null) {
    super("The AI declined this request.");
    this.name = "AiRefusalError";
  }
}

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ToolSpec = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };
export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type Completion = {
  content: string | null; toolCalls: ToolCall[]; finishReason: string | null; provider: string; model: string;
  /** True if the provider returned reasoning ("thinking") text alongside the answer — it is stripped from `content`. */
  reasoning: boolean;
};

export type CompleteOptions = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** "auto" (default when tools are given) or null to send no tool_choice (e.g. a single fixed tool). */
  toolChoice?: "auto" | null;
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  /** Which task this is — picks the routed model (see ./routing). Omit for general chat. */
  task?: AiTask;
  /** Providers to leave out, e.g. the one that just returned an unreadable answer. */
  skipProviders?: string[];
};

// ───────────────────────── attempt loop ─────────────────────────

/** Providers/models that just failed are tried last for a while, so a dead one doesn't cost every request. */
const COOLDOWN = new Map<string, number>();
const coolKeys = (c: AiConfig) => [`p:${c.provider}`, `m:${c.provider}:${c.model}`];
const cooling = (c: AiConfig) => coolKeys(c).some((k) => (COOLDOWN.get(k) ?? 0) > Date.now());
export const resetAiRouting = () => COOLDOWN.clear();

/** How long a model that answered 404 ("not found for this account") is skipped. */
const MODEL_UNAVAILABLE_MS = 10 * 60_000;
/** How long a model that TIMED OUT is skipped. */
const MODEL_TIMEOUT_MS = 10 * 60_000;

function noteFailure(c: AiConfig, e: AiHttpError) {
  const s = e.status;
  if (s === 401 || s === 403) COOLDOWN.set(`p:${c.provider}`, Date.now() + 10 * 60_000); // a bad key is bad for every model
  else if (s === 404) COOLDOWN.set(`m:${c.provider}:${c.model}`, Date.now() + MODEL_UNAVAILABLE_MS); // this model isn't available for the account: stop asking for a while
  else if (s === 429) COOLDOWN.set(`m:${c.provider}:${c.model}`, Date.now() + 45_000); // rate limits are per model
  else if (e.timeout) COOLDOWN.set(`m:${c.provider}:${c.model}`, Date.now() + MODEL_TIMEOUT_MS); // a model that timed out will very likely time out again
  else if (s === 0 || s >= 500) COOLDOWN.set(`m:${c.provider}:${c.model}`, Date.now() + 30_000);
}

export function errorCategory(e: unknown): ErrorCategory {
  if (e instanceof AiNotConfiguredError) return categoryOf(null, { notConfigured: true });
  if (e instanceof AiMalformedError) return categoryOf(null, { malformed: true });
  if (e instanceof AiHttpError) return categoryOf(e.status, { timeout: e.timeout });
  return "unknown";
}

/**
 * Try each candidate in order until one succeeds. Only provider failures (AiHttpError) move on to the
 * next candidate; anything else is a bug and propagates. Every attempt is logged (task, provider,
 * model, latency, success, error category — never content). Throws the last provider error.
 */
export async function runChain<T>(
  task: AiTask | undefined,
  chain: AiConfig[],
  fn: (cfg: AiConfig, timeoutMs: number) => Promise<T>,
  o: { timeoutMs?: number; budgetMs?: number } = {},
): Promise<{ value: T; cfg: AiConfig }> {
  if (!chain.length) throw new AiNotConfiguredError();
  // Models that recently failed are SKIPPED while any alternative exists — never retried "as a last resort" —
  // so a timed-out model can't cost every request another full timeout. Only when every candidate is cooling
  // (nothing else to try) are they attempted, in order, rather than failing without a single request.
  const live = chain.filter((c) => !cooling(c));
  const allCooling = live.length === 0;
  const ordered = allCooling ? chain : live;
  const deadline = Date.now() + (o.budgetMs ?? 55_000);
  let last: unknown;
  for (let i = 0; i < ordered.length; i++) {
    const cfg = ordered[i];
    const remaining = deadline - Date.now();
    // A failure earlier in THIS call can cool later candidates too (a bad key cools the whole provider): skip those.
    if (!allCooling && i > 0 && cooling(cfg)) continue;
    if (i > 0 && remaining < 3_000) break;
    // Earlier attempts get at most 25s so a slow model leaves room for the fallback.
    const timeout = Math.max(2_000, Math.min(o.timeoutMs ?? 60_000, i === ordered.length - 1 ? remaining : Math.min(remaining, 25_000)));
    const t0 = Date.now();
    try {
      const value = await fn(cfg, timeout);
      logAi({ task: task ?? "general", provider: cfg.provider, model: cfg.model, ms: Date.now() - t0, ok: true });
      return { value, cfg };
    } catch (e) {
      last = e;
      logAi({ task: task ?? "general", provider: cfg.provider, model: cfg.model, ms: Date.now() - t0, ok: false, category: errorCategory(e) });
      if (!(e instanceof AiHttpError)) throw e;
      noteFailure(cfg, e);
    }
  }
  throw last;
}

/**
 * Chat completion with task routing and fallback. The task's routed model goes first; if it is down,
 * rate-limited or rejects the request, the next candidate (ultimately every other configured
 * provider) is tried. Throws the last provider's error when all fail.
 */
export async function complete(opts: CompleteOptions): Promise<Completion> {
  let chain = chainFor(opts.task, { skip: opts.skipProviders });
  if (!chain.length && opts.skipProviders?.length) chain = chainFor(opts.task); // nothing else to try: retry the same provider
  const { value } = await runChain(opts.task, chain, (cfg, timeoutMs) => completeWith(cfg, { ...opts, timeoutMs }), { timeoutMs: opts.timeoutMs });
  return value;
}

/** Reasoning models may wrap their thinking in <think>…</think> (sometimes only the closing tag is emitted). */
export const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

/** One request to one provider/model, no fallback (the building block `complete` and the parsers loop over). */
export async function completeWith(cfg: AiConfig, opts: CompleteOptions): Promise<Completion> {
  // Structured-JSON requests skip the model's "thinking" (it burns the token budget and can leave no answer at all),
  // but only for models verified to support it.
  const thinkingOff = Boolean(opts.json) && THINKING_DISABLE_SUPPORTED.has(`${cfg.provider}:${cfg.model}`);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        messages: opts.messages,
        // Reasoning models get extra token headroom — unless thinking is switched off for this request.
        max_tokens: Math.min(8192, (opts.maxTokens ?? 2048) + (cfg.reasoning && !thinkingOff ? 2048 : 0)),
        temperature: 0.3,
        ...(thinkingOff ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        ...(opts.tools?.length ? { tools: opts.tools, ...(opts.toolChoice === null ? {} : { tool_choice: "auto" }) } : {}),
        ...(opts.json && cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new AiHttpError(0, timeout ? "The AI provider timed out" : e instanceof Error ? e.message : "AI provider unreachable", timeout);
  }
  if (!res.ok) throw new AiHttpError(res.status, (await res.text().catch(() => "")).slice(0, 500));
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string | null }[];
  } | null;
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new AiHttpError(502, "Empty response from AI provider");
  const raw = choice.message.content;
  const content = raw == null ? null : stripThinking(raw);
  const reasoning = Boolean(choice.message.reasoning_content || choice.message.reasoning || (raw != null && content !== raw.trim()));
  return { content, toolCalls: choice.message.tool_calls ?? [], finishReason: choice.finish_reason ?? null, provider: cfg.provider, model: cfg.model, reasoning };
}

// ───────────────────────── embeddings ─────────────────────────

/** POST {baseUrl}/embeddings. NVIDIA's retrieval models require `input_type` ("query" | "passage"). */
export async function embedWith(cfg: AiConfig, texts: string[], inputType: "query" | "passage", timeoutMs = 20_000): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, input: texts, encoding_format: "float", ...(cfg.provider === "nvidia" ? { input_type: inputType, truncate: "END" } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new AiHttpError(0, timeout ? "The embedding provider timed out" : "Embedding provider unreachable", timeout);
  }
  if (!res.ok) throw new AiHttpError(res.status, (await res.text().catch(() => "")).slice(0, 300));
  const data = (await res.json().catch(() => null)) as { data?: { index?: number; embedding?: unknown }[] } | null;
  const rows = [...(data?.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = rows.map((r) => r.embedding);
  const valid = vectors.length === texts.length && vectors.every((v) => Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n)));
  if (!valid) throw new AiHttpError(502, "Malformed embeddings response");
  return vectors as number[][];
}

// ───────────────────────── errors for people ─────────────────────────

/** Turn AI failures into a sentence a student can act on (never raw JSON). */
const UNAVAILABLE = "AI features are currently unavailable. Resume parsing, editing and FRIDAY Local still work.";

export function friendlyAiError(e: unknown): string | null {
  if (e instanceof AiNotConfiguredError) return `${UNAVAILABLE} (No free AI provider key is set.)`;
  if (e instanceof AiRefusalError) return "FRIDAY can't help with that request.";
  if (e instanceof AiMalformedError) return e.message;
  if (e instanceof AiHttpError) {
    if (e.status === 401 || e.status === 403) return `${UNAVAILABLE} (The AI provider rejected the API key.)`;
    if (e.status === 429) return "FRIDAY AI hit its free-tier limit — try again in a minute. Resume parsing and editing still work.";
    if (e.timeout) return "The AI took too long to answer — try again. Resume parsing and editing still work.";
    return UNAVAILABLE;
  }
  return null;
}

/** True when the provider can't be used at all (no key, bad key, rate limit, outage) — callers fall back. */
export function isAiUnavailable(e: unknown): boolean {
  return e instanceof AiNotConfiguredError || e instanceof AiHttpError;
}
