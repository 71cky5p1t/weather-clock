#!/usr/bin/env bash
# deploy.sh — pull the latest commit and rebuild the container only if something changed.
#
# Run it from cron on the server, e.g. every 5 minutes:
#   */5 * * * * /path/to/repo/tsv-radar/deploy.sh >> /var/log/weather-clock-deploy.log 2>&1
#
# Or force a rebuild regardless of changes:
#   ./deploy.sh --force

set -euo pipefail
cd "$(dirname "$0")"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

before=$(git rev-parse HEAD)
git fetch --quiet origin
branch=$(git rev-parse --abbrev-ref HEAD)
git merge --ff-only --quiet "origin/$branch"
after=$(git rev-parse HEAD)

if [[ "$before" == "$after" && "$FORCE" -eq 0 ]]; then
  exit 0
fi

echo "[$(date '+%F %T')] deploying ${before:0:7} -> ${after:0:7}"
docker compose up --build -d --remove-orphans
docker image prune -f >/dev/null
echo "[$(date '+%F %T')] done"
