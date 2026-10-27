-- Sign-in links over Telegram (src/lib/auth/accounts.ts). The admin generateLink call creates an account for an unknown
-- address, so the server first asks this function whether the address has an account WITH a linked Telegram chat, and
-- only then generates a link. Callable by the service role only; it never returns the email.
alter table public.hunter_links add column if not exists signin_link_sent_at timestamptz;

create or replace function public.signin_link_target(p_email text)
returns table (user_id uuid, telegram_chat_id bigint, signin_link_sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, h.telegram_chat_id, h.signin_link_sent_at
  from auth.users u
  join public.hunter_links h on h.user_id = u.id
  where lower(u.email) = lower(p_email) and h.telegram_chat_id is not null
  limit 1;
$$;

revoke all on function public.signin_link_target(text) from public, anon, authenticated;
grant execute on function public.signin_link_target(text) to service_role;
