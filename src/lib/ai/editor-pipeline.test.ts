import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySuggestion, basisOf, lineContext, type LineRef } from "@/lib/resume/edits";
import { diffDocs, numbered } from "@/lib/resume/history";
import type { CandidateItem, ResumeDoc } from "@/lib/resume/types";
import { validateDoc } from "@/lib/resume/validate";

vi.mock("server-only", () => ({}));
const client = await import("./client");
const telemetry = await import("./telemetry");
const embeddings = await import("./embeddings");
const cache = await import("./cache");
const ai = await import("./resume");

// The pipeline under test:  ResumeDoc → selected bullet → Nemotron Super → structured suggestion → fact validator
// → risk / new claims → before/after → user accepts → ResumeDoc → version history. Only `fetch` is stubbed.

const line = (id: string, text: string, sourceItemId: string | null = null) => ({ id, text, origin: (sourceItemId ? "profile" : "user") as "profile" | "user", sourceItemId });
const docWith = (bullets: string[], extra: Partial<ResumeDoc> = {}): ResumeDoc => ({
  version: 1,
  header: { name: "Sample Student", contact: ["sample@example.com"], origin: "user" },
  sections: [
    { id: "exp", kind: "experience", title: "Experience", lines: [], entries: [{ id: "e1", sourceItemId: null, heading: "Software Intern", subheading: "Campus IT", meta: "2025", origin: "user", bullets: bullets.map((b, i) => line(`b${i + 1}`, b)) }] },
    { id: "skl", kind: "skills", title: "Skills", entries: [], lines: [line("s1", "Languages: JavaScript, SQL")] },
  ],
  ...extra,
});
const ref: LineRef = { sectionId: "exp", entryId: "e1", lineId: "b1" };
const req = (doc: ResumeDoc, op: Parameters<typeof ai.generateResumeEdit>[0]["op"], userFacts?: string) => {
  const ctx = lineContext(doc, ref)!;
  return { op, target: { kind: "line" as const, ...ref }, ctx, evidence: basisOf(ctx), userFacts };
};

type Call = { url: string; body: { model: string; messages: { content: string }[]; input?: string[]; input_type?: string } };
const chat = (content: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
const sug = (...items: (string | { text: string; sourceEvidence?: string[] })[]) => ({
  suggestions: items.map((i) => (typeof i === "string" ? { text: i, reason: "clearer wording" } : { reason: "clearer wording", ...i })),
  missingEvidence: [],
});
function stub(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const c: Call = { url, body: JSON.parse(init.body as string) };
    calls.push(c);
    return handler(c);
  }));
  return calls;
}

const ENV = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_EMBED_MIN_SIM", "NVIDIA_API_KEY"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.NVIDIA_API_KEY = "nvapi-test";
  client.resetAiRouting(); cache.clearAiCache(); embeddings.clearEmbeddingCache();
  telemetry.setAiLogSink(() => undefined);
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  telemetry.setAiLogSink();
});

describe("1. safe paraphrase", () => {
  it("'Built React application.' → a rewording is accepted, with evidence and no new claims", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug({ text: "Developed a React application.", sourceEvidence: ["Built React application."] })));
    const p = await ai.generateResumeEdit(req(doc, "improve"));
    expect(p.rejected).toEqual([]);
    const s = p.suggestions[0];
    expect(s).toMatchObject({ text: "Developed a React application.", newClaims: [], riskLevel: "none", requiresConfirmation: false, requiresUserConfirmation: false, newFacts: [] });
    expect(s.evidence[0]).toBe("Built React application."); // the original is always the first piece of evidence
    expect(s.evidence.join(" ")).toContain("React");

    const applied = applySuggestion(doc, p.target, s.text, { op: p.op, basis: p.basis });
    expect(applied.sections[0].entries[0].bullets[0]).toMatchObject({ text: "Developed a React application.", origin: "ai", ai: { op: "improve" } });
    expect(validateDoc(applied, []).ok).toBe(true);
  });
});

describe("2. invented metric", () => {
  it("'…used by 50,000 users' is blocked and flagged high-risk with the claim named", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug("Built React application used by 50,000 users.")));
    const p = await ai.generateResumeEdit(req(doc, "impactful"));
    expect(p.suggestions).toEqual([]); // never offered as something you can accept
    expect(p.rejected[0]).toMatchObject({ riskLevel: "high", newClaims: ["50,000 users"] });
    expect(p.rejected[0].reasons.join(" ")).toMatch(/number/i);
    expect(p.rejected[0].evidence[0]).toBe("Built React application."); // shows what it was rewriting
  });

  it("even if a tampered client wrote it into the document, the server-side check refuses it on save/export", () => {
    const doc = docWith(["Built React application."]);
    const forced = applySuggestion(doc, { kind: "line", ...ref }, "Built React application used by 50,000 users.", { op: "improve", basis: "Built React application." });
    const v = validateDoc(forced, []);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.claim)).toContain("50000");
  });
});

