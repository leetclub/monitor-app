#!/usr/bin/env bash
# Usage: ado-repo-has-yaml.sh <repo-id> <branch-name>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/ado-curl-auth.sh"
REPO_ID="${1:?repo id}"
BRANCH="${2:?branch}"
# scopePath must include leading slash per API
curl -sS -w "\nHTTP:%{http_code}\n" \
  -H "Authorization: Basic ${ADO_BASIC_B64}" \
  "https://dev.azure.com/leetclub/Leet%20Monitor/_apis/git/repositories/${REPO_ID}/items?path=/azure-pipelines.yml&resolveLfs=true&api-version=7.0&versionDescriptor.version=${BRANCH}&versionDescriptor.versionType=branch"
