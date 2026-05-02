#!/bin/bash
# Run everything from Ubuntu WSL. Usage: ./do-all-wsl.sh
# Requires: psql (DB), docker (optional), clasp or npx (optional)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNC="$(cd "$(dirname "$0")" && pwd)"
cd "$SYNC"

echo "========== 1. DB migrations =========="
if command -v psql >/dev/null 2>&1; then
  if psql -d people_analytics -c "SELECT 1" >/dev/null 2>&1; then
    psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
    psql -d people_analytics -f migrations/add_remote_credit_reasons.sql
    psql -d people_analytics -f migrations/add_intra_day_checkups.sql
    echo "Migrations OK."
  else
    echo "psql: cannot connect to people_analytics (set PGHOST/PGUSER/PGPASSWORD or run manually)."
    echo "  psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql"
    echo "  psql -d people_analytics -f migrations/add_remote_credit_reasons.sql"
    echo "  psql -d people_analytics -f migrations/add_intra_day_checkups.sql"
  fi
else
  echo "psql not found. Skip migrations."
fi

echo ""
echo "========== 2. Clasp push (Apps Script) =========="
cd "$ROOT"
if command -v clasp >/dev/null 2>&1; then
  clasp push && echo "Clasp push OK."
elif command -v npx >/dev/null 2>&1; then
  npx clasp push && echo "Clasp push OK."
else
  echo "clasp/npx not found. Run manually: npx clasp push"
fi

echo ""
echo "========== 3. Docker build + push =========="
cd "$SYNC"
if docker info >/dev/null 2>&1; then
  docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest .
  docker push programmeradmin25/people-analytics-sync:api-latest
  echo "Docker push OK."
else
  echo "Docker not available or permission denied. Run manually:"
  echo "  docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest ."
  echo "  docker push programmeradmin25/people-analytics-sync:api-latest"
fi

echo ""
echo "========== 4. K8s rollout =========="
if command -v kubectl >/dev/null 2>&1; then
  kubectl rollout restart deployment people-analytics-api -n leet-monitor 2>/dev/null && echo "Rollout OK." || echo "kubectl rollout failed (check context/namespace)."
else
  echo "kubectl not found. Run manually: kubectl rollout restart deployment people-analytics-api -n leet-monitor"
fi

echo ""
echo "Done."
