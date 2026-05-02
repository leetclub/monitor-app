#!/usr/bin/env bash
set -euo pipefail
export KUBECONFIG="${KUBECONFIG:-/mnt/c/Users/mahdi/OneDrive/theleetclub/k8s-1-31-1-do-5-nyc1-1737653282089-kubeconfig.yaml}"
POD="$(kubectl get pods -n leet-monitor -l app=people-analytics-api -o jsonpath='{.items[0].metadata.name}')"
echo "Using pod: $POD"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
kubectl cp "${SCRIPT_DIR}/apply_red_alert_columns_k8s.py" "leet-monitor/${POD}:/tmp/apply_red_alert_columns_k8s.py"
kubectl exec -n leet-monitor "$POD" -- python /tmp/apply_red_alert_columns_k8s.py
