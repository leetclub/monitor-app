#!/usr/bin/env bash
# Helper: load Azure DevOps PAT from repo-root azure.txt (token on line 2).
# Usage: source scripts/ado-curl-auth.sh   → sets ADO_BASIC_B64 for curl -H "Authorization: Basic $ADO_BASIC_B64"
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAT_FILE="${ROOT}/azure.txt"
if [[ ! -f "$PAT_FILE" ]]; then
  echo "Missing ${PAT_FILE}" >&2
  return 1 2>/dev/null || exit 1
fi
TOKEN="$(sed -n '2p' "$PAT_FILE" | tr -d '\r\n')"
if [[ -z "$TOKEN" ]]; then
  echo "Empty PAT on line 2 of azure.txt" >&2
  return 1 2>/dev/null || exit 1
fi
if command -v base64 >/dev/null 2>&1; then
  ADO_BASIC_B64="$(printf ':%s' "$TOKEN" | base64 -w0 2>/dev/null || printf ':%s' "$TOKEN" | base64)"
else
  echo "base64 required" >&2
  return 1 2>/dev/null || exit 1
fi
