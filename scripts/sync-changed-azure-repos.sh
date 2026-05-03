#!/usr/bin/env bash
# Run sync-to-azure-dev.sh for every mapped product folder that has commits
# not yet in origin/main (merge-base..HEAD). Run before `git push origin`.
#
# Usage (repo root): bash scripts/sync-changed-azure-repos.sh
# Optional: AZURE_SYNC_UPSTREAM=origin/main (default)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UPSTREAM="${AZURE_SYNC_UPSTREAM:-origin/main}"
if ! git rev-parse -q --verify "$UPSTREAM" >/dev/null 2>&1; then
  echo "Ref $UPSTREAM not found. Try: git fetch origin" >&2
  exit 1
fi

base="$(git merge-base "$UPSTREAM" HEAD)"
files="$(git diff --name-only "$base" HEAD || true)"

SYNC_ALERT=0
SYNC_V2=0
SYNC_PEOPLE=0

while IFS= read -r line || [[ -n "${line:-}" ]]; do
  [[ -z "${line// }" ]] && continue
  case "$line" in
    apps/alert-theleetclub-com/*) SYNC_ALERT=1 ;;
    monitoring-app-v2/*) SYNC_V2=1 ;;
    people-analytics-sync/*) SYNC_PEOPLE=1 ;;
  esac
done <<< "$(printf '%s\n' "$files")"

if [[ "$SYNC_ALERT" -eq 0 && "$SYNC_V2" -eq 0 && "$SYNC_PEOPLE" -eq 0 ]]; then
  echo "No commits under alert, monitoring-app-v2, or people-analytics-sync since merge-base with $UPSTREAM — skipping Azure product sync(s)."
  exit 0
fi

run_sync() {
  bash "${ROOT}/scripts/sync-to-azure-dev.sh" "$@"
}

if [[ "$SYNC_ALERT" -eq 1 ]]; then
  echo "=== Azure sync: alert (apps/alert-theleetclub-com) ==="
  run_sync alert apps/alert-theleetclub-com
fi
if [[ "$SYNC_V2" -eq 1 ]]; then
  echo "=== Azure sync: monitoring-app-v2 ==="
  run_sync monitoring-app-v2 monitoring-app-v2
fi
if [[ "$SYNC_PEOPLE" -eq 1 ]]; then
  echo "=== Azure sync: people-analytics-sync ==="
  run_sync people-analytics-sync people-analytics-sync
fi

echo "Done: Azure dev mirror(s) for all changed product path(s)."
