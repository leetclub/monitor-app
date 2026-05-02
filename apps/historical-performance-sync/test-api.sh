#!/bin/bash
set -euo pipefail

echo "🧪 Testing Historical Performance API..."

# Test health endpoint
echo ""
echo "1. Testing health endpoint..."
POD_NAME=$(kubectl get pods -n leet-monitor -l app=historical-performance-api -o jsonpath='{.items[0].metadata.name}')
if [ -n "$POD_NAME" ]; then
    kubectl exec -n leet-monitor "$POD_NAME" -- curl -s http://localhost:5002/health
    echo ""
else
    echo "❌ No API pods found"
fi

# Test best-yesterday endpoint
echo ""
echo "2. Testing best-yesterday endpoint..."
curl -s "https://historical-api.theleetclub.com/api/historical-performance/best-yesterday" | head -20
echo ""

echo "✅ API test complete"

