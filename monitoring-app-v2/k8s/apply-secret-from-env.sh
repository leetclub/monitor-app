#!/usr/bin/env bash
# Usage: ./apply-secret-from-env.sh [path-to-env-file]
# Default: ./.secret.env (gitignored). File format: KEY=value per line, no export keyword.
set -euo pipefail
NS="${NS:-leet-monitor}"
NAME="${NAME:-monitoring-app-v2-secrets}"
ENV_FILE="${1:-$(dirname "$0")/.secret.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy k8s/secret.env.example and fill values." >&2
  exit 1
fi
kubectl create secret generic "$NAME" \
  --namespace="$NS" \
  --from-env-file="$ENV_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
echo "Secret $NAME applied in $NS"
