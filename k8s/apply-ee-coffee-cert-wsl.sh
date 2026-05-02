#!/usr/bin/env bash
# Use existing key from cluster + new cert from Downloads. Run in WSL.
set -e
DOWNLOADS="${DOWNLOADS:-/mnt/c/Users/$USER/Downloads}"
EC_DIR="$DOWNLOADS/_.ee-coffee.com"
EC_CRT="$EC_DIR/22321af72295307a.crt"
EC_BUNDLE="$EC_DIR/gd_bundle-g2.crt"
NAMESPACES="default ee-test ee ingress-nginx leet-monitor"

# Get current key from cluster (pick first namespace that has the secret)
for ns in ee ingress-nginx default; do
  if kubectl get secret ee-coffee-tls -n "$ns" &>/dev/null; then
    echo "Using key from secret ee-coffee-tls in namespace $ns"
    kubectl get secret ee-coffee-tls -n "$ns" -o json | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
key_b64 = d['data'].get('tls.key')
if not key_b64:
    for k in d['data']:
        if 'key' in k: key_b64 = d['data'][k]; break
sys.stdout.buffer.write(base64.b64decode(key_b64))
" > /tmp/ec-key.pem
    break
  fi
done

if ! test -s /tmp/ec-key.pem || ! openssl pkey -in /tmp/ec-key.pem -check -noout 2>/dev/null; then
  echo "Could not get valid key from cluster. Add .key file to $EC_DIR and run update-wildcard-certs.sh"
  exit 1
fi

cat "$EC_CRT" "$EC_BUNDLE" > /tmp/ec-chain.crt

for ns in $NAMESPACES; do
  if kubectl get namespace "$ns" &>/dev/null; then
    if kubectl create secret tls ee-coffee-tls --cert=/tmp/ec-chain.crt --key=/tmp/ec-key.pem -n "$ns" --dry-run=client -o yaml | kubectl apply -f - 2>/dev/null; then
      echo "Updated ee-coffee-tls in $ns"
    else
      echo "Skip or failed: $ns"
    fi
  fi
done
rm -f /tmp/ec-key.pem /tmp/ec-chain.crt
echo "Done."
