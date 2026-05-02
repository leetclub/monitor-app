#!/bin/bash
# Update API pods with new code (temporary solution until image is rebuilt)

set -e

echo "🔄 Updating API pods with new code..."

# Get pod name
POD=$(kubectl get pods -n leet-monitor -l app=people-analytics-api -o jsonpath='{.items[0].metadata.name}')
echo "Found pod: $POD"

# Copy updated files
echo "Copying updated files..."
kubectl cp ../people-analytics-sync/api_service.py leet-monitor/$POD:/app/api_service.py
kubectl cp ../people-analytics-sync/models.py leet-monitor/$POD:/app/models.py

echo "Files copied. Restarting pod to load new code..."
kubectl delete pod $POD -n leet-monitor

echo "⏳ Waiting for new pod to start..."
sleep 10

# Get new pod
NEW_POD=$(kubectl get pods -n leet-monitor -l app=people-analytics-api -o jsonpath='{.items[0].metadata.name}')
echo "New pod: $NEW_POD"

# Wait for it to be ready
kubectl wait --for=condition=ready pod/$NEW_POD -n leet-monitor --timeout=60s

echo ""
echo "✅ Pod updated! Testing endpoint..."
sleep 5

curl -s "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday" | python3 -m json.tool 2>/dev/null || curl -s "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday"

echo ""
echo "Note: This is temporary. For permanent solution, rebuild the Docker image."


