import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: the dashboard reads scheduled discovery runs (user_id is null) to show
// "Last searched …". If RLS only allows a user's own runs, it falls back to
// "FRIDAY has not searched yet" even though discovery ran.
const dir = join(process.cwd(), "supabase/migrations");
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

describe("agent_runs read policy", () => {
  it("drops the own-runs-only select policy", () => {
    expect(sql).toMatch(/drop policy if exists "own runs read" on agent_runs/i);
  });

  it("lets signed-in users read system runs (user_id is null) and their own", () => {
    const m = sql.match(/create policy "runs read" on agent_runs for select to authenticated\s+using \(([^;]+)\);/i);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/user_id is null/i);
    expect(m![1]).toMatch(/user_id = \(select auth\.uid\(\)\)/i);
  });

  it("does not open writes on agent_runs to users", () => {
    expect(sql).not.toMatch(/create policy [^;]*on agent_runs for (insert|update|delete|all)/i);
  });
});
