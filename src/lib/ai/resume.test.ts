import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineContext, basisOf, type LineRef } from "@/lib/resume/edits";
import type { ResumeDoc } from "@/lib/resume/types";

vi.mock("server-only", () => ({}));
const client = await import("./client");
const ai = await import("./resume");

const line = (id: string, text: string) => ({ id, text, origin: "user" as const, sourceItemId: null });
const doc = (): ResumeDoc => ({
  version: 1,
  header: { name: "Ada Student", contact: ["ada@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Software Intern", subheading: "Campus IT", meta: "Jun 2025 – Aug 2025", origin: "user", bullets: [line("b1", "Worked with Java on a website for students"), line("b2", "Fixed bugs in the help desk tool")] }] },
    { id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "Chess Engine", subheading: "C++", meta: "2024", origin: "user", bullets: [line("b3", "Wrote a move generator")] }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: Python, Java, SQL"), line("s2", "Tools: Git, Linux")] },
  ],
});
const ref: LineRef = { sectionId: "exp", entryId: "e1", lineId: "b1" };
const target = { kind: "line" as const, ...ref };
const ctx = () => lineContext(doc(), ref)!;
const input = (op: "improve" | "shorten" | "grammar" | "alternatives" | "impactful" | "technical" | "ats") => ({ op, target, ctx: ctx(), evidence: basisOf(ctx()) });

const reply = (obj: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] });
const sugg = (...texts: string[]) => ({ suggestions: texts.map((text) => ({ text, reason: "clearer", newFactsIntroduced: [] })), missingEvidence: [] });

