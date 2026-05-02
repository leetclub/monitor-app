#!/bin/bash
# Verify the sync fix worked correctly

set -euo pipefail

echo "🔍 Verifying Sync Fix for Machine 393033"
echo ""

# Get DB credentials
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "📊 Database value for machine 393033 on 2026-01-16:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions, synced_at FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

echo ""
echo "📡 Vendon API value (expected):"
echo "   Revenue: 4.80 KWD"
echo "   Transactions: 5"

echo ""
echo "✅ Verification:"
DB_REVENUE=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT total_revenue FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'")

# Allow 4.8 with floating-point tolerance (e.g. 4.800000000000001)
if [ -n "$DB_REVENUE" ] && [ "$(echo "$DB_REVENUE >= 4.79 && $DB_REVENUE <= 4.81" | bc -l 2>/dev/null)" = "1" ]; then
    echo "   ✅ Database matches Vendon API (4.8 KWD)"
else
    echo "   ❌ Database shows $DB_REVENUE KWD, expected 4.8 KWD"
fi

