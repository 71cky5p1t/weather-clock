#!/usr/bin/env bash
# deploy.sh — pull the latest commit and rebuild the app container if it changed.
#
# Triggered by:
#   - the `deployer` sidecar when GitHub sends a push webhook (instant), or
#   - cron as a fallback, e.g. every 15 minutes:
#       */15 * * * * /opt/weather-clock/tsv-radar/deploy.sh >> /var/log/weather-clock-deploy.log 2>&1
#
# Force a rebuild regardless of changes:  ./deploy.sh --force
#
# Note: only the tsv-radar service is rebuilt here. If you change the deployer
# or cloudflared services, run `docker compose up -d --build` by hand once.

set -euo pipefail
cd "$(dirname "$0")"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# the repo may be owned by a different uid than the one running this (webhook container)
git config --global --add safe.directory "$(git rev-parse --show-toplevel)" 2>/dev/null || true

before=$(git rev-parse HEAD)
git fetch --quiet origin
branch=$(git rev-parse --abbrev-ref HEAD)
git merge --ff-only --quiet "origin/$branch"
after=$(git rev-parse HEAD)

if [[ "$before" == "$after" && "$FORCE" -eq 0 ]]; then
  echo "[$(date '+%F %T')] up to date at ${after:0:7}"
  exit 0
fi

echo "[$(date '+%F %T')] deploying ${before:0:7} -> ${after:0:7}"
docker compose up --build -d --no-deps tsv-radar
docker image prune -f >/dev/null
echo "[$(date '+%F %T')] done"
