-- Opportunity platform completion. Additive only: no existing row is modified or removed.
--
--  1. USAJOBS as a first-class source; "final round" as an application stage.
--  2. Applications gain a user-written "next action".
--  3. Follow-ups gain a kind and an `auto` flag; a partial unique index makes automatic follow-ups
--     idempotent (one open automatic follow-up of each kind per application, never duplicates).
--  4. Per-user notification preferences and an email opt-out timestamp.
--  5. email_log: every email attempt (sent / failed / skipped), used for duplicate suppression,
--     rate limiting and failure diagnosis. Users may read their own rows; only the service role writes.

alter type public.ats_type add value if not exists 'usajobs';
alter type public.source_type add value if not exists 'usajobs';
alter type public.application_status add value if not exists 'final_round' after 'interview';

alter table public.applications
  add column if not exists next_action text check (next_action is null or char_length(next_action) <= 300);

alter table public.follow_ups
  add column if not exists kind text not null default 'follow_up' check (kind in ('follow_up', 'interview_prep', 'recruiter_response', 'custom')),
  add column if not exists auto boolean not null default false;
create unique index if not exists follow_ups_auto_unique on public.follow_ups (application_id, kind) where auto and done_at is null;

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{"email":{"new_matches":true,"follow_ups":true,"interviews":true,"status_changes":true},"in_app":{"new_matches":true,"follow_ups":true,"interviews":true,"closing_soon":true,"source_updates":false},"min_match_score":70}'::jsonb,
  add column if not exists email_unsubscribed_at timestamptz;

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('new_matches', 'follow_up', 'interview', 'status_change')),
  dedupe_key text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  provider_id text,
  created_at timestamptz not null default now()
);
-- A message is never sent twice for the same reason; failed attempts may be retried.
create unique index if not exists email_log_sent_unique on public.email_log (user_id, dedupe_key) where status = 'sent';
create index if not exists email_log_user_time on public.email_log (user_id, created_at desc);
alter table public.email_log enable row level security;
create policy "own email log" on public.email_log for select to authenticated using (user_id = auth.uid());
