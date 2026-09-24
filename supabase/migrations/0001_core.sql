-- FRIDAY core schema: profiles, discovery (companies/jobs/sources/requirements),
-- matching, resumes, application tracking, alerts and agent runs.
-- Catalog tables (companies, jobs, ...) are world-readable to signed-in users and
-- written only by the service role (discovery agent). Everything else is owned
-- by exactly one user and isolated by RLS on auth.uid().

create extension if not exists pg_trgm;

-- ───────────────────────── enums ─────────────────────────
create type work_authorization as enum ('f1', 'us_citizen', 'permanent_resident', 'other');
create type workplace_pref as enum ('onsite', 'hybrid', 'remote', 'any');
create type employment_type as enum ('internship', 'on_campus', 'part_time', 'full_time', 'research', 'co_op');
create type job_status as enum ('active', 'closed', 'expired', 'broken');
create type work_study as enum ('required', 'eligible', 'not_required', 'unknown');
create type source_type as enum (
  'greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'amazon', 'microsoft',
  'sjsu_page', 'handshake_import', 'linkedin_import', 'indeed_import', 'manual'
);
create type ats_type as enum ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'amazon', 'microsoft', 'sjsu_page', 'careers_page');
create type application_status as enum (
  'saved', 'preparing', 'ready', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'
);
create type requirement_kind as enum ('required', 'preferred');
create type difficulty as enum ('low', 'medium', 'high');

-- ───────────────────────── helpers ─────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── profiles ─────────────────────────
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  university text not null default 'San José State University',
  major text,
  graduation_year int check (graduation_year between 2000 and 2100),
  gpa numeric(3, 2) check (gpa between 0 and 4.5),
  experience_summary text,
  work_authorization work_authorization,
  -- Search origin. Defaults to SJSU campus; never sent to job providers.
  origin_label text not null default 'SJSU Campus',
  origin_lat double precision not null default 37.3352,
  origin_lng double precision not null default -121.8811,
  radius_miles int not null default 25 check (radius_miles between 1 and 500),
  workplace workplace_pref not null default 'any',
  availability text,
  desired_titles text[] not null default '{}',
  preferred_industries text[] not null default '{}',
  preferred_locations text[] not null default '{}',
  github_url text,
  linkedin_url text,
  portfolio_url text,
  onboarded_at timestamptz,
  digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

-- Auto-create an empty profile for every new auth user.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ───────────────────────── skills ─────────────────────────
create table skills (
  id serial primary key,
  slug text not null unique,
  name text not null,
  category text not null,
  aliases text[] not null default '{}'
);

create table profile_skills (
  user_id uuid not null references profiles (id) on delete cascade,
  skill_id int not null references skills (id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'resume')),
  created_at timestamptz not null default now(),
  primary key (user_id, skill_id)
);
create index profile_skills_skill_idx on profile_skills (skill_id);

-- ───────────────────────── companies ─────────────────────────
create table companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  domain text,
  hq_city text,
  industry text,
  careers_url text,
  ats ats_type,
  ats_config jsonb not null default '{}',
  is_sjsu boolean not null default false,
  discoverable boolean not null default true, -- false = watch/link only (no public feed)
  last_crawled_at timestamptz,
  created_at timestamptz not null default now()
);
create index companies_name_trgm on companies using gin (name gin_trgm_ops);

-- ───────────────────────── jobs ─────────────────────────
create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  -- normalized company+title+city; the dedupe key across sources
  canonical_key text not null unique,
  title text not null,
  department text,
  description text,
  employment_type employment_type not null,
  category text,
  is_on_campus boolean not null default false,
  location_text text,
  city text,
  lat double precision,
  lng double precision,
  is_remote boolean not null default false,
  is_hybrid boolean not null default false,
  pay_text text,
  pay_min numeric,
  pay_max numeric,
  hours_text text,
  work_study work_study not null default 'unknown',
  eligibility_text text,
  deadline date,
  posted_at timestamptz,
  discovered_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  status job_status not null default 'active',
  apply_url text not null,
  apply_url_is_official boolean not null default true,
  requirements_extracted_at timestamptz,
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(department, '') || ' ' || coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(left(description, 20000), '')), 'C')
  ) stored
);
create index jobs_search_idx on jobs using gin (search);
create index jobs_company_idx on jobs (company_id);
create index jobs_feed_idx on jobs (status, employment_type, discovered_at desc);
create index jobs_on_campus_idx on jobs (is_on_campus, status, discovered_at desc);
create index jobs_geo_idx on jobs (lat, lng) where lat is not null;
create index jobs_title_trgm on jobs using gin (title gin_trgm_ops);

create table job_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  source source_type not null,
  source_name text not null,
  external_id text not null,
  url text not null,
  is_official boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source, external_id)
);
create index job_sources_job_idx on job_sources (job_id);

create table job_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  skill_id int references skills (id) on delete set null,
  label text not null,
  kind requirement_kind not null default 'required',
  unique (job_id, label)
);
create index job_requirements_job_idx on job_requirements (job_id);
create index job_requirements_skill_idx on job_requirements (skill_id);