describe("3. invented technology", () => {
  it("'Built backend using Node.js.' → '…Node.js and AWS' is blocked: AWS appears nowhere in the resume text it may use", async () => {
    const doc = docWith(["Built backend using Node.js."]);
    stub(() => chat(sug("Built backend using Node.js and AWS.")));
    const p = await ai.generateResumeEdit(req(doc, "technical"));
    expect(p.suggestions).toEqual([]);
    expect(p.rejected[0]).toMatchObject({ riskLevel: "high", newClaims: ["AWS"] });
  });

  it("…but AWS is allowed when the same entry already supports it", async () => {
    const doc = docWith(["Built backend using Node.js.", "Deployed the services to AWS."]);
    stub(() => chat(sug("Built a Node.js backend deployed on AWS.")));
    const p = await ai.generateResumeEdit(req(doc, "technical"));
    expect(p.rejected).toEqual([]);
    expect(p.suggestions[0]).toMatchObject({ riskLevel: "none", newClaims: [] });
    expect(p.suggestions[0].evidence.join(" ")).toContain("AWS"); // shows the bullet that supports it
  });

  it("a skill merely listed in the Skills section does not license a project bullet to claim it", async () => {
    const doc = docWith(["Built backend using Node.js."]);
    doc.sections[1].lines[0].text = "Languages: JavaScript, SQL, AWS";
    stub(() => chat(sug("Built backend using Node.js and AWS.")));
    expect((await ai.generateResumeEdit(req(doc, "technical"))).suggestions).toEqual([]);
  });
});

describe("4. a real, user-provided metric", () => {
  it("'Quantify' with no number asks the student for one — no model call, and the questions contain no number", async () => {
    const doc = docWith(["Built a student web application using React."]);
    const calls = stub(() => chat(sug("x")));
    const p = await ai.generateResumeEdit(req(doc, "quantify"));
    expect(calls).toHaveLength(0);
    expect(p.suggestions).toEqual([]);
    expect(p.questions!.join(" ")).toMatch(/people use it|users/i);
    expect(p.questions!.join(" ")).toMatch(/never make one up/i);
    expect(p.questions!.join(" ")).not.toMatch(/\d/);
  });

  it("once the student supplies 'Used by 5,000 students', the AI may use exactly that figure", async () => {
    const doc = docWith(["Built a student web application using React."]);
    const calls = stub(() => chat(sug("Built a student web application in React, used by 5,000 students.")));
    const p = await ai.generateResumeEdit(req(doc, "quantify", "Used by 5,000 students"));
    expect(calls[0].body.messages.at(-1)!.content).toContain("<student_provided_fact>Used by 5,000 students</student_provided_fact>");
    expect(p.suggestions[0]).toMatchObject({ riskLevel: "none", newClaims: [] });
    expect(p.suggestions[0].evidence).toContain("You provided: Used by 5,000 students");

    // accepted → the fact travels with the line, so it validates on save and export
    const applied = applySuggestion(doc, p.target, p.suggestions[0].text, { op: p.op, basis: p.basis });
    expect(validateDoc(applied, []).ok).toBe(true);
  });

  it("…but not a different number: the student said 5,000, the AI wrote 50,000", async () => {
    const doc = docWith(["Built a student web application using React."]);
    stub(() => chat(sug("Built a student web application in React, used by 50,000 students.")));
    const p = await ai.generateResumeEdit(req(doc, "quantify", "Used by 5,000 students"));
    expect(p.suggestions).toEqual([]);
    expect(p.rejected[0]).toMatchObject({ riskLevel: "high", newClaims: ["50,000 students"] });
  });

  it("a user-provided fact is not a licence for other inventions in the same suggestion", async () => {
    const doc = docWith(["Built a student web application using React."]);
    stub(() => chat(sug("Built a student web application in React and AWS, used by 5,000 students.")));
    const p = await ai.generateResumeEdit(req(doc, "quantify", "Used by 5,000 students"));
    expect(p.suggestions).toEqual([]);
    expect(p.rejected[0].newClaims).toEqual(["AWS"]);
  });
});

