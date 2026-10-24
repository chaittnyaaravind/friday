# Auto Hunter

New SJSU desk job → within ~5 minutes a Telegram card with the job, why it is (or is not) desk work, pay, a summary,
your tailored resume's coverage, and exactly what Approve will do → one tap → sent from **your** Gmail (email
applications) or the resume PDF + official link come back to you (everything else) → "applied" in the tracker, with a
follow-up a week later. **Nothing is sent that you did not approve**, and an approval is bound to the exact content the
card showed: if the listing or packet changes, nothing is approved and a fresh card is sent.

| Piece | Where |
|---|---|
| 5-minute watch (SJSU sources only) | `GET /api/agent/watch` — `src/app/api/agent/watch/route.ts` |
| Queue, tailoring, packet, card | `src/lib/hunter/pipeline.ts` (rules: `enqueue`) |
| Buttons / bridge receipt | `src/lib/hunter/actions.ts`, `src/app/api/telegram/webhook/route.ts` |
| How a posting is applied to | `src/lib/hunter/apply-channel.ts` (email only to an `@sjsu.edu` address and only when nothing else is asked for) |
| Gmail bridge | `scripts/gmail-bridge.gs` + `src/app/api/bridge/*` |
| Handshake | the student's own Handshake alert emails, via the bridge (`src/lib/hunter/handshake-mail.ts`). FRIDAY never contacts Handshake. |
| Tables | migration `0018_auto_hunter.sql` (after `0017`); schedule `0019_watch_schedule.sql` |

## One-time setup (owner)

1. **Database**: apply `0017_campus_hunter.sql`, then `0018_auto_hunter.sql`, BEFORE deploying the code (the search RPC gains `p_desk_only`).
2. **Telegram bot**: in Telegram, message `@BotFather` → `/newbot` → note the token and the bot's username.
3. **Vercel env** (project `friday`, Production): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (without `@`),
   `TELEGRAM_WEBHOOK_SECRET` (any long random string, letters/digits/`_-` only), and `NEXT_PUBLIC_SITE_URL` if not set. Redeploy.
4. **Register the webhook** (once):
   ```sh
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://friday-roan.vercel.app/api/telegram/webhook" \
     -d secret_token="$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]'
   ```
5. **5-minute trigger**: migration `0019_watch_schedule.sql` — Supabase's own pg_cron calls `/api/agent/watch` every 5
   minutes via pg_net, with a token generated inside Postgres and kept in Vault (FRIDAY stores only its hash). Check it with
   `select * from cron.job_run_details order by start_time desc limit 5;` and `select status_code from net._http_response order by created desc limit 5;`.
   (`.github/workflows/watch.yml` is an hourly backup only: this private repo bills each Actions run as at least a minute.)

## Per student

1. FRIDAY → Settings → Auto Hunter → **Connect Telegram** → open the bot → Start. Open desk jobs from the last 2 weeks arrive right away.
2. **Connect Gmail** → copy the token → script.google.com → New project → paste `scripts/gmail-bridge.gs` → Script
   properties `FRIDAY_URL`, `FRIDAY_TOKEN` → run `setup` → allow.
3. Handshake → turn on email alerts for your saved searches (e.g. "Student Assistant", "Front Desk", employer San José State University).

## What it will not do

- Log in to or scrape Handshake (its terms forbid automated access; your account is your SJSU login).
- Fill in or sign forms (e.g. the SJSU Student Assistant application form), transcripts or availability sheets. Such
  postings are handed back to you with the reason stated on the card.
- Email any address outside `sjsu.edu`, or anything you did not approve.

## Unverified

- The Handshake alert parser is tested on a synthetic email shaped like Handshake's cards, not a real one. Forward one
  real alert to check it; links that hide the job id behind a tracking redirect are skipped, not followed.
