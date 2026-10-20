#!/usr/bin/env bash
# Interview demo on this Mac: the production build, demo mode only, on http://127.0.0.1:3080.
# Live mode is forced off and no key is passed, whatever .env.local holds: nothing calls a paid API,
# and the page needs no network once loaded. Stop it with Ctrl-C.
#   usage: scripts/demo-local.sh [--no-build]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3080

if [ "${1:-}" != "--no-build" ]; then
  pnpm build
  # The standalone server serves these from its own folder (same as the Docker image).
  rm -rf .next/standalone/public .next/standalone/.next/static
  cp -R public .next/standalone/
  cp -R .next/static .next/standalone/.next/
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  echo "port $PORT is in use; stop that process first"
  exit 1
fi

echo "Kumihimo demo: http://127.0.0.1:$PORT  (demo data only; Ctrl-C to stop)"
exec env -u ATLASCLOUD_API_KEY \
  LIVE_MODE=off KUMIHIMO_PASSCODES= KUMIHIMO_FIRESTORE_PROJECT= GOOGLE_CLOUD_PROJECT= \
  NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$PORT" \
  node .next/standalone/server.js
