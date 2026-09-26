-- A child row must belong to the same user as its private parent.
-- Owner-only RLS on the child alone does not establish this relationship.
-- This migration intentionally fails if historical mismatches exist, instead of deleting data.
begin;
create unique index if not exists applications_id_owner_unique on public.applications(id,user_id);
create unique index if not exists resumes_id_owner_unique on public.resumes(id,user_id);
create unique index if not exists resume_versions_id_owner_unique on public.resume_versions(id,user_id);
alter table public.application_events add constraint application_events_parent_owner_fk foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.application_documents add constraint application_documents_parent_owner_fk foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.interviews add constraint interviews_parent_owner_fk foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.follow_ups add constraint follow_ups_parent_owner_fk foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.notifications add constraint notifications_parent_owner_fk foreign key(application_id,user_id) references public.applications(id,user_id) on delete cascade;
alter table public.resume_versions add constraint resume_versions_parent_owner_fk foreign key(resume_id,user_id) references public.resumes(id,user_id) on delete cascade;
alter table public.applications add constraint applications_resume_owner_fk foreign key(resume_version_id,user_id) references public.resume_versions(id,user_id);
-- resume_revisions is optional until migration 0006 has been deployed.
do $$ begin
 if to_regclass('public.resume_revisions') is not null then
  alter table public.resume_revisions add constraint resume_revisions_parent_owner_fk foreign key(version_id,user_id) references public.resume_versions(id,user_id) on delete cascade;
 end if;
end $$;
commit;
