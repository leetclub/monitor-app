#!/bin/bash
# Trigger manual sync and verify data

set -e

echo "🔍 Step 1: Verifying database tables exist..."
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
DB_PASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

export PGPASSWORD="$DB_PASSWORD"

echo "Checking vendon_sales_records table..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\d vendon_sales_records" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Table vendon_sales_records exists"
else
    echo "❌ Table vendon_sales_records does not exist!"
    exit 1
fi

echo ""
echo "📊 Current data in database:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_records, COUNT(DISTINCT machine_id) as machines, MIN(sale_date) as earliest_date, MAX(sale_date) as latest_date FROM vendon_sales_records"

echo ""
echo "🚀 Step 2: Triggering manual sync job..."
JOB_NAME="vendon-sales-sync-manual-$(date +%s)"
kubectl create job --from=cronjob/vendon-sales-sync "$JOB_NAME" -n leet-monitor
echo "✅ Job created: $JOB_NAME"

echo ""
echo "⏳ Waiting for job to start..."
sleep 10

echo ""
echo "📋 Job status:"
kubectl get job "$JOB_NAME" -n leet-monitor

echo ""
echo "📜 Job logs (last 50 lines):"
kubectl logs -n leet-monitor job/"$JOB_NAME" --tail=50 || echo "Job may still be starting..."

echo ""
echo "⏳ Waiting for job to complete (this may take a few minutes)..."
kubectl wait --for=condition=complete --timeout=300s job/"$JOB_NAME" -n leet-monitor || echo "Job may still be running or failed"

echo ""
echo "📊 Final data in database:"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) as total_records, COUNT(DISTINCT machine_id) as machines, MIN(sale_date) as earliest_date, MAX(sale_date) as latest_date FROM vendon_sales_records"

echo ""
echo "✅ Sync complete! Check the logs above for any errors."



