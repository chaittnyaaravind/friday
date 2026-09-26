# FRIDAY — SJSU + Silicon Valley career agent

FRIDAY finds SJSU on-campus jobs and Silicon Valley CS internships, ranks each one against a student's profile with a **transparent** explanation, helps prepare applications without ever inventing experience, and tracks everything through to an offer.

> An independent student tool. Not affiliated with San José State University. Work-authorization notes are informational only — verify with SJSU ISSS.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, Storage, RLS) · free LLMs (Groq / Gemini / OpenRouter / Ollama) via any OpenAI-compatible endpoint · Vitest.

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
| Analyze / Tailor / Cover letter / Chat — free LLM, schema-validated, with a deterministic no-fabrication guard | `src/lib/ai/*`, `src/app/api/chat` |
| AI resume editor — click a bullet to Improve / Shorten / Make clearer / Make technical / ATS-optimize / Fix grammar / Generate alternatives / Quantify (asks for a real number, never invents one). Each suggestion is BEFORE / AFTER / WHY / EVIDENCE / NEW CLAIMS with a risk level; unsupported numbers or technologies are blocked and flagged, softer claims need your confirmation, nothing applies without Accept. Plus Analyze Resume (recommendations only), Match to Job (keywords + NVIDIA embeddings + Nemotron explanation; similarity is never proof of a skill), explainable ATS score, version history and 5 templates. Guard: `lib/resume/guard.ts`; accepted AI lines are re-checked on save and export | `src/components/resume/*`, `src/lib/resume/{guard,edits,analysis,ats,jobmatch,history,templates}.ts`, `src/lib/ai/resume.ts`, `src/app/api/resumes/ai` |

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
| `NVIDIA_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` (any, free) or `AI_PROVIDER=ollama` | Job analysis, cover letters, FRIDAY chat, AI resume editing, semantic job matching, resume-image parsing. Optional: without one, FRIDAY Local, the local resume engine, ATS scoring, job matching and grammar cleanup still work. `AI_PROVIDER` picks the general preference; every other configured provider is an automatic fallback |
| `AI_TASK_<TASK>` (optional) | Per-task model routing, e.g. `AI_TASK_RESUME_REWRITE=nvidia:moonshotai/kimi-k2.6,gemini,groq`. Tasks: `resume_rewrite`, `resume_analysis`, `ats_analysis`, `job_matching`, `semantic_search`, `document_parsing`. Defaults live in `src/lib/ai/routing.ts` |
| `CRON_SECRET` | Authenticates Vercel Cron → `/api/agent/cron` (daily, `vercel.json`) |

Database: apply `supabase/migrations/*.sql` in order (applied to the `friday` project through 0006, including resume history and templates).

**AI routing.** Each task has an ordered list of `provider:model` routes (`src/lib/ai/routing.ts`); providers without a key are skipped, and a failing model falls back to the next route and then to every other configured provider. Defaults use NVIDIA's free catalog: Nemotron 3 Super for rewriting and job reasoning, Nemotron 3 Super first for every structured-JSON task (thinking disabled, so answers are clean JSON), with Nemotron 3.5 Lightning as the NVIDIA fallback, Nemotron 3 Embed for semantic matching, Nemotron Parse for resume images. Every attempt logs `{task, provider, model, ms, ok, error category}` — never prompts or resume text. Model output is always a *proposal*: it passes the fact validator (`lib/resume/guard.ts`) and needs your approval before anything is applied.

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
