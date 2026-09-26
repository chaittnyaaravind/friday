-- AI resume editor: append-only revision history for every resume version, and a per-version template.
--
-- resume_revisions is the audit trail. One row per state worth returning to:
--   original    the version as first created (never overwritten)
--   ai          one per accepted AI edit; `trace` records the operation, before/after text, reason
--               and any new facts the user explicitly attested to
--   user        a settled run of the user's own edits
--   checkpoint  a manual save, or the state saved automatically just before a restore
--   restore     the old content written back as a NEW row
-- Rows are never updated or deleted by users (no update/delete policy); they go away only with
-- their version. The uploaded original (resumes.raw_text + storage) is untouched by all of this.

create table resume_revisions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references resume_versions (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  source text not null check (source in ('original', 'ai', 'user', 'restore', 'checkpoint')),
  content jsonb not null,
  trace jsonb,
  created_at timestamptz not null default now()
);
create index resume_revisions_version_idx on resume_revisions (version_id, created_at desc);
create index resume_revisions_user_idx on resume_revisions (user_id);

alter table resume_revisions enable row level security;
create policy "own revisions read" on resume_revisions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own revisions insert" on resume_revisions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from resume_versions v where v.id = version_id and v.user_id = (select auth.uid()))
  );

-- Presentation only: switching template never changes the document's content.
alter table resume_versions add column if not exists template text not null default 'classic'
  check (template in ('classic', 'modern', 'software', 'student', 'minimal'));
