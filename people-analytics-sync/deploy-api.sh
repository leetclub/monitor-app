#!/usr/bin/env bash
# Build API image, push to Docker Hub, restart k8s deployment.
# Prerequisites: docker login, kubectl context for your cluster, secret people-analytics-secrets with dashboard-access-api-key.
set -euo pipefail
IMAGE="${IMAGE:-programmeradmin25/people-analytics-sync:api-latest}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
echo "Building $IMAGE ..."
docker build -f Dockerfile.api -t "$IMAGE" .
echo "Pushing $IMAGE ..."
docker push "$IMAGE"
echo "Restarting deployment..."
kubectl -n leet-monitor rollout restart deployment/people-analytics-api
kubectl -n leet-monitor rollout status deployment/people-analytics-api --timeout=120s
echo "Done."
