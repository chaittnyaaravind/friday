-- Hunt Engine, phase 1: change tracking, honest freshness and source health. Additive only: no existing row is
-- modified or removed, and code that predates this migration keeps working (every new column is nullable or defaulted).
--
--  1. jobs: content_hash / description_hash (change detection), closed_at, is_baseline
--     is_baseline = the job was already open when FRIDAY first crawled that employer, so "first seen" is not
--     "just opened". discovered_at remains the first-seen time.
--  2. job_sources.source_fields: source-specific raw values kept verbatim (e.g. Workday startDate), never a rule.
--  3. job_events: append-only log of NEW / UPDATED / CLOSED / REOPENED / EXPIRED, with the fields that changed.
--  4. source_health: per source+scope, when it was last tried / last succeeded, what it returned, and whether a
--     close was refused by the close guard.
--  5. source_capabilities: what FRIDAY can honestly claim about each source (mirrored from code by syncCatalog).

alter table public.jobs
  add column if not exists content_hash text,
  add column if not exists description_hash text,
  add column if not exists closed_at timestamptz,
  add column if not exists is_baseline boolean not null default false;

alter table public.job_sources
  add column if not exists source_fields jsonb not null default '{}'::jsonb;

-- ───────────────────────── job_events ─────────────────────────
create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  kind text not null check (kind in ('new', 'updated', 'closed', 'reopened', 'expired')),
  source text,
  run_id uuid references public.agent_runs (id) on delete set null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_job_idx on public.job_events (job_id, created_at desc);
create index if not exists job_events_recent_idx on public.job_events (created_at desc, kind);
create index if not exists job_events_run_idx on public.job_events (run_id);

alter table public.job_events enable row level security;
-- An event is visible exactly when its job is (jobs' own RLS applies inside the subquery, so a student's private
-- imports stay private). Only the service role writes events.
create policy "events follow job visibility" on public.job_events for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));

-- ───────────────────────── source_health ─────────────────────────
create table if not exists public.source_health (
  source text not null,
  scope text not null,
  last_attempt_at timestamptz not null,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  last_returned int,
  last_kept int,
  last_closed int,
  close_blocked_reason text check (close_blocked_reason in ('empty_feed', 'mass_close')),
  updated_at timestamptz not null default now(),
  primary key (source, scope)
);
alter table public.source_health enable row level security;
create policy "health readable" on public.source_health for select to authenticated using (true);

-- ───────────────────────── source_capabilities ─────────────────────────
create table if not exists public.source_capabilities (
  source text primary key,
  access text not null check (access in ('public_api', 'public_page', 'keyed_api', 'user_import')),
  automation text not null check (automation in ('public_feed', 'import_only')),
  posted_at_provided text not null check (posted_at_provided in ('yes', 'no', 'unverified')),
  posted_at_field text,
  posted_at_note text not null default '',
  configured_poll_minutes int check (configured_poll_minutes is null or configured_poll_minutes > 0),
  -- Real-time is a measured property: stays null until a source's latency has been measured end to end.
  realtime_verified_at timestamptz,
  verified_on date,
  notes text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.source_capabilities enable row level security;
create policy "capabilities readable" on public.source_capabilities for select to authenticated using (true);
