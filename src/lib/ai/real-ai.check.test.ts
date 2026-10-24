/** One-off live check (REAL_AI=1): the real model, the real test-student profile and real SJSU jobs. Read-only. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.REAL_AI === "1";
if (live) for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

describe.skipIf(!live)("live sources", () => {
  it("reads the live AS ADP career center and a live Library job PDF", { timeout: 300_000 }, async () => {
    const { ADAPTERS } = await import("@/lib/discovery/sources");
    const { REGISTRY } = await import("@/lib/discovery/registry");
    for (const slug of ["sjsu-associated-students", "sjsu-library"]) {
      const r = REGISTRY.find((x) => x.slug === slug)!;
      const out = await ADAPTERS.sjsu_page!({ id: slug, slug, name: r.name, ats: "sjsu_page", config: r.config ?? {} } as never);
      console.log(`\n=== ${slug}: ${out.length}`);
      for (const p of out) console.log(`- ${p.title} | pay=${p.payText} | desc=${p.description.length} chars | ${(p.description.match(/[^\n]*(?:\$|pay|wage|rate|hour)[^\n]*/gi) ?? []).slice(0, 4).join(" || ")}`);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!live)("live AI tailoring on full live postings", () => {
  it("tailors to the live IT Helpdesk and Counter Clerk postings", { timeout: 300_000 }, async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { ADAPTERS } = await import("@/lib/discovery/sources");
    const { REGISTRY } = await import("@/lib/discovery/registry");
    const { loadProfileItems } = await import("@/lib/resume/profile");
    const { tailorProposal, buildTailored } = await import("@/lib/resume/tailor");
    const { applyTerminology } = await import("@/lib/resume/terminology");
    const { aiTailor } = await import("./tailor-ai");
    const { validateDoc } = await import("@/lib/resume/validate");
    const { docToText } = await import("@/lib/resume/generate");
    const items = await loadProfileItems(db, "afa77391-5458-40b7-ac60-6ce45e0a84d6");
    const postings = [];
    for (const slug of ["sjsu-library", "sjsu-associated-students"]) {
      const r = REGISTRY.find((x) => x.slug === slug)!;
      postings.push(...(await ADAPTERS.sjsu_page!({ id: slug, slug, name: r.name, ats: "sjsu_page", config: r.config ?? {} } as never)));
    }
    for (const title of ["IT Helpdesk Student Assistant", "Counter Clerk"]) {
      const post = postings.find((p) => p.title === title)!;
      const job = { id: title, title, company: post.sourceName, description: post.description, requirements: [] as string[] };
      const p = tailorProposal(items, job);
      const { doc } = applyTerminology(buildTailored(items, p, p.options.exclude), [job.title, job.description].join("\n"));
      const { chooseLines } = await import("./tailor-ai");
      console.log("picks: " + JSON.stringify(chooseLines(doc, p.keywords, new Map(items.map((i) => [i.id, i])), 6, [job.title, job.description].join("\n")).map((c) => `${c.op}:${c.keywords.join("+")}:${c.before.slice(0, 40)}`)));
      const r = await aiTailor(doc, { userId: "live-check", keywords: p.keywords, items, job: { title, text: [job.title, job.description].join("\n") } });
      console.log(`\n=== ${title} keywords=${JSON.stringify(p.keywords)}`);
      console.log("screens:", p.screens.map((s) => `${s.covered}:${s.label}`).join(" | "));
      for (const c of r.changes) console.log(`- [${c.where}]\n    before: ${c.before}\n    after:  ${c.after}`);
      if (r.note) console.log("note:", r.note);
      console.log("---- tailored resume ----\n" + docToText(r.doc));
      expect(validateDoc(r.doc, items).ok).toBe(true);
    }
  });
});

describe.skipIf(!live)("live AI tailoring", () => {
  it("tailors the test student's resume to three real SJSU desk jobs", { timeout: 300_000 }, async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { loadProfileItems, loadTailorJob } = await import("@/lib/resume/profile");
    const { tailorProposal, buildTailored } = await import("@/lib/resume/tailor");
    const { applyTerminology } = await import("@/lib/resume/terminology");
    const { aiTailor } = await import("./tailor-ai");
    const { validateDoc } = await import("@/lib/resume/validate");
    const items = await loadProfileItems(db, "afa77391-5458-40b7-ac60-6ce45e0a84d6");
    for (const jobId of ["d631dbf6-3b5d-413e-a285-34b24472817e", "c112be75-62bc-43fb-9916-67c4452b9a13", "ae18fdf0-cea0-4b0f-9150-28d5c1b4460a"]) {
      const job = await loadTailorJob(db, jobId);
      const p = tailorProposal(items, job);
      const { doc } = applyTerminology(buildTailored(items, p, p.options.exclude), [job.title, job.description].join("\n"));
      const t0 = Date.now();
      const r = await aiTailor(doc, { userId: "live-check", keywords: p.keywords, items });
      console.log(`\n=== ${job.title} (${Date.now() - t0} ms) keywords=${JSON.stringify(p.keywords)}`);
      console.log("screens:", p.screens.map((s) => `${s.covered}:${s.label}`).join(" | "));
      for (const c of r.changes) console.log(`- [${c.where}]\n    before: ${c.before}\n    after:  ${c.after}`);
      if (r.note) console.log("note:", r.note);
      const v = validateDoc(r.doc, items);
      console.log("verified:", v.ok, v.issues.slice(0, 3));
      expect(v.ok).toBe(true);
    }
  });
});
