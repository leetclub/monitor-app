#!/bin/bash
# Revert manual fix and test the real sync

set -euo pipefail

echo "🔄 Step 1: Reverting manual fix..."
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE vendon_sales_records SET total_revenue = 0, total_transactions = 0 WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"
echo "✅ Reverted to 0.0 KWD"

echo ""
echo "🚀 Step 2: Running sync with fixed code..."
kubectl delete job vendon-sync-verify-fix -n leet-monitor 2>/dev/null || true
sleep 2
kubectl apply -f k8s/test-sync-2026-01-16.yaml
echo "✅ Sync job created"

echo ""
echo "⏳ Step 3: Waiting for sync to complete..."
kubectl wait --for=condition=complete --timeout=300s job/vendon-sync-verify-fix -n leet-monitor || echo "Job may still be running"

echo ""
echo "📊 Step 4: Checking results..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT machine_id, total_revenue, total_transactions FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'"

DB_REVENUE=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT total_revenue FROM vendon_sales_records WHERE machine_id = '393033' AND DATE(sale_date) = '2026-01-16'")

echo ""
if [ "$(echo "$DB_REVENUE == 4.8" | bc -l)" = "1" ]; then
    echo "✅ SUCCESS: Sync correctly fetched 4.8 KWD from Vendon API!"
else
    echo "❌ FAILED: Database shows $DB_REVENUE KWD, expected 4.8 KWD"
    echo "   The sync fix may not be working correctly."
fi

