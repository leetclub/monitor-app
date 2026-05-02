#!/usr/bin/env bash
# Adds flask-secret-key to people-analytics-secrets (stable Flask sessions). Run from WSL.
set -euo pipefail
NS="${NS:-leet-monitor}"
FLASK=$(openssl rand -hex 32)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
printf '%s' "{\"stringData\":{\"flask-secret-key\":\"$FLASK\"}}" >"$TMP"
kubectl patch secret people-analytics-secrets -n "$NS" --type merge --patch-file "$TMP"
echo "patched people-analytics-secrets with flask-secret-key in $NS"
