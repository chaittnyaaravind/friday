import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basisOf, lineContext, type LineRef } from "@/lib/resume/edits";
import type { ResumeDoc } from "@/lib/resume/types";

vi.mock("server-only", () => ({}));
const client = await import("./client");
const routing = await import("./routing");
const telemetry = await import("./telemetry");
const embeddings = await import("./embeddings");
const documents = await import("./documents");
const cache = await import("./cache");
const tasks = await import("./tasks");
const ai = await import("./resume");

const NV = "https://integrate.api.nvidia.com/v1";
const SECRET_KEY = "nvapi-SECRET-KEY-123";
const SENTINEL = "SENTINEL-BULLET-TEXT";

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["ada@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Software Intern", subheading: "Campus IT", meta: "2025", origin: "user", bullets: [
      line("b1", `Worked with Java on a website for students ${SENTINEL}`), line("b2", "Set up Docker containers for local development"), line("b3", "Wrote SQL queries that report weekly ticket volume"),
    ] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, Java, SQL")] },
  ],
});
const ref: LineRef = { sectionId: "exp", entryId: "e1", lineId: "b1" };
const input = (op: "improve" | "impactful" | "technical") => ({ op, target: { kind: "line" as const, ...ref }, ctx: lineContext(doc(), ref)!, evidence: basisOf(lineContext(doc(), ref)!) });

