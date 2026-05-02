#!/bin/bash
# Check database directly (bypassing API)

DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

echo "=== Machines per date ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT DATE(sale_date) as date, COUNT(DISTINCT machine_id) as machines, COUNT(*) as records FROM vendon_sales_records GROUP BY DATE(sale_date) ORDER BY date DESC LIMIT 5"

echo ""
echo "=== Machine 393033 (Sultan Hamra) for 2026-01-16 ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions, sale_date FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

echo ""
echo "=== Lowest revenue machines for 2026-01-16 ==="
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions FROM vendon_sales_records WHERE DATE(sale_date) = '2026-01-16' ORDER BY total_revenue ASC LIMIT 5"

