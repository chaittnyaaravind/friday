-- Address Supabase security advisors raised on 0001.

-- pg_trgm must not live in the exposed public schema.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- handle_new_user is a trigger function only; it must not be callable over /rest/v1/rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