const ENV = ["AI_PROVIDER", "AI_MODEL", "AI_BASE_URL", "AI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  ai._clearAiCache();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});
const withGroq = (fn: ReturnType<typeof vi.fn>) => { process.env.GROQ_API_KEY = "g"; vi.stubGlobal("fetch", fn); return fn; };
const bodyOf = (fn: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((fn.mock.calls[i][1] as RequestInit).body as string) as { messages: { content: string }[] };

describe("bullet edits: factual integrity on model output", () => {
  it("returns a clean rewrite as an applicable suggestion", async () => {
    withGroq(vi.fn(async () => reply(sugg("Developed a Java website for students"))));
    const p = await ai.generateResumeEdit(input("improve"));
    expect(p.via).toBe("ai");
    expect(p.suggestions[0]).toMatchObject({ text: "Developed a Java website for students", requiresUserConfirmation: false, newFacts: [] });
  });

  it("DISCARDS a suggestion that invents a metric ('…used by 50,000 users')", async () => {
    withGroq(vi.fn(async () => reply(sugg("Built a Java website used by 50,000 students"))));
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.suggestions).toHaveLength(0);
    expect(p.rejected[0].reasons.join(" ")).toMatch(/number/i);
    expect(p.note).toMatch(/discarded because they added facts/);
  });

  it("REJECTS the inflated rewrite ('Worked with Java' → 'Architected a distributed Java microservices platform')", async () => {
    withGroq(vi.fn(async () => reply(sugg("Architected a distributed Java microservices platform"))));
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.suggestions).toHaveLength(0); // "microservices" is a technology the resume never mentions
    expect(p.rejected[0].reasons.join(" ")).toMatch(/Microservices/i);
  });

  it("FLAGS a pure scope upgrade for confirmation instead of applying it ('Worked with' → 'Led')", async () => {
    withGroq(vi.fn(async () => reply(sugg("Led development of a Java website for students"))));
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.suggestions[0].requiresUserConfirmation).toBe(true);
    expect(p.suggestions[0].newFacts.map((f) => f.claim.toLowerCase())).toContain("led");
  });

  it("DISCARDS a suggestion that introduces a technology the resume never mentions", async () => {
    withGroq(vi.fn(async () => reply(sugg("Developed a Java website with Spring Boot and Kafka for students"))));
    const p = await ai.generateResumeEdit(input("technical"));
    expect(p.suggestions).toHaveLength(0);
    expect(p.rejected[0].reasons.join(" ")).toMatch(/Spring Boot|Kafka/);
  });

  it("does not trust the model's own newFactsIntroduced: a self-reported number rejects the suggestion", async () => {
    withGroq(vi.fn(async () => reply({ suggestions: [{ text: "Developed a Java website for students", reason: "", newFactsIntroduced: ["47% faster"] }], missingEvidence: [] })));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(0);
  });

  it("suggests what evidence is missing instead of inventing it, and never puts numbers in the hint", async () => {
    withGroq(vi.fn(async () => reply({ suggestions: [], missingEvidence: ["Add the measured load-time reduction, e.g. 40%, if you have it.", "Add the number of students who used it if you know."] })));
    const p = await ai.generateResumeEdit(input("impactful"));
    expect(p.missingEvidence).toEqual(["Add the number of students who used it if you know."]);
  });

  it("adds our own missing-evidence hint when the bullet has no measurement and the model gave none", async () => {
    withGroq(vi.fn(async () => reply(sugg("Developed a Java website for students"))));
    expect((await ai.generateResumeEdit(input("impactful"))).missingEvidence[0]).toMatch(/^Missing evidence/);
  });

  it("sends only the bullet and its own entry — not the rest of the resume", async () => {
    const f = withGroq(vi.fn(async () => reply(sugg("Developed a Java website for students"))));
    await ai.generateResumeEdit(input("improve"));
    const sent = bodyOf(f).messages.map((m) => m.content).join("\n");
    expect(sent).toContain("Worked with Java on a website for students");
    expect(sent).toContain("Campus IT");
    expect(sent).not.toContain("Chess Engine");
    expect(sent).not.toContain("Languages: Python");
    expect(sent).not.toContain("ada@example.com");
  });

  it("caches identical requests (one provider call, not two)", async () => {
    const f = withGroq(vi.fn(async () => reply(sugg("Developed a Java website for students"))));
    await ai.generateResumeEdit(input("improve"));
    await ai.generateResumeEdit(input("improve"));
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("malformed model output", () => {
  it("retries once with feedback, then fails cleanly without changing anything", async () => {
    const f = withGroq(vi.fn(async () => reply("Sure! Here you go: definitely not JSON")));
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiMalformedError);
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1).messages.at(-1)!.content).toMatch(/not valid JSON/);
  });

  it("rejects valid JSON of the wrong shape", async () => {
    withGroq(vi.fn(async () => reply({ suggestions: "make it better" })));
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiMalformedError);
  });

  it("recovers when the second attempt is valid, and strips code fences", async () => {
    let n = 0;
    withGroq(vi.fn(async () => (n++ ? reply("```json\n" + JSON.stringify(sugg("Developed a Java website for students")) + "\n```") : reply("oops"))));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
  });

  it("drops empty, duplicate and echoed suggestions", async () => {
    withGroq(vi.fn(async () => reply(sugg("", "Worked with Java on a website for students", "Developed a Java website", "developed a java website"))));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
  });
});

describe("missing API keys", () => {
  it("AI-only operations say so plainly (HTTP 503 upstream) and never call the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(ai.generateResumeEdit(input("improve"))).rejects.toBeInstanceOf(client.AiNotConfiguredError);
    await expect(ai.generateSummary({ doc: doc() })).rejects.toBeInstanceOf(client.AiNotConfiguredError);
    expect(f).not.toHaveBeenCalled();
  });

  it("grammar and shorten still work locally", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const messy = { ...input("grammar"), ctx: { ...ctx(), text: "worked with the the website ,for students" }, evidence: "worked with the the website ,for students" };
    const p = await ai.generateResumeEdit(messy);
    expect(p.via).toBe("local");
    expect(p.suggestions[0].text).toBe("Worked with the website, for students");
  });

  it("deterministic analysis works with no keys at all", async () => {
    const a = await ai.analyzeResume({ doc: doc() });
    expect(a.via).toBe("deterministic");
    expect(a.overview).toBeNull();
    expect(a.ats.components.length).toBeGreaterThan(5);
    const m = await ai.matchResumeToJob({ doc: doc(), jd: "Requirements\n- Java, Kubernetes" });
    expect(m.via).toBe("deterministic");
    expect(m.skills.find((s) => s.name === "Kubernetes")?.status).toBe("missing");
    expect((await ai.analyzeATS({ doc: doc(), explain: true })).plan).toBeNull();
  });

  it("skills ordering works with no keys when a job is supplied", async () => {
    const p = await ai.optimizeSkills({ doc: doc(), sectionId: "skl", keywords: ["SQL"] });
    expect(p.via).toBe("local");
    expect(p.suggestions[0].text).toBe("Languages: SQL, Python, Java\nTools: Git, Linux");
  });
});

