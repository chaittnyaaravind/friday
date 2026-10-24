-- Behaviour checks for migration 0017 against a real Postgres (see test/sql/README.md). Raises on the first failure.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'student@example.edu');
insert into companies (id, slug, name, is_sjsu, discoverable) values ('00000000-0000-0000-0000-0000000000c1', 'sjsu-test', 'SJSU Test', true, true);
insert into jobs (id, company_id, canonical_key, title, employment_type, is_on_campus, apply_url, pay_hourly_min, pay_hourly_max, physical_demand, excluded_reason, discovered_at) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'k1', 'Front Desk Assistant', 'on_campus', true, 'https://example.edu/1', 18, 20, 'low', null, now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'k2', 'Library Assistant', 'on_campus', true, 'https://example.edu/2', null, null, 'unknown', null, now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1', 'k3', 'Dining Commons Cook', 'on_campus', true, 'https://example.edu/3', 25, 25, 'high', 'dining: The title names dining and food service work (“cook”).', now()),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1', 'k4', 'IT Help Desk Assistant', 'on_campus', true, 'https://example.edu/4', 22, 22, 'low', null, now() - interval '2 days');
insert into job_matches (user_id, job_id, score, difficulty, campus_fit) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 40, 'low', 90),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000004', 60, 'low', 70);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

do $$
declare titles text[];
begin
  -- 1. Excluded jobs never appear, even though the dining job has the highest pay and is the newest.
  select array_agg(title order by title) into titles from search_jobs(p_on_campus => true);
  if titles <> array['Front Desk Assistant', 'IT Help Desk Assistant', 'Library Assistant'] then raise exception 'exclusion failed: %', titles; end if;
  select array_agg(title order by title) into titles from search_jobs(p_q => 'cook');
  if titles is not null then raise exception 'excluded job found by search: %', titles; end if;

  -- 2. Pay sort: highest stated hourly first; unknown pay LAST (not as zero, not as a guess).
  select array_agg(title) into titles from search_jobs(p_on_campus => true, p_sort => 'pay');
  if titles <> array['IT Help Desk Assistant', 'Front Desk Assistant', 'Library Assistant'] then raise exception 'pay sort wrong: %', titles; end if;

  -- 3. A pay floor keeps only STATED pay at or above it; unknown pay does not pass.
  select array_agg(title order by title) into titles from search_jobs(p_on_campus => true, p_min_hourly => 19);
  if titles <> array['Front Desk Assistant', 'IT Help Desk Assistant'] then raise exception 'pay floor wrong: %', titles; end if;

  -- 4. Fit sort follows campus_fit, not the skills score; unscored jobs last.
  select array_agg(title) into titles from search_jobs(p_on_campus => true, p_sort => 'fit');
  if titles <> array['Front Desk Assistant', 'IT Help Desk Assistant', 'Library Assistant'] then raise exception 'fit sort wrong: %', titles; end if;

  -- 5. Physical filter.
  select array_agg(title order by title) into titles from search_jobs(p_on_campus => true, p_physical => array['low']);
  if titles <> array['Front Desk Assistant', 'IT Help Desk Assistant'] then raise exception 'physical filter wrong: %', titles; end if;

  -- 6. Newest first (the dining job is newest but excluded).
  select array_agg(title) into titles from search_jobs(p_on_campus => true, p_sort => 'new');
  if titles[1] <> 'Library Assistant' then raise exception 'newest sort wrong: %', titles; end if;

  -- 7. Tracker: one application per student per listing (a duplicate is refused by the database itself), and the
  --    submission evidence persists with its timestamp.
  insert into profiles (id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
  insert into applications (user_id, job_id, company_name, job_title, status, submission_evidence, submission_confirmed_at)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'SJSU Test', 'Front Desk Assistant', 'applied', 'Confirmation #A123', now());
  begin
    insert into applications (user_id, job_id, company_name, job_title) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'SJSU Test', 'Front Desk Assistant');
    raise exception 'duplicate application was accepted';
  exception when unique_violation then null;
  end;
  if (select submission_evidence from applications where job_id = '00000000-0000-0000-0000-000000000001') <> 'Confirmation #A123' then raise exception 'evidence not stored'; end if;

  -- 8. Constraints: physical_demand only takes the four levels; hourly pay must be positive.
  begin
    update jobs set physical_demand = 'easy' where id = '00000000-0000-0000-0000-000000000001';
    raise exception 'invalid physical_demand was accepted';
  exception when check_violation then null;
  end;
  begin
    update jobs set pay_hourly_min = 0 where id = '00000000-0000-0000-0000-000000000001';
    raise exception 'zero hourly pay was accepted';
  exception when check_violation then null;
  end;
  -- 9. Desk jobs only: a desk role or desk-described duties (physical 'low'); 'unknown' with no desk role is left out.
  select array_agg(title order by title) into titles from search_jobs(p_on_campus => true, p_desk_only => true);
  if titles <> array['Front Desk Assistant', 'IT Help Desk Assistant'] then raise exception 'desk only wrong: %', titles; end if;

  raise notice 'campus_hunter.sql: all checks passed';
end $$;
rollback;
