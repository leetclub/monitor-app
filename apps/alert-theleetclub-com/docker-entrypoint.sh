#!/bin/sh
set -e

# Public runtime config only — never put API keys or tokens here (they would be visible to browsers).
JSON="$(jq -n \
  --arg ALERT_API_URL "${ALERT_API_URL:-}" \
  --arg GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}" \
  --arg MONITOR_APP_URL "${MONITOR_APP_URL:-}" \
  '{
    ALERT_API_URL: (if $ALERT_API_URL == "" then null else $ALERT_API_URL end),
    GOOGLE_CLIENT_ID: (if $GOOGLE_CLIENT_ID == "" then null else $GOOGLE_CLIENT_ID end),
    MONITOR_APP_URL: (if $MONITOR_APP_URL == "" then null else $MONITOR_APP_URL end)
  }')"

printf 'window.__ALERT_ENV__ = %s;\n' "$JSON" > /usr/share/nginx/html/config.js
chown nginx:nginx /usr/share/nginx/html/config.js
exec su-exec nginx "$@"

