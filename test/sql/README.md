# SQL behaviour checks

These run the real `search_jobs` function against a throwaway local Postgres. They need no Supabase project and never touch production.

```sh
# one-time: a local Postgres on 127.0.0.1:55432, database friday_test, with the Supabase auth/storage stubs, then every migration
psql -h 127.0.0.1 -p 55432 -U postgres -d friday_test -f test/sql/campus_hunter.sql
```

Each file runs inside a transaction that is rolled back, and raises on the first failed check.
