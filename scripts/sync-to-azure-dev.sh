#!/usr/bin/env bash
# Mirror a monorepo subdirectory into an Azure DevOps repo branch dev (full source, not just YAML).
# Usage: ./scripts/sync-to-azure-dev.sh <ado-repo-slug> <path-under-monorepo-root>
# Example: ./scripts/sync-to-azure-dev.sh monitoring-app-v2 monitoring-app-v2
set -euo pipefail

REPO_SLUG="${1:?repo slug}"
SRC_REL="${2:?source dir relative to monorepo root}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/scripts/ado-curl-auth.sh"

encode_pat() {
  python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}
ENC="$(encode_pat "$ADO_PAT")"
AUTH_URL="https://${ENC}@dev.azure.com/leetclub/Leet%20Monitor/_git/${REPO_SLUG}"

SRC="${ROOT}/${SRC_REL}"
if [[ ! -d "$SRC" ]]; then
  echo "Missing source dir: $SRC" >&2
  exit 1
fi

WORKDIR="$(mktemp -d /tmp/sync-ado-XXXXXX)"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

echo "Cloning ${REPO_SLUG}..."
git clone "${AUTH_URL}" "${WORKDIR}/repo"
cd "${WORKDIR}/repo"

git config user.email "sync@theleetclub.local"
git config user.name "monorepo-sync"

if git ls-remote --heads origin dev | grep -q dev; then
  git fetch origin dev
  git checkout dev
else
  git checkout -b dev
fi

echo "Rsync ${SRC_REL} -> repo (excluding build/vendor dirs)..."
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '__pycache__/' \
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude 'ENV/' \
  --exclude 'env/' \
  --exclude 'dockerhub/' \
  --exclude '.venv-docs/' \
  --exclude '.commitmsg' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'google.creds' \
  "${SRC}/" "${WORKDIR}/repo/"

git add -A
if git diff --cached --quiet; then
  echo "No file changes for ${REPO_SLUG} — already in sync."
  exit 0
fi

BRANCH="$(git branch --show-current)"
TREE="$(git write-tree)"
PARENT="$(git rev-parse HEAD)"
COMMIT="$(git commit-tree "$TREE" -p "$PARENT" -m "sync: mirror monorepo path ${SRC_REL} ($(date -u +%Y-%m-%dT%H:%MZ))")"
git update-ref "refs/heads/${BRANCH}" "$COMMIT"

echo "Pushing dev..."
git push origin dev

echo "Done ${REPO_SLUG}"