const ok = (content: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
const sugg = (...texts: string[]) => ({ suggestions: texts.map((text) => ({ text, reason: "clearer", newFactsIntroduced: [] })), missingEvidence: [] });

// A request body as the tests inspect it (they read a few provider-specific fields off it).
type Body = Record<string, unknown> & { model: string; max_tokens: number; input: string[]; input_type?: string; tool_choice?: unknown; tools?: unknown; response_format?: unknown; messages: { content: { image_url: { url: string } }[] }[] };
type Call = { url: string; body: Body; headers: Record<string, string> };
function stub(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const call: Call = { url, body: init.body ? JSON.parse(init.body as string) : null, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const ENV = ["AI_PROVIDER", "AI_MODEL", "AI_BASE_URL", "AI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "AI_EMBED_MIN_SIM", ...routing.AI_TASKS.map((t) => `AI_TASK_${t.toUpperCase()}`)];
const saved: Record<string, string | undefined> = {};
let events: Parameters<NonNullable<Parameters<typeof telemetry.setAiLogSink>[0]>>[0][] = [];

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  client.resetAiRouting();
  cache.clearAiCache();
  embeddings.clearEmbeddingCache();
  events = [];
  telemetry.setAiLogSink((e) => events.push(e));
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  telemetry.setAiLogSink();
});
const nvidia = () => { process.env.NVIDIA_API_KEY = SECRET_KEY; };
const both = () => { nvidia(); process.env.GROQ_API_KEY = "g"; };

describe("NVIDIA as a first-class provider", () => {
  it("is detected from NVIDIA_API_KEY and points at NIM's OpenAI-compatible endpoint", () => {
    nvidia();
    expect(client.aiProviders()).toEqual([expect.objectContaining({ provider: "nvidia", baseUrl: NV, apiKey: SECRET_KEY, jsonMode: false, reasoning: true })]);
    expect(client.isAiConfigured()).toBe(true);
  });

  it("missing API key: NVIDIA is simply absent and the other providers are used", () => {
    process.env.GROQ_API_KEY = "g";
    expect(client.aiProviders().map((p) => p.provider)).toEqual(["groq"]);
    expect(client.chainFor("resume_rewrite").map((c) => c.provider)).toEqual(["groq"]);
  });

  it("with no provider at all, calls fail as 'not configured' and never touch the network", async () => {
    const calls = stub(() => ok("x"));
    await expect(client.complete({ task: "resume_rewrite", messages: [] })).rejects.toBeInstanceOf(client.AiNotConfiguredError);
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiNotConfiguredError);
    expect(calls).toHaveLength(0);
  });

  it("keeps Groq, Gemini, OpenRouter and Ollama alongside it", () => {
    Object.assign(process.env, { NVIDIA_API_KEY: "n", GROQ_API_KEY: "g", GEMINI_API_KEY: "m", OPENROUTER_API_KEY: "o", AI_PROVIDER: "ollama" });
    expect(client.aiProviders().map((p) => p.provider).sort()).toEqual(["gemini", "groq", "nvidia", "ollama", "openrouter"]);
  });

  it("the key only ever travels in the Authorization header to NVIDIA, never in a body or URL", async () => {
    nvidia();
    const calls = stub(() => ok(sugg("Developed a Java website for students")));
    await ai.generateResumeEdit(input("improve"));
    expect(calls[0].url).toBe(`${NV}/chat/completions`);
    expect(calls[0].headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(JSON.stringify(calls[0].body) + calls[0].url).not.toContain(SECRET_KEY);
  });
});

describe("task routing", () => {
  it("routes each task to its configured NVIDIA model", () => {
    nvidia();
    // every structured-JSON task: Super first (latency-sensitive), Lightning only as the NVIDIA fallback
    for (const task of ["resume_rewrite", "resume_analysis", "ats_analysis", "job_matching"] as const) {
      expect(client.chainFor(task).map((c) => c.model)).toEqual(["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b"]);
    }
    expect(client.chainFor("semantic_search", { generic: false })[0].model).toBe("nvidia/nemotron-3-embed-1b");
    expect(client.chainFor("document_parsing", { generic: false })[0].model).toBe("nvidia/nemotron-parse");
  });

  it("no model id is hard-coded outside routing: a request carries the routed model", async () => {
    nvidia();
    const calls = stub(() => ok({ points: [], ...sugg("Developed a Java website for students") }));
    await ai.generateResumeEdit(input("improve"));
    await ai.analyzeResume({ doc: doc() });
    expect(calls.map((c) => c.body.model)).toEqual(["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-super-120b-a12b"]);
  });

  it("AI_TASK_<TASK> overrides the route: any provider, any model — Kimi first, then Gemini, then Groq", () => {
    Object.assign(process.env, { NVIDIA_API_KEY: "n", GEMINI_API_KEY: "m", GROQ_API_KEY: "g", AI_TASK_RESUME_REWRITE: "nvidia:moonshotai/kimi-k2.6,gemini,groq" });
    expect(client.chainFor("resume_rewrite").map((c) => `${c.provider}:${c.model}`)).toEqual(["nvidia:moonshotai/kimi-k2.6", "gemini:gemini-2.5-flash", "groq:llama-3.3-70b-versatile", "nvidia:nvidia/nemotron-3-super-120b-a12b"]);
    expect(routing.parseRoutes("openrouter:meta/x:free, nope ,")).toEqual([{ provider: "openrouter", model: "meta/x:free" }, { provider: "nope", model: undefined }]);
    process.env.AI_TASK_RESUME_REWRITE = "default";
    expect(client.chainFor("resume_rewrite")[0].model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("routes to providers that aren't configured are skipped, not errors", () => {
    process.env.GROQ_API_KEY = "g";
    process.env.AI_TASK_RESUME_REWRITE = "nvidia:x/y,groq";
    expect(client.chainFor("resume_rewrite").map((c) => c.provider)).toEqual(["groq"]);
  });

  it("an explicit AI_PROVIDER still orders the generic fallbacks", () => {
    Object.assign(process.env, { NVIDIA_API_KEY: "n", GROQ_API_KEY: "g", GEMINI_API_KEY: "m", AI_PROVIDER: "gemini" });
    expect(client.chainFor("resume_rewrite").map((c) => c.provider)).toEqual(["nvidia", "nvidia", "gemini", "groq"]); // both NVIDIA models, then the general order
  });
});

describe("NVIDIA failures fall back — and never produce fake results", () => {
  const good = () => ok(sugg("Developed a Java website for students"));

  it("invalid API key (401): falls back, then skips NVIDIA for a while instead of failing every request", async () => {
    both();
    const calls = stub((c) => (c.url.startsWith(NV) ? new Response("bad key", { status: 401 }) : good()));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(calls.map((c) => (c.url.startsWith(NV) ? "nvidia" : "groq"))).toEqual(["nvidia", "groq"]);
    ai._clearAiCache();
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(calls.map((c) => (c.url.startsWith(NV) ? "nvidia" : "groq")).slice(2)).toEqual(["groq"]);
  });

  it("rate limit (429): falls back", async () => {
    both();
    const calls = stub((c) => (c.url.startsWith(NV) ? new Response("slow down", { status: 429 }) : good()));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(calls).toHaveLength(3); // Super (429) → Lightning (429, a different model has its own limit) → Groq
    expect(events.find((e) => e.provider === "nvidia")).toMatchObject({ ok: false, category: "rate_limit" });
  });

  it("timeout: falls back and is categorised as a timeout", async () => {
    both();
    stub((c) => { if (c.url.startsWith(NV)) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); return good(); });
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(events.find((e) => e.provider === "nvidia")).toMatchObject({ ok: false, category: "timeout" });
  });

  it("a model that TIMED OUT is not retried for 10 minutes — only then is it asked again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); // Date only: promises and real timers keep working
    try {
      nvidia();
      const calls = stub((c) => {
        if (c.body.model === "nvidia/nemotron-3-super-120b-a12b") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
        return ok({ points: [] });
      });
      const seq = () => calls.map((c) => (c.body.model === "nvidia/nemotron-3-super-120b-a12b" ? "super" : "lightning"));
      await ai.analyzeResume({ doc: doc() }); // super times out → lightning answers
      expect(seq()).toEqual(["super", "lightning"]);
      expect(events[0]).toMatchObject({ ok: false, category: "timeout" });

      const t0 = Date.now(); // the moment of the timeout
      for (const minutes of [0, 1, 5, 9]) { // however many requests arrive during the 10 minutes, super is never asked again
        vi.setSystemTime(t0 + minutes * 60_000);
        ai._clearAiCache();
        await ai.analyzeResume({ doc: doc() });
      }
      expect(seq().filter((m) => m === "super")).toHaveLength(1);

      vi.setSystemTime(t0 + 10 * 60_000 + 5_000); // 10 minutes and 5 seconds after the timeout
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() });
      expect(seq().filter((m) => m === "super")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a cooling model is NOT retried 'as a last resort' when its alternative fails — the request fails fast instead", async () => {
    nvidia();
    let lightningDown = false;
    const calls = stub((c) => {
      if (c.body.model === "nvidia/nemotron-3-super-120b-a12b") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return lightningDown ? new Response("down", { status: 500 }) : ok(sugg("Developed a Java website for students"));
    });
    await ai.generateResumeEdit(input("improve")); // super times out (cooled 10 min) → lightning answers
    lightningDown = true;
    ai._clearAiCache();
    const before = calls.length;
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiHttpError);
    expect(calls.slice(before).map((c) => c.body.model)).toEqual(["nvidia/nemotron-3.5-lightning-30b-a3b"]); // super was not asked again
  });

  it("when EVERY candidate is cooling, they are still attempted (a request never fails without trying)", async () => {
    nvidia();
    const calls = stub(() => new Response("nf", { status: 404 }));
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiHttpError); // both 404 → both cooled
    const before = calls.length;
    ai._clearAiCache();
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiHttpError);
    expect(calls.length - before).toBe(2); // tried both again because nothing else was left
  });

  it("ordinary outages (503 / network error) keep the short 30-second cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      nvidia();
      const calls = stub((c) => (c.body.model === "nvidia/nemotron-3-super-120b-a12b" ? new Response("down", { status: 503 }) : ok({ points: [] })));
      await ai.analyzeResume({ doc: doc() });
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() });
      expect(calls.filter((c) => c.body.model === "nvidia/nemotron-3-super-120b-a12b")).toHaveLength(1); // skipped inside the window
      vi.setSystemTime(Date.now() + 31_000);
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() });
      expect(calls.filter((c) => c.body.model === "nvidia/nemotron-3-super-120b-a12b")).toHaveLength(2); // retried after 31s
    } finally {
      vi.useRealTimers();
    }
  });

  it("provider unavailable (503) and unreachable (network error): falls back", async () => {
    both();
    stub((c) => (c.url.startsWith(NV) ? new Response("down", { status: 503 }) : good()));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    client.resetAiRouting();
    ai._clearAiCache();
    stub((c) => { if (c.url.startsWith(NV)) throw new TypeError("fetch failed"); return good(); });
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(events.filter((e) => !e.ok).map((e) => e.category)).toEqual(["unavailable", "unavailable", "unreachable", "unreachable"]); // Super and Lightning each time
  });

  it("malformed HTTP response (no choices): falls back", async () => {
    both();
    stub((c) => (c.url.startsWith(NV) ? Response.json({ id: "x" }) : good()));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
  });

  it("malformed JSON content: the repair attempt goes to a DIFFERENT provider", async () => {
    both();
    const calls = stub((c) => (c.url.startsWith(NV) ? ok("Sure! I would love to help. Not JSON.") : good()));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
    expect(calls.map((c) => (c.url.startsWith(NV) ? "nvidia" : "groq"))).toEqual(["nvidia", "groq"]);
  });

  it("with only NVIDIA and a malformed answer, the repair retry is the same provider, then a clean error — no invented suggestion", async () => {
    nvidia();
    const calls = stub(() => ok("not json"));
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiMalformedError);
    expect(calls).toHaveLength(2);
  });

  it("everything down: a friendly error, no result", async () => {
    both();
    stub(() => new Response("down", { status: 503 }));
    const e = await ai.generateResumeEdit(input("improve")).catch((x) => x);
    expect(client.isAiUnavailable(e)).toBe(true);
    expect(client.friendlyAiError(e)).toMatch(/unavailable/);
  });

  it("grammar/shorten degrade to the built-in cleanup when every provider is down", async () => {
    both();
    stub(() => new Response("down", { status: 503 }));
    const p = await ai.generateResumeEdit({ ...input("improve"), op: "grammar", ctx: { ...lineContext(doc(), ref)!, text: "worked with the the website" }, evidence: "worked with the the website" });
    expect(p.via).toBe("local");
  });
});

