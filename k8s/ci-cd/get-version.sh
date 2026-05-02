#!/bin/sh
# Outputs a version string for CI/CD.
# Usage: get-version.sh [BUILD_ID]
# Env (optional): GIT_TAG (e.g. v1.2.3), BUILD_ID (number), GIT_DESCRIBE (from git describe).
# If GIT_TAG is set and looks like v* semver, use it (strip 'v'). Else use 1.0.0-YYYYMMDD.BUILD_ID.

set -e
BUILD_ID="${1:-${BUILD_ID:-0}}"
DATE="${DATE:-$(date +%Y%m%d)}"

if [ -n "$GIT_TAG" ] && echo "$GIT_TAG" | grep -qE '^v?[0-9]+\.[0-9]+\.[0-9]+'; then
  # Use tag: v1.2.3 -> 1.2.3 (strip leading v)
  echo "$GIT_TAG" | sed 's/^v//'
  exit 0
fi

if [ -n "$GIT_DESCRIBE" ] && echo "$GIT_DESCRIBE" | grep -qE '^v?[0-9]+\.[0-9]+\.[0-9]+'; then
  # Use describe (e.g. v1.2.3-0-gabc1234) -> 1.2.3-0-gabc1234 or just 1.2.3
  echo "$GIT_DESCRIBE" | sed 's/^v//' | cut -d'-' -f1
  exit 0
fi

# No tag: use date and build id
echo "1.0.0-${DATE}.${BUILD_ID}"
