#!/usr/bin/env bash
# Rotate FRIDAY's Telegram bot credentials in one go.
#
#   1. In Telegram, open @BotFather → /revoke → pick the FRIDAY bot. BotFather replies with a NEW token
#      (the old one stops working at that moment).
#   2. From the repo root run:  ./scripts/rotate-telegram-token.sh   and paste the new token when asked.
#
# The token is read without echo, checked with Telegram, stored in Vercel as a sensitive production variable together
# with a fresh webhook secret, the site is redeployed (an empty commit on main, which Vercel builds), and the webhook is
# re-registered once the new deployment is live. Nothing is written to disk or printed.
set -euo pipefail
cd "$(dirname "$0")/.."

SITE="https://friday-roan.vercel.app"
VERCEL=(--project friday --scope carrier2)

read -rsp "New bot token from BotFather (input hidden): " TOKEN
echo
[[ "$TOKEN" =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]] || { echo "That doesn't look like a bot token (digits:letters). Nothing was changed."; exit 1; }

BOT=$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getMe" 2>/dev/null | python3 -I -c 'import sys, json; d = json.load(sys.stdin); print(d["result"]["username"] if d.get("ok") else "")' 2>/dev/null || true)
[[ -n "$BOT" ]] || { echo "Telegram rejected that token. Nothing was changed."; exit 1; }
echo "Token works for @${BOT}."

SECRET=$(openssl rand -hex 32)
printf %s "$TOKEN" | vercel env add TELEGRAM_BOT_TOKEN production --sensitive --force "${VERCEL[@]}" >/dev/null
printf %s "$SECRET" | vercel env add TELEGRAM_WEBHOOK_SECRET production --sensitive --force "${VERCEL[@]}" >/dev/null
echo "Stored in Vercel (production, sensitive)."

git commit --allow-empty -q -m "Redeploy: rotated Telegram bot credentials"
git push -q origin main
SHA=$(git rev-parse HEAD)
echo -n "Waiting for the new deployment"
for _ in $(seq 1 90); do
  STATE=$(gh api "repos/chaittnyaaravind/friday/commits/${SHA}/status" --jq .state 2>/dev/null || echo pending)
  [[ "$STATE" == "success" ]] && break
  [[ "$STATE" == "failure" || "$STATE" == "error" ]] && { echo; echo "The deployment failed; check Vercel. The webhook was not changed."; exit 1; }
  echo -n "."; sleep 10
done
echo
[[ "${STATE:-}" == "success" ]] || { echo "Deployment still not live after 15 minutes; run this script again once it is."; exit 1; }

curl -fsS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d url="${SITE}/api/telegram/webhook" \
  -d secret_token="${SECRET}" \
  -d 'allowed_updates=["message","callback_query"]' >/dev/null
curl -fsS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | python3 -I -c 'import sys, json; r = json.load(sys.stdin)["result"]; print("Webhook:", r.get("url"), "| pending:", r.get("pending_update_count"), "| last error:", r.get("last_error_message") or "none")'
unset TOKEN SECRET
echo "Done. Send /start to @${BOT} to check the bot answers."
