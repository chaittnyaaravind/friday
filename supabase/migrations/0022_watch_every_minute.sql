-- The SJSU watch runs every minute: most ticks are fast (only postings FRIDAY does not hold yet are read), every 10th
-- minute is a full re-read (see /api/agent/watch). Same Vault token and endpoint as 0019; only the schedule changes.
select cron.unschedule(jobid) from cron.job where jobname = 'friday-watch';
select cron.schedule(
  'friday-watch',
  '* * * * *',
  $job$
  select net.http_get(
    url := 'https://friday-roan.vercel.app/api/agent/watch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'friday_watch_token')),
    timeout_milliseconds := 300000
  );
  $job$
);