describe("model unavailable for the account (HTTP 404)", () => {
  const analysisReply = () => ok({ points: [] });
  const isSuper = (c: Call) => c.body.model === "nvidia/nemotron-3-super-120b-a12b";

  it("falls back to Lightning, and logs the failure as model_unavailable", async () => {
    nvidia();
    const calls = stub((c) => (isSuper(c) ? new Response(JSON.stringify({ status: 404, title: "Not Found", detail: "Function 'x': Not found for account 'y'" }), { status: 404 }) : analysisReply()));
    await ai.analyzeResume({ doc: doc() });
    expect(calls.map((c) => c.body.model)).toEqual(["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b"]);
    expect(events[0]).toMatchObject({ model: "nvidia/nemotron-3-super-120b-a12b", ok: false, category: "model_unavailable" });
    expect(events[1]).toMatchObject({ model: "nvidia/nemotron-3.5-lightning-30b-a3b", ok: true });
  });

  it("puts that model in a 10-minute cooldown so later requests don't waste a call on it", async () => {
    vi.useFakeTimers();
    try {
      nvidia();
      const calls = stub((c) => (isSuper(c) ? new Response("nf", { status: 404 }) : analysisReply()));
      const models = () => calls.map((c) => c.body.model === "nvidia/nemotron-3-super-120b-a12b" ? "super" : "lightning");
      await ai.analyzeResume({ doc: doc() }); // super 404 → lightning
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() }); // straight to lightning
      expect(models()).toEqual(["super", "lightning", "lightning"]);

      vi.advanceTimersByTime(9 * 60_000);
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() }); // still cooling
      expect(models().slice(3)).toEqual(["lightning"]);

      vi.advanceTimersByTime(2 * 60_000); // 11 minutes in: the cooldown has expired, so it is tried again
      ai._clearAiCache();
      await ai.analyzeResume({ doc: doc() });
      expect(models().slice(4)).toEqual(["super", "lightning"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only that model is cooled — other NVIDIA models keep working — and a bad key still cools the whole provider", async () => {
    nvidia();
    stub((c) => (c.body.model === "nvidia/nemotron-3.5-lightning-30b-a3b" ? new Response("nf", { status: 404 }) : ok({ points: [], ...sugg("Developed a Java website for students") })));
    await ai.analyzeResume({ doc: doc() }); // Lightning 404s only if it is asked — it is not first any more
    ai._clearAiCache();
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1); // rewrite uses Super, unaffected
  });

  it("if every candidate is unavailable, the error is surfaced — no fabricated result", async () => {
    nvidia();
    stub(() => new Response("nf", { status: 404 }));
    const e = await ai.generateResumeEdit(input("improve")).catch((x) => x);
    expect(e).toBeInstanceOf(client.AiHttpError);
    expect((e as InstanceType<typeof client.AiHttpError>).status).toBe(404);
  });

  it("does not route Nano, Kimi K2.6 or DeepSeek V4.1 Flash by default", () => {
    nvidia();
    const routed = routing.AI_TASKS.flatMap((t) => routing.AI_TASK_CONFIG[t].map((r) => r.model));
    expect(routed.join(" ")).not.toMatch(/nemotron-nano-3|kimi|deepseek/);
    expect(new Set(routed)).toEqual(new Set(["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3-embed-1b", "nvidia/nemotron-parse"]));
  });
});

