#!/usr/bin/env bash
# Update Kubernetes TLS secrets for *.theleetclub.com and *.ee-coffee.com
# Run from repo root. Requires kubectl. Use from WSL if certs are in Windows Downloads.

set -e

DOWNLOADS="${DOWNLOADS:-$HOME/Downloads}"
if [[ -d /mnt/c/Users ]]; then
  DOWNLOADS="${DOWNLOADS:-/mnt/c/Users/$USER/Downloads}"
fi

TC_DIR="${TC_DIR:-$DOWNLOADS/_.theleetclub.com}"
EC_DIR="${EC_DIR:-$DOWNLOADS/_.ee-coffee.com}"
DRY_RUN="${DRY_RUN:-0}"

update_secret() {
  local name="$1" ns="$2" chain="$3" key="$4"
  [[ -f "$chain" ]] || { echo "Chain not found: $chain"; return 1; }
  [[ -f "$key" ]]   || { echo "Key not found: $key"; return 1; }
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY RUN] Would create/update secret $name in namespace $ns"
    return 0
  fi
  kubectl create secret tls "$name" --cert="$chain" --key="$key" -n "$ns" --dry-run=client -o yaml | kubectl apply -f -
  echo "Updated secret $name in $ns"
}

# Private key must be a .key file (GoDaddy .pem in the zip is a cert, not the key)
# Put your key in the cert folder, e.g. theleetclub.key or 625ba359f4400ee.key
TC_KEY=$(find "$TC_DIR" -maxdepth 1 -name "*.key" -print -quit)

# --- *.theleetclub.com ---
TC_CRT=$(find "$TC_DIR" -maxdepth 1 -name "*.crt" ! -name "gd_bundle*" -print -quit)
TC_BUNDLE="$TC_DIR/gd_bundle-g2.crt"

if [[ -n "$TC_CRT" && -f "$TC_BUNDLE" && -n "$TC_KEY" ]]; then
  TC_CHAIN=$(mktemp).crt
  cat "$TC_CRT" "$TC_BUNDLE" > "$TC_CHAIN"
  update_secret "theleetclub-tls" "leet-monitor" "$TC_CHAIN" "$TC_KEY"
  rm -f "$TC_CHAIN"
else
  echo "Warning: theleetclub cert/key not found in $TC_DIR. Need: <id>.crt, gd_bundle-g2.crt, and a .key (private key). Skipping."
fi

EC_KEY=$(find "$EC_DIR" -maxdepth 1 -name "*.key" -print -quit)

# --- *.ee-coffee.com ---
EC_CRT=$(find "$EC_DIR" -maxdepth 1 -name "*.crt" ! -name "gd_bundle*" -print -quit)
EC_BUNDLE="$EC_DIR/gd_bundle-g2.crt"

if [[ -n "$EC_CRT" && -f "$EC_BUNDLE" && -n "$EC_KEY" ]]; then
  EC_CHAIN=$(mktemp).crt
  cat "$EC_CRT" "$EC_BUNDLE" > "$EC_CHAIN"
  update_secret "ee-coffee-tls" "leet-monitor" "$EC_CHAIN" "$EC_KEY"
  rm -f "$EC_CHAIN"
else
  echo "Warning: ee-coffee cert/key not found in $EC_DIR. Need: <id>.crt, gd_bundle-g2.crt, and a .key (private key). Skipping."
fi

echo "Done. Restart ingress controller or wait for it to reload certs if needed."
