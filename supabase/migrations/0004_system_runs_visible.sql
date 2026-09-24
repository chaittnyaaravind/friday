-- Scheduled discovery runs (user_id is null) carry only aggregate counts; let signed-in users
-- see them so the dashboard can show "Last searched …".
drop policy if exists "own runs read" on agent_runs;
create policy "runs read" on agent_runs for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
