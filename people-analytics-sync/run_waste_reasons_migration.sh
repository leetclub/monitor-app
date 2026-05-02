#!/bin/sh
# Run waste_analysis_reasons table migration.
# Usage: ./run_waste_reasons_migration.sh
# Uses psql without password (trust auth). Ensure people_analytics DB exists:
#   createdb people_analytics   # if needed
set -e
cd "$(dirname "$0")"
if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL client or run the SQL manually:"
  echo "  migrations/add_waste_analysis_reasons.sql"
  exit 1
fi
# Try default connection (no user/pass)
psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
echo "Migration completed."
