# FRIDAY Hunt Engine — final report

Status: Phases 1–6 built and verified locally. **Nothing is committed, pushed or deployed.** Database migrations 0011–0016 are already applied to production (additive only). FRIDAY submits nothing anywhere; there is no autonomous submission.

## Test results (final run)

| Check | Result |
|---|---|
| `npx vitest run` (unit + integration + regression + render) | **PASS — 52 files, 906 tests, 0 failed** |
| `npx tsc --noEmit` | PASS, no errors |
| `npx eslint src` | PASS, no warnings |
| `npx next build` | PASS (new routes listed: `/hunt`, `/applications/[id]/packet`, `/api/applications/[id]/packet[/approve|/handoff]`, `/api/sources/status`, resume master/report) |
| Supabase security advisor | only the pre-existing "leaked password protection disabled" warning |
| Prod schema check after each migration | single `search_jobs` overload, default totals unchanged (253 active), policies/RLS present |

Test count by phase (cumulative at each phase's close): Phase 4 → 767 (44 files); Phase 5 → 831 (48 files); Phase 6 → 906 (52 files). Failures found along the way were fixed in the code or in a test *helper* (never by loosening an assertion): adapter assumptions corrected against real payloads, Pacific-time deadlines, whitelist entries the validator would always refuse, a Tailwind `disabled:` class fooling a test helper, curly-apostrophe normalisation in a text helper.

## Tests added

- **Phase 1** `sources.test.ts`, `hunt-foundation.test.ts`, `hunt-integration.test.ts`, baseline cases in `freshness.test.ts` — recorded live fixtures for every adapter, close-guard, baseline, events, hashes.
- **Phase 2** `hunt.test.ts`, `hunt-views.test.ts`, `hunt-ui.test.ts`.
- **Phase 3** `hours.test.ts`, `campus.test.ts`, `pay.test.ts` (+ additions to the Phase 1 files).
- **Phase 4** `match-v2.test.ts` (sha256 golden hash: scores over 400 seeded pairs are unchanged), `eligibility.test.ts`, `explain.test.ts`, `match-detail.test.ts`.
- **Phase 5** `terminology.test.ts` (23), `report.test.ts` (17), `tailor-service.test.ts` (16), `report-panel.test.ts` (8).
- **Phase 6** `packet.test.ts` (32), `listing-sync.test.ts` (14), `packet-service.test.ts` (17), `packet-review.test.ts` (12).
- Live (not in CI): `npm run test:live` → `test/live/sjsu-probe.live.ts`.

## Database changes (production, all additive, applied via Supabase migrations)

| # | What |
|---|---|
| 0011 | `jobs`: `content_hash`, `description_hash`, `closed_at`, `is_baseline`; `job_sources.source_fields`; new `job_events`, `source_health`, `source_capabilities` |
| 0012 | `search_jobs` gains `p_first_seen_after`, `p_exclude_baseline`, `p_deadline_after`, `p_min_score` and a `first_seen` sort; `jobs_first_seen_idx` |
| 0013 | `pinpoint` source type; `jobs.hours_min`, `hours_max`, `campus_roles`, `campus_employer`; `search_jobs` gains `p_campus_roles`, `p_campus_employers` |
| 0014 | `job_matches.breakdown`, `eligibility`, `eligibility_checks`; `search_jobs` gains `p_hide_blocked` |
| 0015 | `resume_versions.is_master` (one per student, base only); `tailoring_reports` (insert-only RLS); `set_master_resume` / `clear_master_resume` |
| 0016 | `application_packets` + `packet_approvals` (immutable, insert/select-only RLS, composite owner FKs); `application_status` gains `closed` |

No existing row was changed by any migration.

## APIs changed

New: `GET /api/sources/status` · `POST|DELETE /api/resumes/versions/:id/master` · `GET /api/resumes/versions/:id/report` · `GET|POST /api/applications/:id/packet` · `POST /api/applications/:id/packet/approve` · `POST /api/applications/:id/packet/handoff`.
Changed: `POST /api/jobs/:id/match` (breakdown, eligibility, reasons) · `POST /api/resumes/tailor` (preview now includes spelling changes; accept returns the report) · `/api/applications` and `/:id` accept status `closed` · `search_jobs` RPC (optional trailing params, backwards compatible).
New pages: `/hunt`, `/applications/:id/packet`. Edited: jobs list/detail, SJSU, resume list/editor/tailor, tracker board, apply panel.

## How Phase 6 keeps the human in control

- FRIDAY assembles a **packet snapshot** (resume text, cover letter, profile answers, extra answers, apply link). It never submits, never fills an outside form and never marks an application Applied.
- **Approval is bound to a sha256 of exactly what would be sent.** Edit anything → new packet, no approval. The apply link changing after approval also voids it.
- **Hand-off re-checks the live listing at the click** (still open? before the deadline? same link?) and only then returns the official URL; the student opens it and submits themselves.
- **Blockers** (cannot approve): listing closed, deadline passed, no apply link, no resume, resume claims without evidence, missing name/email, a reported question with no answer, a required cover letter that is missing. **Confirmations** (student ticks a stated sentence): eligibility "verify"/"blocked", work authorization not on profile, AI-drafted cover letter. **Info**: documents FRIDAY cannot prepare; "FRIDAY does not submit; no source has been verified to permit automation".
- The tracker's new `closed` status is set only for saved/preparing/ready applications whose listing closed, is logged with the previous status, and is reversed only if FRIDAY made the move.

## Files changed

32 tracked files modified, 53 new paths (source, tests, fixtures, 6 migrations) — see `git status`. Key new areas: `src/lib/apply/*`, `src/components/apply/*`, `src/components/resume/report-panel.tsx`, `src/lib/discovery/{capabilities,change,close-guard,health}.ts`, `src/lib/domain/{hunt,hours,campus,eligibility,explain}.ts`, `src/lib/resume/{terminology,report,tailor-service}.ts`, `test/fixtures/sources/*`, `supabase/migrations/0011–0016`.

## Remaining uncertainties

1. **Not exercised end to end with a real signed-in user.** Every flow is proven against an in-memory database and the real schema/policies were checked by SQL, but no browser session hit the new routes on a real deployment. Do one pass after deploying (below).
2. **No visual review yet.** The new screens reuse the existing components and tokens, but I did not screenshot `/hunt`, the match panels, the report panel or the packet screen at 390 px / 1440 px.
3. **FRIDAY cannot see the live application form.** "Extra questions" are reported by the student; the "documents the posting mentions" list is a wording heuristic over the posting text.
4. **Eligibility is heuristic** (text patterns + profile). It is labelled informational; the F-1 20-hour rule is applied only to on-campus work.
5. **AI cover letters are not verified line by line** — they always require the student's tick.
6. **Freshness means "first seen by FRIDAY"**, bounded by the crawl cadence (GitHub Actions every 3 hours, best effort, plus one daily Vercel cron). No source is claimed real-time; Workday's `startDate` semantics remain unverified and unused.
7. **Existing data is un-backfilled:** the 11 existing on-campus jobs and 263 match rows have no campus roles / eligibility verdict until the next discovery run on the new code.
8. **Fixtures were captured live on 2026-09-27/28** and will drift; `npm run test:live` re-probes the SJSU pages.

## Decisions for you

1. **Deploy.** Migrations are live; the code is not. Order: commit → push (Vercel auto-deploys from `main`) → trigger one discovery run → smoke-test one application through the packet screen.
2. **Should a "Likely blocked" eligibility verdict be tick-through (current) or a hard stop?**
3. **Auto-moving pre-submission applications to `closed`** when a listing closes (current, logged and reversible) — keep, or show a badge only?
4. **Should any source ever be allowed automated submission?** Currently none, and the policy is a constant, not a switch.
5. Optional follow-ups I did not build: a `job_events` timeline on the job page; Greenhouse `application_deadline` mapping; suppressing new-match alerts for likely-blocked jobs.
