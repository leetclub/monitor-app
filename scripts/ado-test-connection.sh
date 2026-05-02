#!/usr/bin/env bash
# Test Azure DevOps PAT from azure.txt (line 2). Prints HTTP status only.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/ado-curl-auth.sh"
CODE="$(curl -sS -o /tmp/ado_projects.json -w "%{http_code}" \
  -H "Authorization: Basic ${ADO_BASIC_B64}" \
  "https://dev.azure.com/leetclub/_apis/projects?api-version=7.0")"
echo "projects HTTP ${CODE}"
if [[ "${CODE}" != "200" ]]; then
  head -c 500 /tmp/ado_projects.json >&2 || true
  exit 1
fi
echo "OK"
