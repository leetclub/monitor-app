#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
{
  printf '%s\n' \
    '# Sync script - keep in sync with sync-script.sh' \
    '# Regenerate: ./build-configmap-script-yaml.sh' \
    'apiVersion: v1' \
    'kind: ConfigMap' \
    'metadata:' \
    '  name: repo-sync-script' \
    '  namespace: repo-sync-temp' \
    'data:' \
    '  sync-script.sh: |'
  sed 's/^/    /' sync-script.sh
} > configmap-script.yaml
