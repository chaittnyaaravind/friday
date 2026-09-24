import { HttpError, ok, withUser } from "@/lib/api";
import { parseFilters, searchJobs } from "@/lib/data/jobs";

const UUID = /^[0-9a-f-]{36}$/i;

/** GET /api/companies/:id/jobs — open student roles at one company (id may be the uuid or slug). */
export const GET = withUser<{ id: string }>(async ({ db, req }, { id }) => {
  const { data: company } = await db
    .from("companies")
    .select("id, slug, name, careers_url, discoverable, last_crawled_at")
    .eq(UUID.test(id) ? "id" : "slug", id)
    .maybeSingle();
  if (!company) throw new HttpError(404, "Company not found");
  const f = parseFilters(new URL(req.url).searchParams);
  const { jobs, total } = await searchJobs(db, { ...f, companies: [company.slug], limit: f.limit ?? 100 });
  return ok({ company, jobs, total });
});
