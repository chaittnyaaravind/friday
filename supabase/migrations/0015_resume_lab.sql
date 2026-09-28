-- Hunt Engine, phase 5: Resume Lab — a master resume, and a permanent report for every tailored version.
--
--  1. resume_versions.is_master: the student's chosen master. At most one per student, and only a resume built from their
--     profile ('base') can be it. Setting it changes a flag, never a resume's content, and no version is ever deleted.
--  2. tailoring_reports: one row per tailored version, written when the version is created. It is INSERT-ONLY for the
--     student (no update or delete policy): a report is a record of what tailoring did, and it goes away only with its
--     version. Tailoring itself never updates or deletes anything the student owns — it inserts a new version and a report.
--  3. set_master_resume(uuid) / clear_master_resume(): atomic, run as the caller (so RLS applies), rolled back as a unit.
-- No existing row is changed.

alter table public.resume_versions add column if not exists is_master boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'resume_versions_master_is_base') then
    alter table public.resume_versions add constraint resume_versions_master_is_base check (not is_master or kind = 'base');
  end if;
end $$;

create unique index if not exists resume_versions_one_master on public.resume_versions (user_id) where is_master;

create table if not exists public.tailoring_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  version_id uuid not null unique references public.resume_versions (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  master_version_id uuid references public.resume_versions (id) on delete set null,
  job_title text not null,
  company_name text,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists tailoring_reports_user_idx on public.tailoring_reports (user_id, created_at desc);
create index if not exists tailoring_reports_job_idx on public.tailoring_reports (job_id);
create index if not exists tailoring_reports_master_idx on public.tailoring_reports (master_version_id);

alter table public.tailoring_reports enable row level security;
create policy "own reports read" on public.tailoring_reports for select to authenticated using (user_id = (select auth.uid()));
create policy "own reports insert" on public.tailoring_reports for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.resume_versions v where v.id = version_id and v.user_id = (select auth.uid()))
  );

create or replace function public.set_master_resume(p_version uuid) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kind text;
begin
  select kind into v_kind from public.resume_versions where id = p_version and user_id = (select auth.uid());
  if v_kind is null then
    raise exception 'That resume was not found.' using errcode = 'P0002';
  end if;
  if v_kind <> 'base' then
    raise exception 'Only a resume built from your profile can be your master.' using errcode = 'P0001';
  end if;
  update public.resume_versions set is_master = false where user_id = (select auth.uid()) and is_master and id <> p_version;
  update public.resume_versions set is_master = true where id = p_version and user_id = (select auth.uid());
end;
$$;

create or replace function public.clear_master_resume() returns void
language sql
security invoker
set search_path = public
as $$
  update public.resume_versions set is_master = false where user_id = (select auth.uid()) and is_master;
$$;

revoke execute on function public.set_master_resume(uuid) from public, anon;
grant execute on function public.set_master_resume(uuid) to authenticated;
revoke execute on function public.clear_master_resume() from public, anon;
grant execute on function public.clear_master_resume() to authenticated;
