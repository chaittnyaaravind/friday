/**
 * Live audit (REAL_AI=1, AUDIT_USER, AUDIT_OUT): the production tailoring path — proposal, spelling, AI rewrite, truth check
 * with fallback — run in memory for one student against every open SJSU job, then scored: ATS, PDF parse test, writing
 * lint (AI tells, clichés, duty phrasing) and screens. Read-only: nothing is written to the database.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const live = process.env.REAL_AI === "1" && Boolean(process.env.AUDIT_USER && process.env.AUDIT_OUT);
if (live) for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

describe.skipIf(!live)("final tailoring audit", () => {
  it("tailors and scores every open SJSU job", { timeout: 1_800_000 }, async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const { loadProfileItems, loadTailorJob } = await import("@/lib/resume/profile");
    const { tailorProposal, buildTailored } = await import("@/lib/resume/tailor");
    const { applyTerminology } = await import("@/lib/resume/terminology");
    const { aiTailor } = await import("@/lib/ai/tailor-ai");
    const { validateDoc } = await import("@/lib/resume/validate");
    const { docToText } = await import("@/lib/resume/generate");
    const { analyzeAts } = await import("@/lib/resume/ats");
    const { matchJob } = await import("@/lib/resume/jobmatch");
    const { parseTest } = await import("@/lib/resume/parse-test");
    const { lintWriting } = await import("@/lib/writing/style");
    const { renderPdf } = await import("@/lib/resume/export");
    const userId = process.env.AUDIT_USER!;
    const out = process.env.AUDIT_OUT!;
    mkdirSync(out, { recursive: true });

    const items = await loadProfileItems(db, userId);
    const { data: jobs } = await db.from("jobs").select("id, title").eq("status", "active").eq("is_on_campus", true).is("excluded_reason", null).is("imported_by", null).order("title");
    const only = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY, "i") : null;
    const rows = [];
    for (const { id } of (jobs ?? []).filter((j) => !only || only.test(j.title as string))) {
      const job = await loadTailorJob(db, id as string);
      const jobText = [job.title, job.description, job.requirements.join("\n")].filter(Boolean).join("\n");
      const proposal = tailorProposal(items, job);
      const { doc: spelled } = applyTerminology(buildTailored(items, proposal, proposal.options.exclude), jobText);
      let { doc, changes } = await aiTailor(spelled, { userId, keywords: proposal.keywords, items, job: { title: job.title, text: jobText } });
      let check = validateDoc(doc, items);
      const fellBack = changes.length > 0 && !check.ok;
      if (fellBack) {
        ({ doc, changes } = { doc: spelled, changes: [] });
        check = validateDoc(doc, items);
      }
      const ats = analyzeAts(doc, { match: matchJob(doc, jobText) });
      const parse = await parseTest(doc);
      const lint: string[] = [];
      for (const s of doc.sections) {
        const kind = s.kind === "summary" ? "summary" : s.kind === "skills" ? "skills" : "bullet";
        for (const l of [...s.lines, ...s.entries.flatMap((e) => e.bullets)]) {
          for (const i of lintWriting(l.text, kind)) lint.push(`${i.code}: ${l.text.slice(0, 70)} — ${i.message}`);
        }
      }
      const row = {
        title: job.title, company: job.company, descChars: (job.description ?? "").length,
        verified: check.ok, fellBack, ats: ats.score, components: ats.components.map((c) => `${c.label} ${c.score}`),
        parseOk: parse.ok, pages: parse.pages, parseProblems: parse.checks.filter((c) => !c.ok).map((c) => c.label),
        screens: proposal.screens.map((s) => `${s.covered === "yes" ? "✓" : s.covered === "no" ? "✗" : "?"} ${s.label}`), keywords: proposal.keywords,
        missing: ats.components.find((c) => c.id === "keywords")?.details ?? [],
        rewrites: changes.map((c) => ({ before: c.before, after: c.after })), lint,
      };
      rows.push(row);
      const slug = job.title.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60);
      writeFileSync(join(out, `${slug}.pdf`), await renderPdf(doc));
      writeFileSync(join(out, `${slug}.txt`), `${JSON.stringify({ ...row, rewrites: undefined }, null, 1)}\n\nREWRITES\n${changes.map((c) => `- ${c.before}\n  → ${c.after}`).join("\n")}\n\n${docToText(doc)}\n`);
      console.log(`${row.ats} ats | parse ${row.parseOk} p${row.pages} | verified ${row.verified}${fellBack ? " (fallback)" : ""} | lint ${lint.length} | ${job.title}`);
    }
    writeFileSync(join(out, "audit.json"), JSON.stringify(rows, null, 1));
    expect(rows.every((r) => r.verified)).toBe(true);
  });
});
