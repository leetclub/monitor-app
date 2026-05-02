#!/bin/bash
set -euo pipefail

echo "🔨 Building and pushing Docker images for Historical Performance Sync..."

# Build sync service image
echo ""
echo "📦 Building sync service image..."
docker build -f Dockerfile -t programmeradmin25/historical-performance-sync:latest .

# Build API service image
echo ""
echo "📦 Building API service image..."
docker build -f Dockerfile.api -t programmeradmin25/historical-performance-api:latest .

# Push images
echo ""
echo "🚀 Pushing images to Docker Hub..."
docker push programmeradmin25/historical-performance-sync:latest
docker push programmeradmin25/historical-performance-api:latest

echo ""
echo "✅ Images built and pushed successfully!"
echo ""
echo "The Kubernetes deployments will automatically pull the new images (imagePullPolicy: Always)"

