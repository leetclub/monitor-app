#!/usr/bin/env sh
# Run from repo root:  bash k8s/repo-sync/commit-to-git.sh
# Commits only .gitignore and k8s/repo-sync/ (avoid mixing with other WIP).
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
git add .gitignore k8s/repo-sync/
git status
git commit -m "Track k8s repo-sync and update GitHub to Azure mapping"
echo "Now: git push"
