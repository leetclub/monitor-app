#!/bin/sh
set -e

# Public runtime config only — never put API keys or tokens here (they would be visible to browsers).
JSON="$(jq -n \
  --arg ALERT_API_URL "${ALERT_API_URL:-}" \
  --arg GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}" \
  --arg MONITOR_APP_URL "${MONITOR_APP_URL:-}" \
  --arg SLACK_TEAM_ID "${SLACK_TEAM_ID:-}" \
  --arg SLACK_AM_AHMED_USER_ID "${SLACK_AM_AHMED_USER_ID:-}" \
  --arg SLACK_AM_SUHAIB_USER_ID "${SLACK_AM_SUHAIB_USER_ID:-}" \
  --arg SLACK_OP_EMAIL_MAP_JSON "${SLACK_OP_EMAIL_MAP_JSON:-}" \
  '{
    ALERT_API_URL: (if $ALERT_API_URL == "" then null else $ALERT_API_URL end),
    GOOGLE_CLIENT_ID: (if $GOOGLE_CLIENT_ID == "" then null else $GOOGLE_CLIENT_ID end),
    MONITOR_APP_URL: (if $MONITOR_APP_URL == "" then null else $MONITOR_APP_URL end),
    SLACK_TEAM_ID: (if $SLACK_TEAM_ID == "" then null else $SLACK_TEAM_ID end),
    SLACK_AM_AHMED_USER_ID: (if $SLACK_AM_AHMED_USER_ID == "" then null else $SLACK_AM_AHMED_USER_ID end),
    SLACK_AM_SUHAIB_USER_ID: (if $SLACK_AM_SUHAIB_USER_ID == "" then null else $SLACK_AM_SUHAIB_USER_ID end),
    SLACK_OP_EMAIL_MAP_JSON: (if $SLACK_OP_EMAIL_MAP_JSON == "" then null else $SLACK_OP_EMAIL_MAP_JSON end)
  }')"

printf 'window.__ALERT_ENV__ = %s;\n' "$JSON" > /usr/share/nginx/html/config.js
chown nginx:nginx /usr/share/nginx/html/config.js
exec su-exec nginx "$@"

