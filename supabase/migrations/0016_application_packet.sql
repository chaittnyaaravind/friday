-- Hunt Engine, phase 6: the application packet — assisted submission with explicit approval. FRIDAY never submits.
--
--  1. application_packets: an IMMUTABLE snapshot of everything prepared for one application (resume text, cover letter,
--     answers, documents checklist). A change is a new row; nothing is updated or deleted by the student (no update or
--     delete policy). content_hash is the sha256 of exactly what would be sent.
--  2. packet_approvals: the student's explicit approval of ONE packet's content_hash, with the confirmations they ticked.
--     Insert-only. An approval is valid only while it matches the packet's current hash, which the app re-checks at hand-off.
--  3. application_status gains 'closed': the opportunity stopped being listed while the application was still pre-submission
--     (saved / preparing / ready). The app sets it (and reverses it if the listing reopens) and records every move in
--     application_events, so nothing is changed silently. It is never applied to an application that was already submitted.
-- No existing row is changed.

alter type public.application_status add value if not exists 'closed';

create table if not exists public.application_packets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null,
  job_id uuid references public.jobs (id) on delete set null,
  resume_version_id uuid references public.resume_versions (id) on delete set null,
  packet jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint application_packets_parent_owner_fk foreign key (application_id, user_id) references public.applications (id, user_id) on delete cascade
);
create index if not exists application_packets_app_idx on public.application_packets (application_id, created_at desc);
create index if not exists application_packets_user_idx on public.application_packets (user_id);
create index if not exists application_packets_job_idx on public.application_packets (job_id);
create index if not exists application_packets_resume_idx on public.application_packets (resume_version_id);

create table if not exists public.packet_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  packet_id uuid not null,
  application_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  acknowledged text[] not null default '{}',
  approved_at timestamptz not null default now(),
  constraint packet_approvals_packet_owner_fk foreign key (packet_id, user_id) references public.application_packets (id, user_id) on delete cascade
);
create index if not exists packet_approvals_packet_idx on public.packet_approvals (packet_id, approved_at desc);
create index if not exists packet_approvals_app_idx on public.packet_approvals (application_id);
create index if not exists packet_approvals_user_idx on public.packet_approvals (user_id);

alter table public.application_packets enable row level security;
alter table public.packet_approvals enable row level security;

create policy "own packets read" on public.application_packets for select to authenticated using (user_id = (select auth.uid()));
create policy "own packets insert" on public.application_packets for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own approvals read" on public.packet_approvals for select to authenticated using (user_id = (select auth.uid()));
create policy "own approvals insert" on public.packet_approvals for insert to authenticated with check (user_id = (select auth.uid()));
