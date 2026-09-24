import { ok, withUser } from "@/lib/api";

/** GET /api/companies — every tracked company with open student roles and whether you follow it. */
export const GET = withUser(async ({ db, user, req }) => {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  let query = db
    .from("companies")
    .select("id, slug, name, domain, hq_city, industry, careers_url, ats, is_sjsu, discoverable, last_crawled_at, jobs(count)")
    .eq("jobs.status", "active")
    .order("name");
  if (q) query = query.ilike("name", `%${q}%`);
  const [{ data, error }, { data: watched }] = await Promise.all([query, db.from("company_watchlists").select("company_id").eq("user_id", user.id)]);
  if (error) throw error;
  const following = new Set((watched ?? []).map((w) => w.company_id));
  return ok({
    companies: (data ?? []).map(({ jobs, ...c }) => ({ ...c, open_roles: (jobs as unknown as { count: number }[])[0]?.count ?? 0, following: following.has(c.id) })),
  });
});
