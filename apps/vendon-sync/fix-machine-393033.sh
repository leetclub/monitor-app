#!/bin/bash
# Fix machine 393033 data for 2026-01-16

set -euo pipefail

echo "🔧 Fixing machine 393033 (Sultan Hamra) for 2026-01-16"
echo ""

# Get DB credentials
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "📊 Before update:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

echo ""
echo "🔄 Updating to correct values (4.80 KWD, 5 transactions)..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE vendon_sales_records SET total_revenue = 4.80, total_transactions = 5, synced_at = CURRENT_TIMESTAMP WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

echo ""
echo "✅ After update:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

echo ""
echo "✅ Fix complete! The app should now show 4.80 KWD for Sultan Hamra on 2026-01-16"

