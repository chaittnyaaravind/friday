# FRIDAY — SJSU + Silicon Valley career agent

FRIDAY finds SJSU on-campus jobs and Silicon Valley CS internships, ranks each one against a student's profile with a **transparent** explanation, helps prepare applications without ever inventing experience, and tracks everything through to an offer.

> An independent student tool. Not affiliated with San José State University. Work-authorization notes are informational only — verify with SJSU ISSS.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Storage, RLS) · Claude (`claude-opus-5`) via `@anthropic-ai/sdk` · Vitest.

## How the agent works

```
DISCOVER → FILTER → DEDUPLICATE → VERIFY → MATCH → ANALYZE → TAILOR → PREPARE → you review → you apply → TRACK → FOLLOW UP
```

| Stage | Where |
|---|---|
| Discover — public ATS feeds (Workday, Greenhouse, Lever, Ashby, SmartRecruiters) and official SJSU hiring pages | `src/lib/discovery/sources.ts`, `registry.ts` |
| Filter — student roles, technical roles, US, Bay Area / remote | `src/lib/discovery/ingest.ts` → `normalizePosting` |
| Deduplicate — one opportunity per `company::title::city`; every sighting is a `job_sources` row; official apply URL wins | `src/lib/domain/normalize.ts` → `canonicalKey`, `ingest.ts` |
| Verify — `last_verified_at` on every run; listings a feed stops returning are closed | `ingest.ts` → `closeStale` |
| Match — deterministic, explainable (strong / missing / difficulty / distance) | `src/lib/domain/match.ts` |
| Analyze / Tailor / Cover letter / Chat — Claude, schema-validated, with a deterministic no-fabrication guard | `src/lib/ai/*`, `src/app/api/chat` |

**Sources FRIDAY never scrapes:** LinkedIn, Indeed and Handshake have no student API and their terms forbid scraping. Students import a listing by pasting it (`POST /api/jobs/import`); it joins the same dedupe pipeline. Companies without a public feed (Apple, Google, Meta, Amazon, Microsoft, Tesla…) are "watch" entries that link to their official careers pages.

**FRIDAY never** submits an application, marks one "Applied", solves CAPTCHAs, bypasses MFA/anti-bot systems, creates accounts, or adds experience to a resume.

## Setup

```bash
cp .env.example .env.local        # fill in the values below
npm install
npm run dev                       # http://localhost:3000
```

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Everything (auth + data; RLS-protected) |
| `SUPABASE_SECRET_KEY` | Discovery agent writes to the shared job catalog, and imports |
| `ANTHROPIC_API_KEY` | Resume parsing, requirement refinement, tailoring, cover letters, FRIDAY chat |
| `CRON_SECRET` | Authenticates Vercel Cron → `/api/agent/cron` (daily, `vercel.json`) |

Database: apply `supabase/migrations/*.sql` in order (already applied to the `friday` project).

Missing credentials never fail silently — the affected feature says what's not configured (HTTP 503 `{ notConfigured: true }`, and a status panel in Settings).

## Scripts

`npm run dev` · `npm run build` · `npm test` · `npm run typecheck` · `npm run lint`

## API

`GET /api/jobs` · `/api/jobs/search` · `/api/jobs/nearby` · `/api/jobs/on-campus` · `/api/jobs/internships` · `GET /api/jobs/:id` · `POST|DELETE /api/jobs/:id/save` · `POST /api/jobs/:id/match` · `POST /api/jobs/import` ·
`GET /api/companies` · `GET /api/companies/:id/jobs` · `POST|DELETE /api/companies/:id/watch` ·
`GET|POST /api/resumes` · `POST /api/resumes/tailor` ·
`GET|POST /api/applications` · `GET|PATCH|DELETE /api/applications/:id` · `POST /api/applications/:id/cover-letter` ·
`GET|POST|PATCH /api/follow-ups` · `GET|POST|DELETE /api/interviews` · `GET|PATCH /api/notifications` · `GET|PATCH /api/profile` ·
`POST /api/agent/search` · `POST /api/agent/analyze-job` · `GET /api/agent/cron` · `POST /api/chat` (SSE)

All job-list endpoints accept the same filters: `q, type, category, campus, miles, includeRemote, remote, hybrid, company, industry, source, posted, deadline, skills, hideRestricted, saved, sort, limit, offset`.

## Expanding beyond SJSU

University, origin and radius live on the profile; SJSU pages are ordinary `registry.ts` entries with `isSjsu`; cities are a table in `geo.ts`; skills are a taxonomy in `skills.ts`. Adding a school or city is data, not a rewrite.
