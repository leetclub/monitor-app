#!/usr/bin/env bash
set -euo pipefail
ROOT=/mnt/c/Users/mahdi/OneDrive/theleetclub/monitoring-app
export KUBECONFIG=/mnt/c/Users/mahdi/OneDrive/theleetclub/k8s-1-31-1-do-5-nyc1-1737653282089-kubeconfig.yaml
# shellcheck disable=SC1090
eval "$(python3 "$ROOT/people-analytics-sync/scripts/_emit_pa_secret_env.py" "$KUBECONFIG")"
export DB_SSLMODE=require
export BACKFILL_FROM="${BACKFILL_FROM:-2025-01-01}"
export BACKFILL_TO="${BACKFILL_TO:-$(TZ=Asia/Kuwait date -d yesterday +%Y-%m-%d)}"
export BACKFILL_MAX_DAYS="${BACKFILL_MAX_DAYS:-0}"
echo "DB_HOST=$DB_HOST BACKFILL=${BACKFILL_FROM}..${BACKFILL_TO} key_len=${#VENDON_API_KEY}"

VENV=/tmp/revenue-cache-backfill-venv
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$ROOT/people-analytics-sync/requirements.txt"
fi
cd "$ROOT/people-analytics-sync"
"$VENV/bin/python" -u scripts/backfill_vendon_revenue_cache.py
