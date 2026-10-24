-- SJSU campus hunter: exclusion rules, stated hourly pay, physical demand, campus fit, submission evidence.
--
--  1. jobs gains excluded_reason ("dining: <why>", set at ingestion by src/lib/domain/exclusions.ts), pay_hourly_min /
--     pay_hourly_max (ONLY when the posting states an hourly rate), physical_demand and physical_flags (read from the
--     duties). All nullable/defaulted: no existing row changes until its source is read again.
--  2. job_matches gains campus_fit (0-100) and campus_fit_breakdown: a separate ranking for on-campus jobs, stored
--     beside the match score and the eligibility verdict, never folded into either.
--  3. profiles gains campus_prefs (pay floor, hours cap, preferred role types, avoid physical / hard schedules).
--  4. applications gains submission_evidence + submission_confirmed_at. FRIDAY never submits; "applied" without evidence
--     is shown as "Submitted (unverified)".
--  5. search_jobs NEVER returns an excluded job, gains p_min_hourly and p_physical filters and the 'pay' and 'fit' sorts,
--     and returns pay_hourly_min, pay_hourly_max, physical_demand and campus_fit. Every new parameter is optional, so
--     existing callers are unchanged apart from excluded rows disappearing. p_desk_only keeps only desk-type campus jobs.

alter table public.jobs
  add column if not exists excluded_reason text check (excluded_reason is null or char_length(excluded_reason) <= 300),
  add column if not exists pay_hourly_min numeric check (pay_hourly_min is null or pay_hourly_min > 0),
  add column if not exists pay_hourly_max numeric check (pay_hourly_max is null or pay_hourly_max > 0),
  add column if not exists physical_demand text check (physical_demand is null or physical_demand in ('low', 'moderate', 'high', 'unknown')),
  add column if not exists physical_flags jsonb not null default '[]'::jsonb;

create index if not exists jobs_excluded_idx on public.jobs (is_on_campus, status) where excluded_reason is not null;

alter table public.job_matches
  add column if not exists campus_fit int check (campus_fit is null or campus_fit between 0 and 100),
  add column if not exists campus_fit_breakdown jsonb;

alter table public.profiles
  add column if not exists campus_prefs jsonb not null default '{}'::jsonb;

alter table public.applications
  add column if not exists submission_evidence text check (submission_evidence is null or char_length(submission_evidence) <= 2000),
  add column if not exists submission_confirmed_at timestamptz;

drop function if exists public.search_jobs(text, employment_type[], text[], boolean, numeric, boolean, boolean, boolean, text[], text[], source_type[], timestamptz, date, text[], boolean, boolean, text, int, int, text[], timestamptz, boolean, date, int, text[], text[], boolean);

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
  p_campus_employers text[] default null,
  p_hide_blocked boolean default false,
  p_min_hourly numeric default null,
  p_physical text[] default null,
  p_desk_only boolean default false
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
  campus_employer text,
  eligibility text,
  pay_hourly_min numeric,
  pay_hourly_max numeric,
  physical_demand text,
  campus_fit int
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
    j.campus_employer,
    m.eligibility,
    j.pay_hourly_min,
    j.pay_hourly_max,
    j.physical_demand,
    m.campus_fit
  from jobs j
  join companies c on c.id = j.company_id
  left join job_matches m on m.job_id = j.id and m.user_id = (select auth.uid())
  left join saved_jobs s on s.job_id = j.id and s.user_id = (select auth.uid())
  cross join q
  where j.status = 'active'
    -- Excluded work (exclusions.ts: dining and food service) is never returned, whatever the filters.
    and j.excluded_reason is null
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
    and (not p_hide_blocked or m.eligibility is distinct from 'blocked')
    -- A pay floor keeps only jobs whose STATED hourly pay reaches it: unknown pay never passes as known.
    and (p_min_hourly is null or coalesce(j.pay_hourly_max, j.pay_hourly_min) >= p_min_hourly)
    and (p_physical is null or coalesce(j.physical_demand, 'unknown') = any (p_physical))
    -- Desk jobs only (src/lib/domain/campus-fit.ts isDeskJob): a desk/office/IT/library role, or duties stated as desk work;
    -- never physically demanding. Keep these two definitions identical.
    and (not p_desk_only or (
      (j.campus_roles && array['front_desk_admin', 'it_support', 'library_assistant'] or j.physical_demand = 'low')
      and coalesce(j.physical_demand, 'unknown') <> 'high'
    ))
  order by
    case when p_sort = 'match' then m.score end desc nulls last,
    case when p_sort = 'fit' then m.campus_fit end desc nulls last,
    -- Unknown pay sorts LAST, never as zero or as a guess.
    case when p_sort = 'pay' then coalesce(j.pay_hourly_max, j.pay_hourly_min) end desc nulls last,
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
