#!/usr/bin/env bash
# Start the backend + a public tunnel so Twilio can reach your laptop.
# Usage:  bash scripts/start-sms.sh
#
# It will:
#   1. open a free cloudflared tunnel to localhost:3001
#   2. write that public URL into .env as PUBLIC_BASE_URL
#   3. start the NestJS backend
#   4. print the webhook URL to paste into your Twilio number's settings
#
# Stop everything with Ctrl+C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CF="$HOME/.local/bin/cloudflared"
PORT="${PORT:-3001}"

if [[ ! -x "$CF" ]]; then
  echo "cloudflared not found at $CF — re-run the setup step." >&2
  exit 1
fi

echo "▶ opening public tunnel to localhost:$PORT ..."
TUNLOG="$(mktemp)"
"$CF" tunnel --url "http://localhost:$PORT" >"$TUNLOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null || true' EXIT

# Wait for the trycloudflare URL to appear.
URL=""
for _ in $(seq 1 30); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNLOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
if [[ -z "$URL" ]]; then
  echo "Could not get a tunnel URL. Tunnel log:" >&2
  cat "$TUNLOG" >&2
  exit 1
fi

echo "▶ public URL: $URL"

# Update PUBLIC_BASE_URL in .env (create the line if missing).
if grep -q '^PUBLIC_BASE_URL=' .env; then
  # macOS/BSD sed
  sed -i '' "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$URL|" .env
else
  printf '\nPUBLIC_BASE_URL=%s\n' "$URL" >> .env
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
echo " Paste THIS into your Twilio number's 'A MESSAGE COMES IN' box:"
echo ""
echo "   $URL/webhooks/twilio/sms      (HTTP POST)"
echo ""
echo "─────────────────────────────────────────────────────────────"
echo ""
echo "▶ starting backend on :$PORT (Ctrl+C to stop everything) ..."
npm run start --workspace @smm/backend
