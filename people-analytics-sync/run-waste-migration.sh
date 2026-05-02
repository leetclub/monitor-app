#!/bin/bash
# Run waste_analysis_reasons migration.
# Run in Cursor WSL terminal: bash run-waste-migration.sh
# Uses psql with no host/user/password (cloud connection).
set -e
cd "$(dirname "$0")"
psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
echo "Done: waste_analysis_reasons table created/updated."
