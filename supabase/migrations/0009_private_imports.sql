-- User imports (a pasted or bookmarked listing) are private to the student who made them.
--
-- The catalog tables were readable by every signed-in user, and importing wrote into them. That let one student
-- plant a listing — with an arbitrary title, description and apply link — that every other student would see as a
-- normal job, or attach a look-alike "official" source to a real one. Now an import carries `imported_by`, and RLS
-- shows those rows only to their owner. Feed-discovered rows (imported_by is null) stay public, unchanged.
-- Additive: no existing row changes (there are no user imports yet).

alter table public.jobs add column if not exists imported_by uuid references public.profiles (id) on delete cascade;
alter table public.job_sources add column if not exists imported_by uuid references public.profiles (id) on delete cascade;
alter table public.companies add column if not exists imported_by uuid references public.profiles (id) on delete cascade;
create index if not exists jobs_imported_by_idx on public.jobs (imported_by) where imported_by is not null;
create index if not exists job_sources_imported_by_idx on public.job_sources (imported_by) where imported_by is not null;
create index if not exists companies_imported_by_idx on public.companies (imported_by) where imported_by is not null;

drop policy if exists "catalog read" on public.jobs;
create policy "catalog read" on public.jobs for select to authenticated using (imported_by is null or imported_by = (select auth.uid()));

drop policy if exists "catalog read" on public.job_sources;
create policy "catalog read" on public.job_sources for select to authenticated using (imported_by is null or imported_by = (select auth.uid()));

drop policy if exists "catalog read" on public.companies;
create policy "catalog read" on public.companies for select to authenticated using (imported_by is null or imported_by = (select auth.uid()));

-- Requirements follow their job: visible exactly when the job is (RLS on jobs applies inside the subquery).
drop policy if exists "catalog read" on public.job_requirements;
create policy "catalog read" on public.job_requirements for select to authenticated using (exists (select 1 from public.jobs j where j.id = job_id));
