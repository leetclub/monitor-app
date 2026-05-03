#!/usr/bin/env bash
# Push monorepo folders to separate Azure DevOps repos (pipelines live there).
#
# Auth: set AZURE_DEVOPS_PAT, OR put PAT in repo-root azure.txt under:
#   azuredevops:
#   <paste PAT on next line>
# (azure.txt is gitignored — never commit it.)
#
# Usage:
#   bash scripts/push-to-azure-repos.sh [alert|v2|people|all]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ADO_ALERT='https://dev.azure.com/leetclub/Leet%20Monitor/_git/alert'
ADO_V2='https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitoring-app-v2'
ADO_PEOPLE='https://dev.azure.com/leetclub/Leet%20Monitor/_git/people-analytics-sync'

REMOTE_ALERT="${REMOTE_ALERT:-ado-alert}"
REMOTE_V2="${REMOTE_V2:-ado-v2}"
REMOTE_PEOPLE="${REMOTE_PEOPLE:-ado-people}"

# Azure Pipelines trigger on branch `dev` only (see each app's azure-pipelines.yml).
TARGET_BRANCH="${AZURE_GIT_BRANCH:-dev}"

load_ado_pat() {
  if [[ -n "${AZURE_DEVOPS_PAT:-}" ]]; then
    return 0
  fi
  local f="$ROOT/azure.txt"
  if [[ ! -f "$f" ]]; then
    echo "Missing AZURE_DEVOPS_PAT env or azure.txt at repo root." >&2
    exit 1
  fi
  AZURE_DEVOPS_PAT="$(awk '/^azuredevops:/{getline; gsub(/^[ \t]+|[ \t]+$/, ""); print; exit}' "$f")"
  if [[ -z "${AZURE_DEVOPS_PAT}" ]]; then
    echo "Could not parse PAT under azuredevops: in azure.txt" >&2
    exit 1
  fi
}

# Git HTTPS PAT auth for dev.azure.com (PAT as password, ':' prefix per Azure docs).
git_azure() {
  load_ado_pat
  local hdr
  hdr="Authorization: Basic $(printf ':%s' "${AZURE_DEVOPS_PAT}" | base64 -w0 2>/dev/null || printf ':%s' "${AZURE_DEVOPS_PAT}" | base64 | tr -d '\n')"
  git -c "http.https://dev.azure.com/.extraHeader=${hdr}" "$@"
}

ensure_remote() {
  local name="$1" url="$2"
  if git remote get-url "$name" &>/dev/null; then
    local current
    current="$(git remote get-url "$name")"
    if [[ "$current" != "$url" ]]; then
      echo "Remote $name exists with different URL; fix: git remote set-url $name $url" >&2
      exit 1
    fi
    return 0
  fi
  echo "Adding git remote $name -> $url"
  git remote add "$name" "$url"
}

push_one() {
  local prefix="$1" remote="$2"
  echo "=== subtree push: $prefix -> $remote (branch ${TARGET_BRANCH}) ==="
  git_azure subtree push --prefix="$prefix" "$remote" "$TARGET_BRANCH"
}

TARGET="${1:-all}"
case "$TARGET" in
alert)
  ensure_remote "$REMOTE_ALERT" "$ADO_ALERT"
  push_one apps/alert-theleetclub-com "$REMOTE_ALERT"
  ;;
v2)
  ensure_remote "$REMOTE_V2" "$ADO_V2"
  push_one monitoring-app-v2 "$REMOTE_V2"
  ;;
people)
  ensure_remote "$REMOTE_PEOPLE" "$ADO_PEOPLE"
  push_one people-analytics-sync "$REMOTE_PEOPLE"
  ;;
all)
  ensure_remote "$REMOTE_ALERT" "$ADO_ALERT"
  ensure_remote "$REMOTE_V2" "$ADO_V2"
  ensure_remote "$REMOTE_PEOPLE" "$ADO_PEOPLE"
  push_one apps/alert-theleetclub-com "$REMOTE_ALERT"
  push_one monitoring-app-v2 "$REMOTE_V2"
  push_one people-analytics-sync "$REMOTE_PEOPLE"
  ;;
*)
  echo "Usage: $0 [alert|v2|people|all]" >&2
  exit 1
  ;;
esac

echo "Done."
