#!/usr/bin/env bash
set -euo pipefail
POD="$(kubectl -n leet-monitor get pods -l app=people-analytics-api -o jsonpath='{.items[0].metadata.name}')"
kubectl -n leet-monitor cp "$(dirname "$0")/test_dashboard_resolve_local.py" "$POD:/tmp/t.py"
kubectl -n leet-monitor exec "$POD" -- python3 /tmp/t.py
