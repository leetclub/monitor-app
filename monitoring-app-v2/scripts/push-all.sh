#!/usr/bin/env bash
# Push main to GitHub (origin) and Azure DevOps (azure). Requires auth for each host.
set -euo pipefail
cd "$(dirname "$0")/.."
git push -u origin main
git push -u azure main
echo "Done. For tags or branches later: git push azure --all && git push azure --tags"