describe("claim phrasing", () => {
  it("names a blocked number with its noun and no trailing conjunction ('50,000 users and AWS' → '50,000 users', 'AWS')", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug("Built React application used by 50,000 users and deployed on AWS.")));
    const p = await ai.generateResumeEdit(req(doc, "impactful"));
    expect(p.rejected[0].newClaims).toEqual(["50,000 users", "AWS"]);
  });
  it("also drops a trailing participle: '50,000 students using AWS' → '50,000 students'", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug("Built React application serving 50,000 students using AWS and Kubernetes.")));
    const p = await ai.generateResumeEdit(req(doc, "impactful"));
    expect(p.rejected[0].newClaims).toEqual(["50,000 students", "AWS", "Kubernetes"]);
  });
  it("lists the safest option first", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug("Led development of a React application.", "Developed a React application.")));
    const p = await ai.generateResumeEdit(req(doc, "improve"));
    expect(p.suggestions.map((x) => x.riskLevel)).toEqual(["none", "medium"]);
  });
});

describe("structured suggestion", () => {
  it("carries original, suggestion, reason, evidence, newClaims, riskLevel and requiresConfirmation", async () => {
    const doc = docWith(["Worked on a website for students."]);
    stub(() => chat(sug({ text: "Developed a website for students.", sourceEvidence: ["Worked on a website for students."] })));
    const p = await ai.generateResumeEdit(req(doc, "clearer"));
    expect(p.original).toBe("Worked on a website for students.");
    expect(Object.keys(p.suggestions[0]).sort()).toEqual(["evidence", "id", "newClaims", "newFacts", "reason", "requiresConfirmation", "requiresUserConfirmation", "riskLevel", "text"]);
  });

  it("evidence the model 'cites' but that isn't in the resume is dropped", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug({ text: "Developed a React application.", sourceEvidence: ["Led a team of 12 engineers at Google"] })));
    const p = await ai.generateResumeEdit(req(doc, "improve"));
    expect(p.suggestions[0].evidence.join(" ")).not.toMatch(/Google|team of 12/);
  });

  it("an unstated leadership or result claim is medium/low risk and needs confirmation — never silently applied", async () => {
    const doc = docWith(["Built React application."]);
    stub(() => chat(sug("Led development of a React application.", "Built a React application and improved its usability.")));
    const p = await ai.generateResumeEdit(req(doc, "improve"));
    expect(p.suggestions.map((s) => [s.riskLevel, s.requiresConfirmation])).toEqual([["low", true], ["medium", true]]); // safest first
  });

  it("'Make clearer' is a real operation with its own instruction", async () => {
    const doc = docWith(["Worked on stuff for the website."]);
    const calls = stub(() => chat(sug("Maintained pages of the website.")));
    await ai.generateResumeEdit(req(doc, "clearer"));
    expect(calls[0].body.messages[0].content).toMatch(/easy to understand/);
  });

  it("the model never mutates the document, and is sent only the bullet's entry — not the whole resume", async () => {
    const doc = docWith(["Built React application."]);
    doc.sections.push({ id: "prj", kind: "projects", title: "Projects", lines: [], entries: [{ id: "p1", sourceItemId: null, heading: "Secret Side Project", subheading: "Rust", meta: "", origin: "user", bullets: [line("pb", "Wrote a kernel")] }] });
    const before = JSON.stringify(doc);
    const calls = stub(() => chat(sug("Developed a React application.")));
    await ai.generateResumeEdit(req(doc, "improve"));
    expect(JSON.stringify(doc)).toBe(before);
    expect(calls[0].body.messages.map((m) => m.content).join("\n")).not.toMatch(/Secret Side Project|kernel|sample@example.com/);
  });
});

