-- A queued hunt item is claimed ('preparing') before FRIDAY tailors and announces it, so two runs at once (the 5-minute
-- watch and a webhook) can never both send the same card. A claim left behind by a crashed run is released after 15 min.
alter table public.hunt_items drop constraint if exists hunt_items_state_check;
alter table public.hunt_items add constraint hunt_items_state_check
  check (state in ('queued', 'preparing', 'notified', 'approved', 'sending', 'sent', 'handed_off', 'applied', 'skipped', 'failed', 'stale'));
