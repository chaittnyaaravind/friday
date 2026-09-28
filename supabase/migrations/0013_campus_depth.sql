-- Hunt Engine, phase 3: SJSU depth.
--
--  1. 'pinpoint' becomes a source_type and ats_type (the SJSU Student Union's job board; additive).
--  2. jobs gain hours_min / hours_max (weekly hours the posting states; hours_max is the in-session cap when the text
--     gives one), campus_roles (every campus role the title names — multi-label) and campus_employer.
--     They are filled as jobs are discovered; rows found before this migration stay null until their source is next read.
--  3. search_jobs gains two OPTIONAL trailing parameters (default null, so existing callers are unchanged):
--       p_campus_roles      jobs naming ANY of these campus roles
--       p_campus_employers  jobs posted by ANY of these campus employers
--     and returns hours_max, campus_roles and campus_employer. Behavior with neither parameter is identical to 0012.
-- No existing row is changed.

alter type public.source_type add value if not exists 'pinpoint';
alter type public.ats_type add value if not exists 'pinpoint';

alter table public.jobs
  add column if not exists hours_min int check (hours_min is null or hours_min between 1 and 60),
  add column if not exists hours_max int check (hours_max is null or hours_max between 1 and 60),
  add column if not exists campus_roles text[] not null default '{}',
  add column if not exists campus_employer text;

create index if not exists jobs_campus_roles_idx on public.jobs using gin (campus_roles) where is_on_campus;
create index if not exists jobs_campus_employer_idx on public.jobs (campus_employer) where is_on_campus;

drop function if exists public.search_jobs(text, employment_type[], text[], boolean, numeric, boolean, boolean, boolean, text[], text[], source_type[], timestamptz, date, text[], boolean, boolean, text, int, int, text[], timestamptz, boolean, date, int);

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
  p_offset int default 0,
  p_levels text[] default null,
  p_first_seen_after timestamptz default null,
  p_exclude_baseline boolean default false,
  p_deadline_after date default null,
  p_min_score int default null,
  p_campus_roles text[] default null,
  p_campus_employers text[] default null
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
  total_count bigint,
  is_baseline boolean,
  hours_max int,
  campus_roles text[],
  campus_employer text
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
    count(*) over () as total_count,
    j.is_baseline,
    j.hours_max,
    j.campus_roles,
    j.campus_employer
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
    and (p_levels is null or exists (
      select 1 from unnest(p_levels) lv
      where (lv = 'new_grad' and j.title ~* '(new[- ]?grad|university grad|recent grad|early career|graduate program)')
         or (lv = 'entry' and j.title ~* '(entry[- ]level|associate|junior|\yengineer i\y|\yswe i\y)')
    ))
    and (p_first_seen_after is null or (j.discovered_at >= p_first_seen_after and not j.is_baseline))
    and (not p_exclude_baseline or not j.is_baseline)
    and (p_deadline_after is null or (j.deadline is not null and j.deadline >= p_deadline_after))
    and (p_min_score is null or coalesce(m.score, -1) >= p_min_score)
    and (p_campus_roles is null or j.campus_roles && p_campus_roles)
    and (p_campus_employers is null or j.campus_employer = any (p_campus_employers))
  order by
    case when p_sort = 'match' then m.score end desc nulls last,
    case when p_sort = 'distance' then m.distance_miles end asc nulls last,
    case when p_sort = 'deadline' then j.deadline end asc nulls last,
    case when p_sort = 'first_seen' then j.discovered_at end desc nulls last,
    case when p_sort = 'relevance' and q.tsq is not null then ts_rank(j.search, q.tsq) end desc nulls last,
    coalesce(j.posted_at, j.discovered_at) desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke execute on function search_jobs from public, anon;
grant execute on function search_jobs to authenticated;