describe("provider selection and fallback", () => {
  it("uses the preferred provider first", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "m";
    process.env.AI_PROVIDER = "gemini";
    const f = vi.fn(async () => reply(sugg("Developed a Java website for students")));
    vi.stubGlobal("fetch", f);
    await ai.generateResumeEdit(input("improve"));
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("generativelanguage.googleapis.com");
  });

  it("falls back to the other provider when the first is rate-limited", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "m";
    const f = vi.fn(async (url: string) => (url.includes("groq") ? new Response("busy", { status: 429 }) : reply(sugg("Developed a Java website for students"))));
    vi.stubGlobal("fetch", f);
    const p = await ai.generateResumeEdit(input("improve"));
    expect(p.suggestions).toHaveLength(1);
    expect(f.mock.calls.map((c) => (c as unknown as [string])[0]).map((u) => (u.includes("groq") ? "groq" : "gemini"))).toEqual(["groq", "gemini"]);
  });

  it("falls back when the first provider is down", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "m";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (url.includes("groq")) throw new TypeError("fetch failed"); return reply(sugg("Developed a Java website for students")); }));
    expect((await ai.generateResumeEdit(input("improve"))).suggestions).toHaveLength(1);
  });

  it("when every provider fails, grammar degrades to the local cleanup and other ops surface a friendly error", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GEMINI_API_KEY = "m";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const g = await ai.generateResumeEdit({ ...input("grammar"), ctx: { ...ctx(), text: "worked with the the website" }, evidence: "worked with the the website" });
    expect(g.via).toBe("local");
    expect(g.note).toMatch(/unavailable/);
    const e = await ai.generateResumeEdit(input("improve")).catch((x) => x);
    expect(client.isAiUnavailable(e)).toBe(true);
    expect(client.friendlyAiError(e)).toMatch(/unavailable/);
  });
});

describe("summary, skills, semantic match, ATS plan", () => {
  it("summary is built from the resume digest only and rejects invented experience", async () => {
    const f = withGroq(vi.fn(async () => reply(sugg("Computer science student with Java and SQL experience from a campus IT internship", "Software developer with 5 years of experience in Java"))));
    const p = await ai.generateSummary({ doc: doc() });
    expect(p.suggestions).toHaveLength(1);
    expect(p.rejected).toHaveLength(1);
    expect(p.target).toEqual({ kind: "summary" });
    expect(bodyOf(f).messages.at(-1)!.content).toContain("Campus IT");
  });

  it("AI skills regrouping may not add a skill", async () => {
    withGroq(vi.fn(async () => reply(sugg("Languages: Java, Python, SQL\nTools: Git, Linux", "Languages: Java, Python, SQL, Go\nTools: Git, Linux, Docker"))));
    const p = await ai.optimizeSkills({ doc: doc(), sectionId: "skl", keywords: [] });
    expect(p.suggestions.map((s) => s.text)).toEqual(["Languages: Java, Python, SQL\nTools: Git, Linux"]);
    expect(p.rejected[0].reasons.join(" ")).toMatch(/Go|Docker/);
  });

  it("semantic match keeps a quote only if it appears verbatim in the resume", async () => {
    withGroq(vi.fn(async () => reply({ items: [
      { requirement: "REST APIs", quote: "Worked with Java on a website for students", note: "web work" },
      { requirement: "Kubernetes", quote: "Deployed clusters on Kubernetes at scale", note: "invented" },
    ] })));
    const m = await ai.matchResumeToJob({ doc: doc(), jd: "Requirements\n- REST APIs and Kubernetes" });
    expect(m.semantic.map((s) => s.requirement)).toEqual(["REST APIs"]);
    expect(m.via).toBe("ai");
  });

  it("ATS plan can only point at the deterministic fixes that exist", async () => {
    withGroq(vi.fn(async () => reply({ actions: [{ fix: 0, why: "Recruiters need to reach you." }, { fix: 99, why: "invented" }, { fix: -1, why: "invented" }] })));
    const r = await ai.analyzeATS({ doc: doc(), explain: true });
    expect(r.plan!.length).toBe(1);
    expect(r.plan![0].fix.message).toBeTruthy();
  });
});

