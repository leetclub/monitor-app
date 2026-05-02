#!/bin/bash
# Run remote_credit_reasons migration.
# Run in Cursor WSL terminal: bash run-remote-credit-migration.sh
set -e
cd "$(dirname "$0")"
psql -d people_analytics -f migrations/add_remote_credit_reasons.sql
echo "Done: remote_credit_reasons table created/updated."
