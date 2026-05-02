#!/bin/sh
set -e
# Public runtime config only — never put API keys or tokens here (they would be visible to browsers).
JSON="$(jq -n \
  --arg MONITORING_API_URL "${MONITORING_API_URL:-}" \
  --arg USE_MOCK_ACCESS "${USE_MOCK_ACCESS:-false}" \
  --arg USE_MOCK_RED_ALERT "${USE_MOCK_RED_ALERT:-false}" \
  --arg VITE_MOCK_ALLOWED_TABS "${VITE_MOCK_ALLOWED_TABS:-}" \
  --arg VITE_DEV_USER_EMAIL "${VITE_DEV_USER_EMAIL:-}" \
  --arg ACCESS_ALLOWED_DOMAIN "${ACCESS_ALLOWED_DOMAIN:-}" \
  --arg ACCESS_TEST_MODE "${ACCESS_TEST_MODE:-false}" \
  --arg GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}" \
  '{
    MONITORING_API_URL: (if $MONITORING_API_URL == "" then null else $MONITORING_API_URL end),
    USE_MOCK_ACCESS: $USE_MOCK_ACCESS,
    USE_MOCK_RED_ALERT: $USE_MOCK_RED_ALERT,
    VITE_MOCK_ALLOWED_TABS: (if $VITE_MOCK_ALLOWED_TABS == "" then null else $VITE_MOCK_ALLOWED_TABS end),
    VITE_DEV_USER_EMAIL: (if $VITE_DEV_USER_EMAIL == "" then null else $VITE_DEV_USER_EMAIL end),
    ACCESS_ALLOWED_DOMAIN: (if $ACCESS_ALLOWED_DOMAIN == "" then null else $ACCESS_ALLOWED_DOMAIN end),
    ACCESS_TEST_MODE: $ACCESS_TEST_MODE,
    GOOGLE_CLIENT_ID: (if $GOOGLE_CLIENT_ID == "" then null else $GOOGLE_CLIENT_ID end)
  }')"
printf 'window.__MONITORING_ENV__ = %s;\n' "$JSON" > /usr/share/nginx/html/config.js
chown nginx:nginx /usr/share/nginx/html/config.js
exec su-exec nginx "$@"
