#!/bin/bash
set -euo pipefail

echo "📊 Verifying synced historical performance data..."

# Get DB credentials from Kubernetes secrets
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo ""
echo "📈 Summary:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_records, COUNT(DISTINCT machine_id) as machines, MIN(start_date) as earliest_date, MAX(end_date) as latest_date FROM historical_performance_records;"

echo ""
echo "🔝 Top 5 machines by revenue (latest date range):"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, machine_name, total_revenue, total_quantity, start_date, end_date FROM historical_performance_records ORDER BY total_revenue DESC LIMIT 5;"

echo ""
echo "✅ Data verification complete!"

