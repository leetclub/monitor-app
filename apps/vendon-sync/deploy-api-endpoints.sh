#!/bin/bash
# Deploy Vendon API endpoints to the existing API service
# This script updates the API service with the new Vendon endpoints

set -e

echo "🚀 Deploying Vendon API endpoints..."

# Step 1: Create ConfigMap with updated API code
echo "📦 Step 1: Creating ConfigMap with updated API code..."
kubectl create configmap people-api-code-updated \
  --from-file=api_service.py=../people-analytics-sync/api_service.py \
  --from-file=models.py=../people-analytics-sync/models.py \
  -n leet-monitor --dry-run=client -o yaml | kubectl apply -f -

echo "✅ ConfigMap created"

# Step 2: Restart deployment to pick up changes
echo ""
echo "🔄 Step 2: Restarting API deployment..."
kubectl rollout restart deployment people-analytics-api -n leet-monitor

echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment people-analytics-api -n leet-monitor --timeout=120s

echo ""
echo "✅ Deployment restarted"

# Step 3: Verify endpoints
echo ""
echo "🧪 Step 3: Testing endpoints..."
sleep 5

echo "Testing /api/vendon-sales/lowest-yesterday..."
curl -s "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday" | head -20

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Note: If endpoints return 404, the Docker image needs to be rebuilt with the updated code."
echo "The ConfigMap approach above is for quick testing. For production, rebuild the image:"
echo "  cd people-analytics-sync"
echo "  docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest ."
echo "  docker push programmeradmin25/people-analytics-sync:api-latest"


