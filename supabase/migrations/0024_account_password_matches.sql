-- Sign-up under load (src/lib/auth/accounts.ts createAccount): a create that timed out may still have succeeded, so its
-- retry sees "already registered". The server asks this function whether the password just chosen opens that account —
-- in Postgres (bcrypt via pgcrypto), so no per-IP sign-in rate limit can make it answer wrong. Service role only.
create or replace function public.account_password_matches(p_email text, p_password text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(p_email)
      and u.encrypted_password is not null
      and u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
  );
$$;

revoke all on function public.account_password_matches(text, text) from public, anon, authenticated;
grant execute on function public.account_password_matches(text, text) to service_role;
