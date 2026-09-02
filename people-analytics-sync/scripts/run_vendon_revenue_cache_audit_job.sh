#!/usr/bin/env bash
# Launch full revenue-cache vs Vendon audit Job (all cache days through yesterday + --fix).
set -euo pipefail
export KUBECONFIG="${KUBECONFIG:-/mnt/c/Users/mahdi/OneDrive/theleetclub/k8s-1-31-1-do-5-nyc1-1737653282089-kubeconfig.yaml}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS=leet-monitor
YEST=$(TZ=Asia/Kuwait date -d yesterday +%Y-%m-%d)

kubectl -n "$NS" delete job vendon-revenue-cache-audit --ignore-not-found
kubectl -n "$NS" delete configmap vendon-revenue-cache-audit-script --ignore-not-found

kubectl -n "$NS" create configmap vendon-revenue-cache-audit-script \
  --from-file=audit_vendon_revenue_cache.py="$ROOT/people-analytics-sync/scripts/audit_vendon_revenue_cache.py"

# Patch AUDIT_TO into a generated job manifest
tmp=$(mktemp)
sed "s/AUDIT_FROM\\n              value: \"2025-01-01\"/AUDIT_FROM\\n              value: \"2025-01-01\"/" \
  "$ROOT/people-analytics-sync/k8s/vendon-revenue-cache-audit-job.yaml" > "$tmp"
# Inject AUDIT_TO env after AUDIT_FROM block via a small python rewrite
python3 - <<PY
from pathlib import Path
p = Path("$ROOT/people-analytics-sync/k8s/vendon-revenue-cache-audit-job.yaml")
text = p.read_text(encoding="utf-8")
needle = '            - name: AUDIT_FROM\n              value: "2025-01-01"\n'
insert = needle + f'            - name: AUDIT_TO\n              value: "$YEST"\n'
if needle not in text:
    raise SystemExit("AUDIT_FROM block not found")
Path("$tmp").write_text(text.replace(needle, insert, 1), encoding="utf-8")
print("AUDIT_TO=$YEST")
PY

kubectl apply -f "$tmp"
rm -f "$tmp"
echo "Job started. Follow logs:"
echo "  kubectl -n $NS logs -l job=vendon-revenue-cache-audit -f"
kubectl -n "$NS" get job vendon-revenue-cache-audit
kubectl -n "$NS" get pods -l job=vendon-revenue-cache-audit -o wide
