#!/bin/bash
# Run intra_day_checkups migration.
# Run in Ubuntu WSL: bash run-intra-day-checkup-migration.sh
# For remote DB (e.g. Digital Ocean), set: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE=people_analytics
# Example: PGHOST=your-db.db.ondigitalocean.com PGPORT=25060 PGUSER=doadmin PGPASSWORD=xxx PGDATABASE=people_analytics bash run-intra-day-checkup-migration.sh
set -e
cd "$(dirname "$0")"
DB="${PGDATABASE:-people_analytics}"
psql -d "$DB" -f migrations/add_intra_day_checkups.sql
echo "Done: intra_day_checkups table created/updated."