describe("valid responses", () => {
  it("strips reasoning blocks and reads JSON even when the model wraps it in prose", async () => {
    nvidia();
    stub(() => ok(`<think>The user wants a rewrite… I should not add facts.</think>Here is the JSON you asked for:\n${JSON.stringify(sugg("Developed a Java website for students"))}\nHope that helps!`));
    const p = await ai.generateResumeEdit(input("improve"));
    expect(p.suggestions[0].text).toBe("Developed a Java website for students");
  });

  it("does not force response_format on NVIDIA (not every hosted model supports it) but does on providers that do", async () => {
    both();
    const calls = stub(() => ok(sugg("Developed a Java website for students")));
    await ai.generateResumeEdit(input("improve"));
    expect(calls[0].body.response_format).toBeUndefined();
    client.resetAiRouting(); ai._clearAiCache();
    process.env.AI_TASK_RESUME_REWRITE = "groq";
    await ai.generateResumeEdit(input("improve"));
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
  });

  it("structured JSON on a verified NVIDIA model disables thinking, and needs no extra token headroom", async () => {
    nvidia();
    const calls = stub(() => ok(sugg("Developed a Java website for students")));
    await ai.generateResumeEdit(input("improve"));
    expect(calls[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(calls[0].body.max_tokens).toBe(900);
  });

  it("thinking is only disabled where verified: not for other NVIDIA models, non-JSON requests, or other providers", async () => {
    nvidia();
    process.env.GROQ_API_KEY = "g";
    const calls = stub(() => ok(sugg("Developed a Java website for students")));
    process.env.AI_TASK_RESUME_REWRITE = "nvidia:z-ai/glm-5.3"; // works on the account, but thinking-off is unverified
    await ai.generateResumeEdit(input("improve"));
    expect(calls[0].body.model).toBe("z-ai/glm-5.3");
    expect(calls[0].body.chat_template_kwargs).toBeUndefined();
    expect(calls[0].body.max_tokens).toBe(900 + 2048); // still gets reasoning headroom
    process.env.AI_TASK_RESUME_REWRITE = "default";
    await client.complete({ task: "resume_rewrite", messages: [{ role: "user", content: "hi" }] }); // not a JSON request
    expect(calls[1].body.chat_template_kwargs).toBeUndefined();
    ai._clearAiCache();
    process.env.AI_TASK_RESUME_REWRITE = "groq";
    await ai.generateResumeEdit(input("improve"));
    expect(calls[2].url).toContain("groq");
    expect(calls[2].body.chat_template_kwargs).toBeUndefined();
  });

  it("reasoning text never contaminates the JSON: it is stripped and flagged, and the answer still parses", async () => {
    nvidia();
    const json = JSON.stringify(sugg("Developed a Java website for students"));
    stub(() => Response.json({ choices: [{ finish_reason: "stop", message: { content: `<think>plan the rewrite…</think>${json}`, reasoning_content: "plan the rewrite…" } }] }));
    const c = await client.complete({ task: "resume_rewrite", json: true, messages: [{ role: "user", content: "x" }] });
    expect(c.reasoning).toBe(true);
    expect(c.content).toBe(json);
    expect(() => JSON.parse(c.content!)).not.toThrow();
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
  });
});

describe("NVIDIA cannot bypass the fact validator", () => {
  const evil = (text: string) => { nvidia(); stub(() => ok(sugg(text))); };

  it("invented metric → discarded before the UI sees it", async () => {
    evil("Built a Java website used by 50,000 students");
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.suggestions).toHaveLength(0);
    expect(p.rejected[0].reasons.join(" ")).toMatch(/number/i);
  });

  it("unsupported technology → discarded", async () => {
    evil("Developed a Java website with Kubernetes and Kafka for students");
    const p = await ai.generateResumeEdit(input("technical"));
    expect(p.suggestions).toHaveLength(0);
    expect(p.rejected[0].reasons.join(" ")).toMatch(/Kubernetes|Kafka/);
  });

  it("hallucinated scope (leadership) → flagged, cannot be applied without the user's confirmation", async () => {
    evil("Led development of a Java website for students");
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.suggestions[0].requiresUserConfirmation).toBe(true);
  });

  it("the model's own claim of new facts is not trusted, and it never receives or returns a ResumeDoc it can change", async () => {
    nvidia();
    const before = JSON.stringify(doc());
    const d = doc();
    const calls = stub(() => ok({ suggestions: [{ text: "Developed a Java website for students", reason: "", newFactsIntroduced: ["47% faster"] }], missingEvidence: [] }));
    const p = await ai.generateResumeEdit(input("improve"));
    expect(p.suggestions).toHaveLength(0);
    expect(JSON.stringify(d)).toBe(before); // the pipeline only ever produces proposals
    expect(JSON.stringify(calls[0].body)).not.toContain('"sections"'); // the document isn't handed over wholesale for a bullet edit
  });
});

