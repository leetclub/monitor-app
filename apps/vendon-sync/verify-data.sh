#!/bin/bash
# Verify data was synced successfully

set -e

echo "📊 Verifying synced data..."

DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
DB_PASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

export PGPASSWORD="$DB_PASSWORD"

echo ""
echo "📈 Summary:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_records, COUNT(DISTINCT machine_id) as machines, MIN(sale_date) as earliest_date, MAX(sale_date) as latest_date FROM vendon_sales_records"

echo ""
echo "🔻 Lowest 5 machines by revenue (yesterday):"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, machine_name, total_revenue, total_transactions, sale_date FROM vendon_sales_records WHERE sale_date >= CURRENT_DATE - INTERVAL '1 day' ORDER BY total_revenue ASC LIMIT 5"

echo ""
echo "✅ Data verification complete!"



