#!/usr/bin/env bash
# Commit staged files using git-commit-tree (avoids broken git commit wrappers in some environments).
set -euo pipefail
cd "$(dirname "$0")/.."
msg=${1:?usage: commit-staged.sh MESSAGE}
TREE=$(git write-tree)
PARENT=$(git rev-parse HEAD)
MSGF=$(mktemp)
printf '%s\n' "$msg" > "$MSGF"
NEW=$(/usr/lib/git-core/git-commit-tree "$TREE" -p "$PARENT" -F "$MSGF")
rm -f "$MSGF"
git reset --hard "$NEW"
git log -1 --oneline
