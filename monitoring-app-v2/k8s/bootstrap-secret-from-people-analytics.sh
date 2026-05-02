#!/usr/bin/env bash
# Creates/updates monitoring-app-v2-secrets from keys already stored in people-analytics-secrets.
# Run in WSL with KUBECONFIG set. Does not read local env files (use apply-secret-from-env.sh for that).
set -euo pipefail
NS="${NS:-leet-monitor}"
SRC="${SRC:-people-analytics-secrets}"
TGT="${TGT:-monitoring-app-v2-secrets}"

decode() {
  kubectl get secret "$SRC" -n "$NS" -o "jsonpath={.data.$1}" | base64 -d
}

API_KEY="$(decode vendon-api-key)"
DASHBOARD_ACCESS_API_KEY="$(decode dashboard-access-api-key)"
VIDEOLOFT_EMAIL="$(decode videoloft-email)"
VIDEOLOFT_PASSWORD="$(decode videoloft-password)"

kubectl create secret generic "$TGT" \
  --namespace="$NS" \
  --from-literal=API_KEY="$API_KEY" \
  --from-literal=DASHBOARD_ACCESS_API_KEY="$DASHBOARD_ACCESS_API_KEY" \
  --from-literal=VIDEOLOFT_EMAIL="$VIDEOLOFT_EMAIL" \
  --from-literal=VIDEOLOFT_PASSWORD="$VIDEOLOFT_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applied $TGT (API_KEY, DASHBOARD_ACCESS_API_KEY, VIDEOLOFT_* from $SRC)."
echo "Add Slack/Vendon login/SafetyCulture etc. via k8s/.secret.env + apply-secret-from-env.sh if needed."
