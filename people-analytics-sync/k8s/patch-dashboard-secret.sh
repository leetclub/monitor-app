#!/usr/bin/env bash
set -euo pipefail
KEY="$(openssl rand -hex 32)"
B64="$(echo -n "$KEY" | base64 -w0)"
kubectl patch secret people-analytics-secrets -n leet-monitor --type=strategic -p "{\"data\":{\"dashboard-access-api-key\":\"${B64}\"}}"
echo "dashboard-access-api-key set in secret people-analytics-secrets (leet-monitor)."
echo "Retrieve for Apps Script (same value as DASHBOARD_ACCESS_API_KEY):"
echo "  kubectl -n leet-monitor get secret people-analytics-secrets -o jsonpath='{.data.dashboard-access-api-key}' | base64 -d; echo"
