#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/ado-curl-auth.sh"
curl -sS \
  -H "Authorization: Basic ${ADO_BASIC_B64}" \
  "https://dev.azure.com/leetclub/Leet%20Monitor/_apis/pipelines?api-version=7.1-preview.1"
