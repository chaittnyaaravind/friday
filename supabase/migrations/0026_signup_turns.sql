-- Sign-up turns (src/app/api/auth/signup), replacing 0025's slots. The slots had to be polled: a thousand waiting
-- browsers asking the database "is a slot free?" over and over swamped this project's small connection pool, and the
-- gate became the bottleneck. A turn is reserved once: one row is a clock that advances 1/rate seconds per sign-up, so
-- each request learns the moment its account will be created (a leaky bucket) and simply waits for it. The auth server
-- then sees a steady rate it can sustain (measured ~15 creates/s on this compute; the route asks for 12).
drop function if exists public.take_signup_slot(int);
drop function if exists public.free_signup_slot(int, uuid);
drop table if exists public.signup_slots;

create table if not exists public.signup_clock (
  id boolean primary key default true check (id),
  next_at timestamptz not null default now()
);
insert into public.signup_clock (id) values (true) on conflict do nothing;
alter table public.signup_clock enable row level security;

create or replace function public.reserve_signup_turn(p_per_second numeric default 12)
returns timestamptz
language sql volatile security definer set search_path = '' as $$
  update public.signup_clock
     set next_at = greatest(next_at, clock_timestamp()) + make_interval(secs => 1 / p_per_second)
   where id
  returning next_at - make_interval(secs => 1 / p_per_second);
$$;

revoke all on table public.signup_clock from public, anon, authenticated;
revoke all on function public.reserve_signup_turn(numeric) from public, anon, authenticated;
grant execute on function public.reserve_signup_turn(numeric) to service_role;
