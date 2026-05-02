#!/bin/bash
set -euo pipefail

echo "🚀 Triggering manual historical performance sync..."

TIMESTAMP=$(date +%s)
JOB_NAME="historical-performance-sync-manual-$TIMESTAMP"

echo "Creating job: $JOB_NAME"
kubectl create job --from=cronjob/historical-performance-sync "$JOB_NAME" -n leet-monitor

echo "✅ Job created: $JOB_NAME"
echo ""
echo "Waiting for job to start..."
sleep 10

# Get job status
kubectl get job "$JOB_NAME" -n leet-monitor

echo ""
echo "📜 Job logs (last 50 lines):"
POD_NAME=$(kubectl get pods -n leet-monitor -l job-name="$JOB_NAME" -o jsonpath='{.items[0].metadata.name}')
if [ -n "$POD_NAME" ]; then
    kubectl logs -n leet-monitor "$POD_NAME" --tail=50
else
    echo "No pods found for job $JOB_NAME yet."
fi

echo ""
echo "⏳ Waiting for job to complete (this may take several minutes)..."
kubectl wait --for=condition=complete job/"$JOB_NAME" -n leet-monitor --timeout=600s || echo "Job may still be running or failed"

echo ""
echo "📊 Final job status:"
kubectl get job "$JOB_NAME" -n leet-monitor

echo ""
echo "✅ Sync job complete! Check the logs above for any errors."

