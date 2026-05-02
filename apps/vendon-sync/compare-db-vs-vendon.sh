#!/bin/bash
# Simple script to compare DB data with Vendon API for a specific machine

set -euo pipefail

MACHINE_ID="${1:-393033}"  # Default to Sultan Hamra
DATE="${2:-2026-01-16}"    # Default date

echo "🔍 Comparing machine $MACHINE_ID for date $DATE"
echo ""

# Get DB data
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "📊 Database data:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT machine_id, machine_name, total_revenue, total_transactions, sale_date
  FROM vendon_sales_records 
  WHERE machine_id = '$MACHINE_ID' AND DATE(sale_date) = '$DATE'
"

echo ""
echo "📡 Vendon API data (check manually):"
echo "curl -s 'https://cloud.vendon.net/rest/v1.9.0/stats/vends?from_timestamp=START&to_timestamp=END&machine_id=$MACHINE_ID&limit=10000' -H 'Authorization: Token KEY'"
echo ""
echo "To get timestamps:"
echo "  START=\$(date -d '$DATE 00:00:00' +%s)"
echo "  END=\$(date -d '$DATE 23:59:59' +%s)"

