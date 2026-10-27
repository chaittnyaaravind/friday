-- Sign-up admission control (src/app/api/auth/signup). The auth server hashes every new password (bcrypt), so it creates
-- only so many accounts a second; a burst of 1000 sign-ups at once overloads it and every request times out. Instead, at
-- most 8 creates run at a time across all servers: a request leases a free slot (FOR UPDATE SKIP LOCKED, so concurrent
-- servers never take the same one), creates the account and frees it. With no free slot the student is told they are in
-- line and the browser retries a moment later. A lease that is never freed (a crashed function) expires on its own.
create table if not exists public.signup_slots (
  slot int primary key,
  holder uuid,
  until timestamptz not null default 'epoch'
);
insert into public.signup_slots (slot) select g from generate_series(1, 8) g on conflict do nothing;
alter table public.signup_slots enable row level security;

create or replace function public.take_signup_slot(p_hold_seconds int default 30)
returns table (slot int, holder uuid)
language sql volatile security definer set search_path = '' as $$
  update public.signup_slots s
     set holder = gen_random_uuid(), until = now() + make_interval(secs => p_hold_seconds)
   where s.slot = (select f.slot from public.signup_slots f where f.until < now() order by f.slot limit 1 for update skip locked)
  returning s.slot, s.holder;
$$;

create or replace function public.free_signup_slot(p_slot int, p_holder uuid)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.signup_slots set until = now() where slot = p_slot and holder = p_holder;
$$;

revoke all on table public.signup_slots from public, anon, authenticated;
revoke all on function public.take_signup_slot(int) from public, anon, authenticated;
revoke all on function public.free_signup_slot(int, uuid) from public, anon, authenticated;
grant execute on function public.take_signup_slot(int) to service_role;
grant execute on function public.free_signup_slot(int, uuid) to service_role;