-- ───────────────────────── matching ─────────────────────────
create table job_matches (
  user_id uuid not null references profiles (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  score int not null check (score between 0 and 100),
  strong jsonb not null default '[]',
  missing jsonb not null default '[]',
  difficulty difficulty not null,
  distance_miles numeric,
  computed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
create index job_matches_rank_idx on job_matches (user_id, score desc);
create index job_matches_job_idx on job_matches (job_id);

create table saved_jobs (
  user_id uuid not null references profiles (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
create index saved_jobs_job_idx on saved_jobs (job_id);

-- ───────────────────────── resumes ─────────────────────────
create table resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  file_path text not null, -- storage: resumes/<user_id>/<uuid>.<ext>
  file_name text not null,
  mime_type text not null,
  raw_text text not null,
  parsed jsonb,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index resumes_user_idx on resumes (user_id, created_at desc);
create unique index resumes_one_primary on resumes (user_id) where is_primary;

create table resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  resume_id uuid not null references resumes (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  label text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index resume_versions_user_idx on resume_versions (user_id, created_at desc);
create index resume_versions_resume_idx on resume_versions (resume_id);
create index resume_versions_job_idx on resume_versions (job_id);

-- ───────────────────────── applications ─────────────────────────
create table applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  company_name text not null,
  job_title text not null,
  location text,
  source text,
  original_url text,
  application_url text,
  status application_status not null default 'saved',
  position int not null default 0,
  discovered_at timestamptz,
  applied_at timestamptz,
  resume_version_id uuid references resume_versions (id) on delete set null,
  cover_letter text,
  contact_name text,
  contact_email text,
  interview_at timestamptz,
  follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);
create trigger applications_updated before update on applications for each row execute function set_updated_at();
create index applications_board_idx on applications (user_id, status, position);
create index applications_job_idx on applications (job_id);
create index applications_resume_version_idx on applications (resume_version_id);

create table application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  from_status application_status,
  to_status application_status,
  note text,
  created_at timestamptz not null default now()
);
create index application_events_app_idx on application_events (application_id, created_at desc);
create index application_events_user_idx on application_events (user_id);

create table application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('resume', 'cover_letter', 'other')),
  title text not null,
  content text,
  file_path text,
  created_at timestamptz not null default now()
);
create index application_documents_app_idx on application_documents (application_id);
create index application_documents_user_idx on application_documents (user_id);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  scheduled_at timestamptz not null,
  kind text not null default 'interview',
  location text,
  notes text,
  created_at timestamptz not null default now()
);
create index interviews_user_idx on interviews (user_id, scheduled_at);
create index interviews_app_idx on interviews (application_id);

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  due_at timestamptz not null,
  note text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index follow_ups_user_idx on follow_ups (user_id, due_at) where done_at is null;
create index follow_ups_app_idx on follow_ups (application_id);

-- ───────────────────────── alerts & watchlists ─────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  job_id uuid references jobs (id) on delete cascade,
  application_id uuid references applications (id) on delete cascade,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_job_idx on notifications (job_id);
create index notifications_app_idx on notifications (application_id);

create table company_watchlists (
  user_id uuid not null references profiles (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
create index company_watchlists_company_idx on company_watchlists (company_id);

create table search_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  query jsonb not null,
  alerts_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index search_preferences_user_idx on search_preferences (user_id);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references profiles (id) on delete set null,
  trigger text not null default 'manual',
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  stats jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_runs_started_idx on agent_runs (started_at desc);
create index agent_runs_user_idx on agent_runs (user_id);

-- ───────────────────────── row level security ─────────────────────────
alter table profiles enable row level security;
alter table skills enable row level security;
alter table profile_skills enable row level security;
alter table companies enable row level security;
alter table jobs enable row level security;
alter table job_sources enable row level security;
alter table job_requirements enable row level security;
alter table job_matches enable row level security;
alter table saved_jobs enable row level security;
alter table resumes enable row level security;
alter table resume_versions enable row level security;
alter table applications enable row level security;
alter table application_events enable row level security;
alter table application_documents enable row level security;
alter table interviews enable row level security;
alter table follow_ups enable row level security;
alter table notifications enable row level security;
alter table company_watchlists enable row level security;
alter table search_preferences enable row level security;
alter table agent_runs enable row level security;

-- Catalog: readable by signed-in users, written only by service role (bypasses RLS).
create policy "catalog read" on skills for select to authenticated using (true);
create policy "catalog read" on companies for select to authenticated using (true);
create policy "catalog read" on jobs for select to authenticated using (true);
create policy "catalog read" on job_sources for select to authenticated using (true);
create policy "catalog read" on job_requirements for select to authenticated using (true);

create policy "own profile" on profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Per-user tables share one policy shape.
do $$
declare t text;
begin
  foreach t in array array[
    'profile_skills', 'job_matches', 'saved_jobs', 'resumes', 'resume_versions', 'applications',
    'application_events', 'application_documents', 'interviews', 'follow_ups', 'notifications',
    'company_watchlists', 'search_preferences'
  ] loop
    execute format(
      'create policy "own rows" on %I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

create policy "own runs read" on agent_runs for select to authenticated using (user_id = (select auth.uid()));

-- ───────────────────────── storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 5242880,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
on conflict (id) do nothing;

create policy "own resume files" on storage.objects for all to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);
