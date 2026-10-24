-- Auto Hunter: new campus desk job → prepared application → the student approves in Telegram → sent from the student's own
-- Gmail (or handed off to the official site). FRIDAY still never submits anything the student has not approved.
--
--  1. hunter_links: one row per student. Their Telegram chat (linked by a one-time code they send to the bot) and the
--     Gmail bridge (a Google Apps Script running in THEIR Gmail, authenticated by a token whose sha256 is stored here).
--     Only the server (service role) writes it; the student can read their own row.
--  2. hunt_items: one per student and job. What FRIDAY prepared, what it showed the student in Telegram (the packet hash and
--     the confirmations displayed), and how far it got. The approval itself is still a packet_approvals row (0016).
--  3. outbox: approved email applications waiting for the student's Gmail bridge to send them. Server-written only.
--  4. handshake_mail: Handshake alert emails the bridge already delivered (Gmail message id), so none is read twice.
-- No existing row is changed.

create table if not exists public.hunter_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  telegram_chat_id bigint unique,
  telegram_linked_at timestamptz,
  link_code_hash text check (link_code_hash ~ '^[0-9a-f]{64}$'),
  link_code_expires_at timestamptz,
  bridge_token_hash text unique check (bridge_token_hash ~ '^[0-9a-f]{64}$'),
  bridge_created_at timestamptz,
  bridge_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hunt_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  application_id uuid,
  packet_id uuid,
  content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  confirmations text[] not null default '{}',
  channel text check (channel in ('email', 'site')),
  email_to text,
  email_subject text,
  email_body text,
  research jsonb,
  state text not null default 'queued'
    check (state in ('queued', 'notified', 'approved', 'sending', 'sent', 'handed_off', 'applied', 'skipped', 'failed', 'stale')),
  error text,
  attempts int not null default 0,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, job_id),
  constraint hunt_items_app_owner_fk foreign key (application_id, user_id) references public.applications (id, user_id) on delete set null (application_id)
);
create index if not exists hunt_items_state_idx on public.hunt_items (state, created_at);
create index if not exists hunt_items_job_idx on public.hunt_items (job_id);

create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  hunt_item_id uuid not null references public.hunt_items (id) on delete cascade,
  application_id uuid not null,
  to_email text not null check (to_email ~* '^[^@\s]+@[^@\s]+$'),
  subject text not null,
  body text not null,
  resume_version_id uuid references public.resume_versions (id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'sent', 'failed')),
  claimed_at timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (hunt_item_id)
);
create index if not exists outbox_user_state_idx on public.outbox (user_id, state);
create index if not exists outbox_resume_idx on public.outbox (resume_version_id);

create table if not exists public.handshake_mail (
  user_id uuid not null references public.profiles (id) on delete cascade,
  gmail_id text not null check (length(gmail_id) between 1 and 200),
  received_at timestamptz,
  jobs_found int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, gmail_id)
);

alter table public.hunter_links enable row level security;
alter table public.hunt_items enable row level security;
alter table public.outbox enable row level security;
alter table public.handshake_mail enable row level security;

create policy "own hunter link read" on public.hunter_links for select to authenticated using (user_id = (select auth.uid()));
create policy "own hunt items read" on public.hunt_items for select to authenticated using (user_id = (select auth.uid()));
create policy "own outbox read" on public.outbox for select to authenticated using (user_id = (select auth.uid()));
create policy "own handshake mail read" on public.handshake_mail for select to authenticated using (user_id = (select auth.uid()));
