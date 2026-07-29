#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Deploy to Fly.io — YouTube Auto Uploader
#
# Prerequisites:
#   1. flyctl installed: curl -L https://fly.io/install.sh | sh
#   2. Logged in: fly auth login
#   3. App created: fly apps create autoupload
#   4. Volumes created (one-time):
#      fly volumes create autoupload_data -r sin -s 2
#      fly volumes create autoupload_downloads -r sin -s 8
#      fly volumes create autoupload_logs -r sin -s 1
#   5. Secrets set:
#      fly secrets set GOOGLE_CREDENTIALS_JSON='{"web":{...}}'
#      fly secrets set DASHBOARD_PASSWORD='your-12-char-password'
#      fly secrets set SESSION_SECRET='random-64-char-string'
#      fly secrets set APP_URL='https://autoupload.fly.dev'
#   6. OAuth redirect URI registered in Google Cloud Console:
#      https://autoupload.fly.dev/oauth2callback
#
# Usage: bash scripts/deploy-fly.sh
# ═══════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════╗"
echo "║  🚀 Deploying to Fly.io (Singapore)     ║"
echo "╚══════════════════════════════════════════╝"
echo

# Pre-flight checks
echo "Pre-flight checks..."
command -v fly >/dev/null 2>&1 || { echo "❌ flyctl not installed. Run: curl -L https://fly.io/install.sh | sh"; exit 1; }
fly status >/dev/null 2>&1 || { echo "❌ Not logged in or app not found. Run: fly auth login && fly apps create autoupload"; exit 1; }

# Check secrets
echo "Checking secrets..."
SECRETS=$(fly secrets list 2>/dev/null || echo "")
for secret in DASHBOARD_PASSWORD APP_URL GOOGLE_CREDENTIALS_JSON; do
  if ! echo "$SECRETS" | grep -q "$secret"; then
    echo "⚠️  Missing secret: $secret"
    echo "   Set with: fly secrets set $secret='value'"
    exit 1
  fi
done
echo "✓ All required secrets are set"

# Deploy
echo
echo "Deploying..."
fly deploy --ha=false

# Wait for healthy
echo
echo "Waiting for health check..."
sleep 10

APP_URL=$(fly info --json 2>/dev/null | grep -o '"Hostname":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$APP_URL" ]; then
  APP_URL="autoupload.fly.dev"
fi

echo "Checking https://$APP_URL/api/health/live ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$APP_URL/api/health/live" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Deploy successful!"
  echo
  echo "  🌐 Dashboard: https://$APP_URL"
  echo "  🔧 Engine:    https://$APP_URL/api/engine/status"
  echo "  💚 Health:    https://$APP_URL/api/health/ready"
  echo
  echo "Next steps:"
  echo "  1. Open https://$APP_URL and login with DASHBOARD_PASSWORD"
  echo "  2. Go to Accounts → Login YouTube (OAuth consent flow)"
  echo "  3. Add keywords to Watchlist"
  echo "  4. POST /api/engine/start to begin 24/7 autonomous mode"
else
  echo "⚠️  Health check returned $HTTP_CODE — check logs:"
  echo "    fly logs --app autoupload"
fi
