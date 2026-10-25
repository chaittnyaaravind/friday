-- A run whose adapter left postings out (their details could not be read) closes nothing: record why.
alter table public.source_health drop constraint if exists source_health_close_blocked_reason_check;
alter table public.source_health add constraint source_health_close_blocked_reason_check
  check (close_blocked_reason in ('empty_feed', 'mass_close', 'incomplete_feed'));
