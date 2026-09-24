-- Candidate Profile: one row per fact, each with its source and trust status.
-- Only explicit / user_added / user_confirmed facts may enter a generated resume.

create table candidate_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  section text not null check (section in (
    'personal', 'link', 'summary', 'education', 'experience', 'project', 'skill',
    'certification', 'award', 'coursework', 'activity', 'other'
  )),
  position int not null default 0,
  data jsonb not null,
  source text not null check (source in ('uploaded_resume', 'user')),
  source_text text,
  source_resume_id uuid references resumes (id) on delete set null,
  status text not null check (status in ('explicit', 'user_added', 'user_confirmed', 'requires_confirmation')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger candidate_items_updated before update on candidate_items for each row execute function set_updated_at();
create index candidate_items_user_idx on candidate_items (user_id, section, position);
create index candidate_items_resume_idx on candidate_items (source_resume_id);
alter table candidate_items enable row level security;
create policy "own rows" on candidate_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Resume versions are documents built from the profile; they no longer need an upload.
alter table resume_versions alter column resume_id drop not null;
alter table resume_versions add column if not exists kind text not null default 'base' check (kind in ('base', 'tailored', 'copy', 'legacy'));
alter table resume_versions add column if not exists source_version_id uuid references resume_versions (id) on delete set null;
alter table resume_versions add column if not exists updated_at timestamptz not null default now();
create index if not exists resume_versions_source_idx on resume_versions (source_version_id);
create trigger resume_versions_updated before update on resume_versions for each row execute function set_updated_at();
-- Earlier AI-tailored drafts keep their content but are marked legacy (read-only).
update resume_versions set kind = 'legacy' where content ? 'tailored';

alter table resumes add column if not exists parser text not null default 'local';
alter table profiles add column if not exists resume_reviewed_at timestamptz;
