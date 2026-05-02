#!/bin/bash
# Run from Ubuntu WSL terminal (e.g. cd to this dir first).
# Migrations need DB connection: set PGHOST, PGPASSWORD etc. or use psql that connects to your cloud DB.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== 1. DB migrations (need psql + people_analytics DB) ==="
if psql -d people_analytics -c "SELECT 1" >/dev/null 2>&1; then
  psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
  psql -d people_analytics -f migrations/add_remote_credit_reasons.sql
  psql -d people_analytics -f migrations/add_intra_day_checkups.sql
  echo "Migrations OK."
else
  echo "Skip migrations (psql -d people_analytics not connected). Run manually:"
  echo "  psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql"
  echo "  psql -d people_analytics -f migrations/add_remote_credit_reasons.sql"
  echo "  psql -d people_analytics -f migrations/add_intra_day_checkups.sql"
fi

echo ""
echo "=== 2. Push Apps Script (clasp) ==="
MONITOR_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$MONITOR_ROOT"
if command -v clasp >/dev/null 2>&1; then
  clasp push
  echo "Clasp push OK."
elif command -v npx >/dev/null 2>&1; then
  npx clasp push
  echo "Clasp push OK."
else
  echo "Skip clasp (not found). Run: npx clasp push"
fi

echo ""
echo "=== 3. Docker build + push (optional) ==="
echo "To deploy people-api, from $SCRIPT_DIR run:"
echo "  docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest ."
echo "  docker push programmeradmin25/people-analytics-sync:api-latest"
echo "  kubectl rollout restart deployment people-analytics-api -n leet-monitor"
echo "Done."
