import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { aiConfig, complete, friendlyAiError, isAiUnavailable, AiHttpError, AiNotConfiguredError } = await import("./client");

const KEYS = ["AI_PROVIDER", "AI_MODEL", "AI_BASE_URL", "AI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe("free AI provider config", () => {
  it("is off with no key, so FRIDAY Local takes over", () => {
    expect(aiConfig()).toBeNull();
  });

  it("auto-detects a free provider from its key", () => {
    process.env.GEMINI_API_KEY = "k";
    expect(aiConfig()).toMatchObject({ provider: "gemini", apiKey: "k" });
    process.env.GROQ_API_KEY = "g";
    expect(aiConfig()?.provider).toBe("groq");
  });

  it("supports keyless local Ollama and custom endpoints", () => {
    process.env.AI_PROVIDER = "ollama";
    expect(aiConfig()).toMatchObject({ provider: "ollama", apiKey: null });
    process.env.AI_BASE_URL = "http://x/v1/";
    process.env.AI_MODEL = "m";
    expect(aiConfig()).toMatchObject({ provider: "custom", baseUrl: "http://x/v1", model: "m" });
  });
});

describe("complete()", () => {
  it("throws NotConfigured with no provider", async () => {
    await expect(complete({ messages: [] })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });

  it("returns text and tool calls from an OpenAI-compatible reply", async () => {
    process.env.GROQ_API_KEY = "k";
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "get_profile", arguments: "{}" } }] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await complete({ messages: [{ role: "user", content: "hi" }] });
    expect(r.toolCalls[0].function.name).toBe("get_profile");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("maps rate limits, bad keys and outages to friendly, fallback-worthy errors", async () => {
    process.env.GROQ_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    const e = await complete({ messages: [] }).catch((x) => x);
    expect(e).toBeInstanceOf(AiHttpError);
    expect(isAiUnavailable(e)).toBe(true);
    expect(friendlyAiError(e)).toMatch(/free-tier limit/);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const down = await complete({ messages: [] }).catch((x) => x);
    expect(isAiUnavailable(down)).toBe(true);
    expect(friendlyAiError(down)).not.toMatch(/fetch failed/);
  });
});