describe("resume assistant", () => {
  const run = (message: string, extra: Partial<Parameters<typeof ai.runResumeAssistant>[0]> = {}) =>
    ai.runResumeAssistant({ message, doc: doc(), contextFor: (r) => lineContext(doc(), r), evidenceFor: (r) => basisOf(lineContext(doc(), r)!), ...extra });

  it("routes analysis requests without a model", () => {
    expect(ai.classifyIntent("Find weak bullets.")).toBe("weak");
    expect(ai.classifyIntent("Find repeated words.")).toBe("repeats");
    expect(ai.classifyIntent("Find missing technologies.")).toBe("missing");
    expect(ai.classifyIntent("Compare this resume against the job description.")).toBe("match");
    expect(ai.classifyIntent("What's my ATS score?")).toBe("ats");
    expect(ai.classifyIntent("Write me a summary")).toBe("summary");
    expect(ai.classifyIntent("Make my experience section stronger.")).toBe("edit");
    expect(ai.classifyBulletOp("Shorten this bullet.")).toBe("shorten");
    expect(ai.classifyBulletOp("Make this sound more technical.")).toBe("technical");
  });

  it("finds weak bullets and answers job questions with no AI configured", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const weak = await run("Find weak bullets.");
    expect(weak.findings.length).toBeGreaterThan(0);
    expect(weak.usedAi).toBe(false);
    const noJd = await run("Compare this resume against the job description.");
    expect(noJd.reply).toMatch(/Paste the job description/);
    const miss = await run("Find missing technologies.", { jd: "Requirements\n- Java and Kubernetes" });
    expect(miss.reply).toMatch(/Kubernetes/);
    expect(miss.reply).toMatch(/only add one if you genuinely have/i);
  });

  it("tells the user AI needs configuration for rewrites, instead of pretending", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const r = await run("Make my experience section stronger.");
    expect(r.reply).toMatch(/GROQ_API_KEY or GEMINI_API_KEY/);
    expect(r.proposals).toEqual([]);
  });

  it("returns structured edits for a section request, dropping unknown ids and invented facts", async () => {
    const f = withGroq(vi.fn(async () => reply({
      reply: "Tightened the wording.",
      edits: [
        { id: "b1", text: "Developed a Java website for students", reason: "clearer" },
        { id: "b2", text: "Fixed 120 bugs in the help desk tool", reason: "adds a number" },
        { id: "nope", text: "Anything", reason: "unknown line" },
      ],
    })));
    const r = await run("Make my experience section stronger.");
    expect(r.usedAi).toBe(true);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[0].suggestions[0].text).toBe("Developed a Java website for students");
    expect(r.proposals[1].suggestions).toHaveLength(0);
    expect(r.reply).toMatch(/1 edit was discarded/);
    const sent = bodyOf(f).messages.at(-1)!.content;
    expect(sent).toContain("[b1]");
    expect(sent).not.toContain("Chess Engine"); // only the experience section was sent
  });

  it("edits just the selected bullet when one is selected", async () => {
    const f = withGroq(vi.fn(async () => reply(sugg("Used Java for a student website"))));
    const r = await run("Shorten this bullet.", { selection: ref });
    expect(r.proposals[0].op).toBe("shorten");
    expect(r.proposals[0].target).toMatchObject({ kind: "line", lineId: "b1" });
    expect(bodyOf(f).messages.at(-1)!.content).not.toContain("Chess Engine");
  });
});
