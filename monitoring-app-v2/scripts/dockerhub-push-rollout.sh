#!/usr/bin/env bash
# Run from WSL at repo root: bash scripts/dockerhub-push-rollout.sh
# Requires: ./dockerhub (line 1 ignored; line 2 = Docker Hub PAT), Docker, kubectl + kubeconfig for leet-monitor.
# Use LF line endings (bash under WSL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f dockerhub ]]; then
  echo "Missing ./dockerhub (line 2: Docker Hub PAT for user programmeradmin25)." >&2
  exit 1
fi

PAT="$(sed -n '2p' dockerhub | tr -d '\r\n[:space:]')"
if [[ -z "${PAT}" ]]; then
  echo "Empty PAT on line 2 of dockerhub." >&2
  exit 1
fi

printf '%s' "${PAT}" | docker login -u programmeradmin25 --password-stdin
docker build -t programmeradmin25/monitoring-app-v2:latest .
docker push programmeradmin25/monitoring-app-v2:latest

kubectl apply -f "${ROOT}/k8s/configmap.yaml"
kubectl -n leet-monitor rollout restart deployment/monitoring-app-v2
kubectl -n leet-monitor rollout status deployment/monitoring-app-v2 --timeout=180s

echo "Done: image pushed and deployment restarted."
