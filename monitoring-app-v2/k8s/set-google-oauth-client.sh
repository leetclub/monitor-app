#!/usr/bin/env bash
# Sets the same Google OAuth 2.0 *Web client* ID on the SPA (ConfigMap) and people-api (Secret).
# Get the ID from: Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client.
# Authorized JavaScript origins must include: https://monitor-v2.theleetclub.com (and http://localhost:5173 for dev).
set -euo pipefail
NS="${NS:-leet-monitor}"
CID="${1:-}"
if [[ -z "$CID" || "$CID" == *REPLACE* ]]; then
  echo "Usage: $0 YOUR_NUMERIC_ID.apps.googleusercontent.com" >&2
  echo "Create a Web application OAuth client in Google Cloud Console, then run this with the Client ID." >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf '%s' "{\"stringData\":{\"google-client-id\":\"${CID}\"}}" >"$TMP"
kubectl patch secret people-analytics-secrets -n "$NS" --type merge --patch-file "$TMP"

kubectl patch configmap monitoring-app-v2-public -n "$NS" --type merge -p "{\"data\":{\"GOOGLE_CLIENT_ID\":\"${CID}\"}}"

kubectl rollout restart deployment/people-analytics-api -n "$NS"
kubectl rollout restart deployment/monitoring-app-v2 -n "$NS"

echo "Patched google-client-id + GOOGLE_CLIENT_ID. Wait for rollouts; then hard-refresh the app (Ctrl+Shift+R)."
