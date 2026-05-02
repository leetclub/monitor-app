#!/usr/bin/env bash
# Use existing key from cluster + new cert from Downloads. Run in WSL.
set -e
DOWNLOADS="${DOWNLOADS:-/mnt/c/Users/$USER/Downloads}"
TC_DIR="$DOWNLOADS/_.theleetclub.com"
TC_CRT="$TC_DIR/625ba359f4400ee.crt"
TC_BUNDLE="$TC_DIR/gd_bundle-g2.crt"

# Get current key from cluster (same key may work if cert was reissued for same CSR)
kubectl get secret theleetclub-tls -n leet-monitor -o json | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
key_b64 = d['data'].get('tls.key')
if not key_b64:
    for k in d['data']:
        if 'key' in k: key_b64 = d['data'][k]; break
sys.stdout.buffer.write(base64.b64decode(key_b64))
" > /tmp/old-key.pem

if ! openssl pkey -in /tmp/old-key.pem -check -noout 2>/dev/null; then
  echo "Could not read key from cluster. Try: kubectl get secret theleetclub-tls -n leet-monitor -o yaml"
  exit 1
fi

# Build new chain
cat "$TC_CRT" "$TC_BUNDLE" > /tmp/new-chain.crt

# Update secret in all namespaces that have it (kubectl will reject if cert and key don't match)
echo "Updating theleetclub-tls with new cert + existing key..."
for ns in leet-monitor leet leet-test machinechat machinechat-test nifi superset ingress-nginx; do
  if kubectl get namespace "$ns" &>/dev/null && kubectl get secret theleetclub-tls -n "$ns" &>/dev/null; then
    if kubectl create secret tls theleetclub-tls --cert=/tmp/new-chain.crt --key=/tmp/old-key.pem -n "$ns" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null; then
      echo "Updated theleetclub-tls in $ns"
    fi
  fi
done
rm -f /tmp/old-key.pem /tmp/new-chain.crt
echo "Done."
