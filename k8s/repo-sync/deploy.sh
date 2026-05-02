#!/bin/sh
# Run from k8s/repo-sync (or pass path to repo-mapping.yaml).
# Requires: kubectl, namespace repo-sync-temp
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Creating namespace..."
kubectl apply -f namespace.yaml

echo "Creating mapping ConfigMap from repo-mapping.yaml..."
kubectl create configmap repo-sync-mapping \
  --from-file=repo-mapping.txt=repo-mapping.yaml \
  -n repo-sync-temp \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying script ConfigMap and CronJob..."
kubectl apply -f configmap-script.yaml -f cronjob.yaml

echo "Applying secret (from secret.example.yaml - ensure it has real tokens)..."
kubectl apply -f secret.example.yaml

echo "Deploy done. Triggering one-off job to verify..."
kubectl create job --from=cronjob/repo-sync-github-to-azure manual-sync-1 -n repo-sync-temp 2>/dev/null || true

echo "Wait ~30s then check logs:"
echo "  kubectl get jobs -n repo-sync-temp"
echo "  kubectl logs job/manual-sync-1 -n repo-sync-temp -f"