describe("5. job matching: AWS required, no AWS on the resume", () => {
  const JD = "Requirements\n- 2+ years of experience with AWS\n- Build backend services in JavaScript";
  const doc = () => docWith(["Built backend APIs using Node.js.", "Wrote SQL reports."]);

  it("AWS is MISSING, with the 'only if you genuinely have it' message — deterministic, no model needed", async () => {
    const m = await ai.matchResumeToJob({ doc: doc(), jd: JD });
    const aws = m.skills.find((s) => s.name === "AWS")!;
    expect(aws.status).toBe("missing");
    expect(aws.message).toBe("You don't currently list AWS. Only add it if you genuinely have this skill.");
    expect(m.missingRequired).toContain("AWS");
  });

  it("with embeddings and an explanation, AWS is still missing and a model claiming otherwise is filtered out", async () => {
    stub((c) => (c.url.endsWith("/embeddings")
      ? Response.json({ data: c.body.input!.map((t, i) => ({ index: i, embedding: c.body.input_type === "query" ? (/AWS/.test(t) ? [0.7, 0.7] : [0, 1]) : (/cloud/i.test(t) ? [0.7, 0.71] : [0, -1]) })) })
      : chat({
        summary: "You have AWS experience through your cloud work. You are strong on backend services. AWS is missing from your resume.",
        nextSteps: [{ requirement: "AWS", advice: "You already know AWS well. If you have used AWS in a project, describe what you deployed." }, { requirement: "Not A Real Skill", advice: "If you have it, say so." }],
      })));
    const m = await ai.matchResumeToJob({ doc: docWith(["Built cloud applications.", "Built backend APIs using Node.js."]), jd: JD, explain: true });
    expect(m.skills.find((s) => s.name === "AWS")!.status).toBe("missing"); // similarity never changes the verdict
    const text = JSON.stringify(m.explanation);
    expect(text).not.toMatch(/You have AWS experience|You already know AWS/);
    expect(m.explanation!.summary).toMatch(/AWS is missing/);
    expect(m.explanation!.nextSteps.map((s) => s.requirement)).toEqual(["AWS"]); // invented requirement dropped
    expect(m.explanation!.nextSteps[0].advice).toMatch(/^You don't currently list AWS\. Only add it if you genuinely have this skill\./);
  });
});

describe("explanation safety", () => {
  it("advice may be conditional but never names other tools: 'e.g. Jenkins' is dropped, the requirement's own name is fine", async () => {
    stub((c) => (c.url.endsWith("/embeddings")
      ? Response.json({ data: c.body.input!.map((_, i) => ({ index: i, embedding: [0, 1] })) })
      : chat({ summary: "You are strong on Node.js. Kubernetes is missing.", nextSteps: [{ requirement: "Kubernetes", advice: "If you have used Kubernetes, describe the clusters you ran. If you have set up pipelines, mention Jenkins and GitHub Actions." }] })));
    const m = await ai.matchResumeToJob({ doc: docWith(["Built backend APIs using Node.js."]), jd: "Requirements\n- Kubernetes\n- Node.js", explain: true });
    const step = m.explanation!.nextSteps.find((s) => s.requirement === "Kubernetes")!;
    expect(step.advice).toMatch(/If you have used Kubernetes, describe the clusters you ran\./);
    expect(step.advice).not.toMatch(/Jenkins|GitHub Actions/);
    expect(step.advice).toMatch(/^You don't currently list Kubernetes\. Only add it if you genuinely have this skill\./);
  });
});

describe("6. semantic matching", () => {
  const JD = "Requirements\n- Develop RESTful services\n- Experience with AWS";
  // Query vectors and passage vectors live in the same space; unrelated passages point away from every query.
  const embed = (c: Call) => Response.json({ data: c.body.input!.map((t, i) => ({
    index: i,
    embedding: c.body.input_type === "query" ? (/RESTful/.test(t) ? [1, 0] : /AWS/.test(t) ? [0.6, 0.8] : [0, 1]) : (/backend APIs/.test(t) ? [0.95, 0.05] : /cloud applications/.test(t) ? [0.6, 0.81] : [0, -1]),
  })) });

  it("'Built backend APIs.' relates to 'Develop RESTful services' — as related evidence, without inferring REST or any technology", async () => {
    const calls = stub(embed);
    const m = await ai.matchResumeToJob({ doc: docWith(["Built backend APIs.", "Organized tutoring sessions."]), jd: JD });
    const hit = m.semantic.find((s) => /RESTful/.test(s.requirement))!;
    expect(hit).toMatchObject({ kind: "requirement", quote: "Built backend APIs." });
    expect(hit.score).toBeGreaterThan(0.9);
    expect(hit.note).toMatch(/Related, not proof/);
    const rest = m.skills.find((s) => s.name === "REST APIs" || /rest/i.test(s.slug));
    if (rest) expect(rest.status).toBe("missing"); // the keyword isn't on the resume, and similarity doesn't change that
    expect(m.skills.every((s) => s.status !== "matched" || s.evidence.length > 0)).toBe(true);
    expect(calls.every((c) => c.url.endsWith("/embeddings"))).toBe(true); // no LLM call without `explain`
  });

  it("'Built cloud applications.' is never treated as knowing AWS, even when the embedding says they're close", async () => {
    stub(embed);
    const m = await ai.matchResumeToJob({ doc: docWith(["Built cloud applications.", "Organized tutoring sessions."]), jd: JD });
    expect(m.skills.find((s) => s.name === "AWS")!.status).toBe("missing");
    const near = m.semantic.find((s) => s.requirement === "AWS");
    expect(near?.note ?? "").toMatch(/does not show you've used AWS/);
  });

  it("a posting sentence that only names skills already scored is not re-matched by meaning (no redundant 'related' noise)", async () => {
    const calls = stub(embed);
    const m = await ai.matchResumeToJob({ doc: docWith(["Built backend APIs using Node.js.", "Wrote SQL reports."]), jd: "Requirements\n- Develop RESTful services in Node.js\n- Ability to collaborate with product teams" });
    const queried = calls.filter((c) => c.body.input_type === "query").flatMap((c) => c.body.input!);
    expect(queried.join("|")).not.toMatch(/RESTful services in Node\.js/); // names skills the deterministic match already covers
    expect(queried.join("|")).toMatch(/collaborate with product teams/); // names none → matched by meaning
    expect(m.skills.find((s) => s.name === "Node.js")?.status).toBe("unclear"); // used in a bullet, not listed — scored deterministically
  });

  it("dissimilar text is not offered as evidence", async () => {
    stub(embed);
    const m = await ai.matchResumeToJob({ doc: docWith(["Organized tutoring sessions."]), jd: JD });
    expect(m.semantic).toEqual([]);
  });

  it("without embeddings the match still works — deterministic only, nothing fabricated", async () => {
    stub(() => new Response("down", { status: 503 }));
    const m = await ai.matchResumeToJob({ doc: docWith(["Built backend APIs."]), jd: JD });
    expect(m.skills.find((s) => s.name === "AWS")!.status).toBe("missing");
    expect(m.semantic.every((s) => (m.via === "ai" ? typeof s.quote === "string" : false))).toBe(true);
  });
});

describe("accept → undo → restore (nothing is ever lost)", () => {
  it("the original stays recoverable through every step, and the diff shows exactly the change", async () => {
    const original = docWith(["Built React application."]);
    stub(() => chat(sug("Developed a React application.")));
    const p = await ai.generateResumeEdit(req(original, "improve"));
    const accepted = applySuggestion(original, p.target, p.suggestions[0].text, { op: p.op, basis: p.basis, now: "2026-01-01T00:00:00.000Z" });
    expect(original.sections[0].entries[0].bullets[0].text).toBe("Built React application."); // accept never touches the previous state → undo is just "use it"
    const revisions = [
      { created_at: "2026-01-01T00:00:00Z", content: original, label: "Original resume" },
      { created_at: "2026-01-01T00:00:05Z", content: accepted, label: "AI: Improve" },
    ];
    expect(numbered(revisions).map((r) => r.label)).toEqual(["AI: Improve", "Original resume"]);
    const d = diffDocs(revisions[0].content, revisions[1].content);
    expect(d.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["• Built React application."]);
    expect(d.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["• Developed a React application."]);
    // restore = write the old content back as a NEW revision; the AI revision is still there
    const restored = [...revisions, { created_at: "2026-01-01T00:00:10Z", content: revisions[0].content, label: "Restored “Original resume”" }];
    expect(restored[2].content).toEqual(original);
    expect(restored[1].content).toEqual(accepted);
  });

  it("a profile-sourced line rewritten by AI is validated against the confirmed profile fact", async () => {
    const item: CandidateItem = {
      id: "exp1", section: "experience", position: 0, data: { title: "Software Intern", organization: "Campus IT", location: null, start: "2025", end: null, bullets: ["Built React application."] } as never,
      source: "uploaded_resume", source_text: "Built React application.", source_resume_id: "r", status: "explicit", note: null, created_at: "", updated_at: "",
    };
    const doc = docWith([]);
    doc.sections[0].entries[0] = { ...doc.sections[0].entries[0], sourceItemId: "exp1", origin: "profile", bullets: [line("b1", "Built React application.", "exp1")] };
    const good = applySuggestion(doc, { kind: "line", ...ref }, "Developed a React application.", { op: "improve", basis: "Built React application." });
    expect(validateDoc(good, [item]).issues.filter((i) => i.where.includes("Software Intern"))).toEqual([]);
    const bad = applySuggestion(doc, { kind: "line", ...ref }, "Developed a React application with Kubernetes.", { op: "improve", basis: "Built React application." });
    expect(validateDoc(bad, [item]).ok).toBe(false);
  });
});
