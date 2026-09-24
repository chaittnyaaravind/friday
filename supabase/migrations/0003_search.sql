-- Search: one ranked, filtered query shared by the feed, search page and /api/jobs/*.
-- security invoker → RLS still applies (job_matches/saved_jobs are the caller's rows).

alter table jobs add column if not exists auth_restricted boolean not null default false;
create index if not exists jobs_auth_restricted_idx on jobs (auth_restricted) where auth_restricted;

create or replace function search_jobs(
  p_q text default null,
  p_types employment_type[] default null,
  p_categories text[] default null,
  p_on_campus boolean default null,
  p_max_miles numeric default null,
  p_include_remote boolean default true,
  p_remote_only boolean default false,
  p_hybrid_only boolean default false,
  p_company_slugs text[] default null,
  p_industries text[] default null,
  p_sources source_type[] default null,
  p_posted_after timestamptz default null,
  p_deadline_before date default null,
  p_skills text[] default null,
  p_hide_auth_restricted boolean default false,
  p_saved_only boolean default false,
  p_sort text default 'match',
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  department text,
  employment_type employment_type,
  category text,
  is_on_campus boolean,
  location_text text,
  city text,
  is_remote boolean,
  is_hybrid boolean,
  pay_text text,
  hours_text text,
  work_study work_study,
  deadline date,
  posted_at timestamptz,
  discovered_at timestamptz,
  last_verified_at timestamptz,
  apply_url text,
  auth_restricted boolean,
  company_slug text,
  company_name text,
  company_domain text,
  company_industry text,
  score int,
  strong jsonb,
  missing jsonb,
  difficulty difficulty,
  distance_miles numeric,
  saved boolean,
  sources jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select case when nullif(trim(p_q), '') is null then null else websearch_to_tsquery('english', p_q) end as tsq
  )
  select
    j.id, j.title, j.department, j.employment_type, j.category, j.is_on_campus, j.location_text, j.city,
    j.is_remote, j.is_hybrid, j.pay_text, j.hours_text, j.work_study, j.deadline, j.posted_at,
    j.discovered_at, j.last_verified_at, j.apply_url, j.auth_restricted,
    c.slug, c.name, c.domain, c.industry,
    m.score, m.strong, m.missing, m.difficulty, m.distance_miles,
    (s.job_id is not null) as saved,
    coalesce((
      select jsonb_agg(jsonb_build_object('source', js.source, 'name', js.source_name, 'url', js.url, 'official', js.is_official) order by js.is_official desc, js.first_seen_at)
      from job_sources js where js.job_id = j.id
    ), '[]'::jsonb) as sources,
    count(*) over () as total_count
  from jobs j
  join companies c on c.id = j.company_id
  left join job_matches m on m.job_id = j.id and m.user_id = (select auth.uid())
  left join saved_jobs s on s.job_id = j.id and s.user_id = (select auth.uid())
  cross join q
  where j.status = 'active'
    and (q.tsq is null or j.search @@ q.tsq or c.name ilike '%' || p_q || '%')
    and (p_types is null or j.employment_type = any (p_types))
    and (p_categories is null or j.category = any (p_categories))
    and (p_on_campus is null or j.is_on_campus = p_on_campus)
    and (p_max_miles is null or m.distance_miles <= p_max_miles or (p_include_remote and j.is_remote))
    and (not p_remote_only or j.is_remote)
    and (not p_hybrid_only or j.is_hybrid)
    and (p_company_slugs is null or c.slug = any (p_company_slugs))
    and (p_industries is null or c.industry = any (p_industries))
    and (p_sources is null or exists (select 1 from job_sources js where js.job_id = j.id and js.source = any (p_sources)))
    and (p_posted_after is null or coalesce(j.posted_at, j.discovered_at) >= p_posted_after)
    and (p_deadline_before is null or (j.deadline is not null and j.deadline <= p_deadline_before))
    and (p_skills is null or exists (
      select 1 from job_requirements r join skills k on k.id = r.skill_id
      where r.job_id = j.id and k.slug = any (p_skills)
    ))
    and (not p_hide_auth_restricted or not j.auth_restricted)
    and (not p_saved_only or s.job_id is not null)
  order by
    case when p_sort = 'match' then m.score end desc nulls last,
    case when p_sort = 'distance' then m.distance_miles end asc nulls last,
    case when p_sort = 'deadline' then j.deadline end asc nulls last,
    case when p_sort = 'relevance' and q.tsq is not null then ts_rank(j.search, q.tsq) end desc nulls last,
    coalesce(j.posted_at, j.discovered_at) desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke execute on function search_jobs from public, anon;
grant execute on function search_jobs to authenticated;
