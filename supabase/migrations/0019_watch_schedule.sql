-- Auto Hunter: the 5-minute SJSU watch, scheduled by the database itself (pg_cron + pg_net) instead of an outside cron.
--
--  1. A random bearer token is generated INSIDE Postgres, kept in Supabase Vault (encrypted), and only its sha256 is stored
--     in scheduler_tokens. The app accepts it on /api/agent/watch by comparing hashes, so the token never leaves the
--     database: not in the repo, not in env files, not in logs.
--  2. pg_cron calls GET https://friday-roan.vercel.app/api/agent/watch every 5 minutes through pg_net with that token.
-- Re-running this migration replaces the token and the schedule; nothing else is changed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.scheduler_tokens (
  name text primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
-- Server (service role) only: RLS on, no policies.
alter table public.scheduler_tokens enable row level security;

do $$
declare
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'friday_watch_token';
  if existing is null then
    perform vault.create_secret(token, 'friday_watch_token', 'Bearer token pg_cron uses for /api/agent/watch');
  else
    perform vault.update_secret(existing, token);
  end if;
  insert into public.scheduler_tokens (name, token_hash) values ('watch', encode(extensions.digest(token, 'sha256'), 'hex'))
  on conflict (name) do update set token_hash = excluded.token_hash, created_at = now();
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'friday-watch';
select cron.schedule(
  'friday-watch',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := 'https://friday-roan.vercel.app/api/agent/watch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'friday_watch_token')),
    timeout_milliseconds := 300000
  );
  $job$
);