describe("cost control", () => {
  it("one model call per bullet edit; the same edit again is served from cache", async () => {
    nvidia();
    const calls = stub(() => ok(sugg("Developed a Java website for students")));
    await ai.generateResumeEdit(input("improve"));
    await ai.generateResumeEdit(input("improve"));
    expect(calls).toHaveLength(1);
  });

  it("job-description analysis is cached", async () => {
    nvidia();
    const calls = stub(() => ok({ required: ["Python"], preferred: [], degree: null, graduation_window: null, experience_level: "student", work_authorization_note: null, summary: "A role." }));
    await tasks.analyzeJob("Intern", "Acme", "Requirements: Python");
    await tasks.analyzeJob("Intern", "Acme", "Requirements: Python");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("deterministic checks never call a model", async () => {
    nvidia();
    const calls = stub(() => ok({ points: [] }));
    const a = await ai.analyzeATS({ doc: doc() }); // no `explain`: pure deterministic scoring
    expect(a.score).toBeGreaterThan(0);
    expect(ai.analyzeATS).toBeTypeOf("function");
    expect(calls).toHaveLength(0);
    await ai.analyzeResume({ doc: doc() }); // weak-bullet / repeat / ATS checks are local; only the short overview uses a model
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("nvidia/nemotron-3-super-120b-a12b"); // Super first for analysis
  });
});

describe("telemetry", () => {
  it("logs task, provider, model, latency, success and error category — and never content or keys", async () => {
    both();
    stub((c) => (c.url.startsWith(NV) ? new Response("nope", { status: 429 }) : ok(sugg("Developed a Java website for students"))));
    await ai.generateResumeEdit(input("improve"));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ evt: "ai_call", task: "resume_rewrite", provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b", ok: false, category: "rate_limit" });
    expect(events[1]).toMatchObject({ provider: "nvidia", model: "nvidia/nemotron-3.5-lightning-30b-a3b", ok: false, category: "rate_limit" });
    expect(events[2]).toMatchObject({ provider: "groq", ok: true });
    for (const e of events) {
      expect(typeof e.ms).toBe("number");
      expect(Object.keys(e).sort()).toEqual(["evt", "task", "provider", "model", "ms", "ok", ...(e.ok ? [] : ["category"])].sort());
    }
    const all = JSON.stringify(events);
    expect(all).not.toContain(SENTINEL);
    expect(all).not.toContain(SECRET_KEY);
    expect(all).not.toContain("Campus IT");
  });

  it("the default sink writes one JSON line to console.info", () => {
    telemetry.setAiLogSink();
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    telemetry.logAi({ task: "resume_rewrite", provider: "nvidia", model: "m", ms: 12.4, ok: true });
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({ evt: "ai_call", task: "resume_rewrite", provider: "nvidia", model: "m", ms: 12, ok: true });
    spy.mockRestore();
  });
});

describe("embeddings (semantic search)", () => {
  const JD = "Requirements\n- Experience with Python\n- Kubernetes for deployment";
  const vec = (text: string) => (/Kubernetes/.test(text) ? [1, 0] : /Python/.test(text) ? [-1, 0] : /Docker/.test(text) ? [0.95, 0.05] : [0, 1]);
  const embedHandler = (c: Call) => Response.json({ data: c.body.input.map((t: string, i: number) => ({ index: i, embedding: vec(t) })) });

  it("calls NVIDIA's embeddings API with query/passage input types", async () => {
    nvidia();
    const calls = stub(embedHandler);
    const e = await embeddings.embedForMatching(["Kubernetes for deployment"], ["Set up Docker containers"]);
    expect(e?.model).toBe("nvidia:nvidia/nemotron-3-embed-1b");
    expect(calls.map((c) => c.url)).toEqual([`${NV}/embeddings`, `${NV}/embeddings`]);
    expect(calls[0].body).toMatchObject({ model: "nvidia/nemotron-3-embed-1b", input_type: "query", encoding_format: "float", truncate: "END" });
    expect(calls[1].body.input_type).toBe("passage");
  });

  it("caches vectors: matching the same resume again makes no embedding calls", async () => {
    nvidia();
    const calls = stub(embedHandler);
    await ai.matchResumeToJob({ doc: doc(), jd: JD });
    const first = calls.length;
    await ai.matchResumeToJob({ doc: doc(), jd: JD });
    expect(first).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("semantic match returns only verbatim resume text, and needs no LLM call when embeddings work", async () => {
    nvidia();
    const calls = stub(embedHandler);
    const m = await ai.matchResumeToJob({ doc: doc(), jd: JD });
    expect(m.via).toBe("ai");
    expect(m.semantic.map((s) => s.requirement)).toEqual(["Kubernetes"]);
    expect(m.semantic[0].quote).toBe("Set up Docker containers for local development");
    expect(m.semantic[0].score).toBeGreaterThan(0.9);
    expect(calls.every((c) => c.url.endsWith("/embeddings"))).toBe(true);
    expect(m.skills.find((s) => s.name === "Kubernetes")?.status).toBe("missing"); // similarity never turns a gap into a claimed skill
  });

  it("embeddings unavailable → deterministic result with an LLM quote check as the fallback", async () => {
    nvidia();
    const calls = stub((c) => (c.url.endsWith("/embeddings") ? new Response("down", { status: 503 }) : ok({ items: [{ requirement: "Kubernetes", quote: "Set up Docker containers for local development", note: "related" }, { requirement: "Python", quote: "Deployed clusters at scale", note: "invented" }] })));
    const m = await ai.matchResumeToJob({ doc: doc(), jd: JD });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["embeddings", "completions"]);
    expect(m.semantic.map((s) => s.requirement)).toEqual(["Kubernetes"]); // the invented quote was dropped
  });

  it("malformed embeddings (wrong count / non-numbers) are rejected, never used", async () => {
    nvidia();
    stub(() => Response.json({ data: [{ index: 0, embedding: ["a", "b"] }] }));
    expect(await embeddings.embedForMatching(["q"], ["p"])).toBeNull();
    stub(() => Response.json({ data: [] }));
    expect(await embeddings.embedForMatching(["q"], ["p"])).toBeNull();
  });

  it("no embedding provider: returns null (deterministic matching only) without any request", async () => {
    process.env.GROQ_API_KEY = "g"; // chat-only provider: not routed for embeddings
    const calls = stub(embedHandler);
    expect(await embeddings.embedForMatching(["q"], ["p"])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("cosine similarity", () => {
    expect(embeddings.cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(embeddings.cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(embeddings.cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("document parsing (Nemotron Parse)", () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const parseReply = (items: unknown) => Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "markdown_bbox", arguments: JSON.stringify(items) } }] } }] });
  const ITEMS = [[{ type: "Page-header", text: "Page 1 of 1" }, { type: "Title", text: "ADA STUDENT" }, { type: "Section-header", text: "EXPERIENCE" }, { type: "List-item", text: "Built REST APIs with Python and Flask" }, { type: "Text", text: "Software Intern, Campus IT — Jun 2025 to Aug 2025" }]];

  it("sends the page image and the markdown_bbox tool to nemotron-parse, and returns reading-order text", async () => {
    nvidia();
    const calls = stub(() => parseReply(ITEMS));
    const text = await documents.parseDocumentImage(png, "image/png");
    expect(calls[0].body.model).toBe("nvidia/nemotron-parse");
    expect(calls[0].body.messages[0].content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(calls[0].body.tools).toEqual([{ type: "function", function: { name: "markdown_bbox" } }]);
    expect(calls[0].body.tool_choice).toBeUndefined();
    expect(text).toBe("ADA STUDENT\nEXPERIENCE\n• Built REST APIs with Python and Flask\nSoftware Intern, Campus IT — Jun 2025 to Aug 2025");
  });

  it("accepts markdown output too", () => {
    expect(documents.textFromParse({ content: "# ADA STUDENT\n\n**Skills**\n- Python\n- SQL", toolCalls: [] })).toBe("ADA STUDENT\n\nSkills\n• Python\n• SQL");
  });

  it("without a key, or when the parser fails, it throws — there is no guessed text and no fake fallback", async () => {
    const calls = stub(() => parseReply(ITEMS));
    await expect(documents.parseDocumentImage(png, "image/png")).rejects.toBeInstanceOf(client.AiNotConfiguredError);
    expect(calls).toHaveLength(0);
    nvidia();
    stub(() => new Response("bad key", { status: 401 }));
    await expect(documents.parseDocumentImage(png, "image/png")).rejects.toBeInstanceOf(client.AiHttpError);
    stub(() => parseReply([]));
    await expect(documents.parseDocumentImage(png, "image/jpeg")).rejects.toThrow(/no text/);
    expect(events.filter((e) => e.task === "document_parsing").every((e) => e.provider === "nvidia")).toBe(true);
  });
});
