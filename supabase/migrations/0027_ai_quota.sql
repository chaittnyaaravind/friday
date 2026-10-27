-- Daily AI quotas (src/lib/ai/quota.ts). Sign-up is instant now (0023–0026), so anyone can open accounts; every AI call
-- costs money. Each student gets a daily allowance per kind of AI call, and every kind has a site-wide daily ceiling that
-- caps the bill whatever happens. take_ai_quota checks and records in one locked step (no race between two requests of
-- the same student), and only the server may call it: students can neither read nor reset their own counts.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,30}$'),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_kind_time on public.ai_usage (user_id, kind, created_at desc);
create index if not exists ai_usage_kind_time on public.ai_usage (kind, created_at desc);
alter table public.ai_usage enable row level security;

create or replace function public.take_ai_quota(p_user uuid, p_kind text, p_user_limit int, p_global_limit int)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  mine int;
  everyone int;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_quota|' || p_user::text || '|' || p_kind, 0));
  delete from public.ai_usage where user_id = p_user and kind = p_kind and created_at < now() - interval '2 days';
  select count(*) into mine from public.ai_usage where user_id = p_user and kind = p_kind and created_at > now() - interval '1 day';
  if mine >= p_user_limit then return false; end if;
  select count(*) into everyone from public.ai_usage where kind = p_kind and created_at > now() - interval '1 day';
  if everyone >= p_global_limit then return false; end if;
  insert into public.ai_usage (user_id, kind) values (p_user, p_kind);
  return true;
end;
$$;

revoke all on table public.ai_usage from public, anon, authenticated;
revoke all on function public.take_ai_quota(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.take_ai_quota(uuid, text, int, int) to service_role;
