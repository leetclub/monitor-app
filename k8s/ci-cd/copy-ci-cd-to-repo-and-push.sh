#!/bin/bash
# Clones the target repo, copies CI/CD files into it, commits and pushes.
# Use when you don't have the target repo locally.
#
# Usage: ./copy-ci-cd-to-repo-and-push.sh <repo-url> [branch]
# Example: ./copy-ci-cd-to-repo-and-push.sh https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitor-app main
#
# Private repo (Azure DevOps): put PAT in the URL so clone/push can authenticate:
#   https://anything:YOUR_PAT@dev.azure.com/org/project/_git/repo
# Or clone first and configure git credential helper / SSH.

set -e
REPO_URL="${1:?Usage: $0 <repo-url> [branch]}"
BRANCH="${2:-main}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLONE_DIR=$(mktemp -d)
trap 'rm -rf "$CLONE_DIR"' EXIT

echo "Cloning $REPO_URL (branch: $BRANCH) into $CLONE_DIR ..."
git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$CLONE_DIR"

echo "Copying CI/CD files..."
mkdir -p "$CLONE_DIR/k8s/ci-cd"
cp "$SCRIPT_DIR/get-version.sh" "$CLONE_DIR/k8s/ci-cd/"
cp "$SCRIPT_DIR/azure-pipelines.build-deploy.yml" "$CLONE_DIR/k8s/ci-cd/"
cp "$SCRIPT_DIR/example-one-repo-azure-pipelines.yml" "$CLONE_DIR/k8s/ci-cd/"
cp "$SCRIPT_DIR/README.md" "$CLONE_DIR/k8s/ci-cd/"
cp "$SCRIPT_DIR/example-one-repo-azure-pipelines.yml" "$CLONE_DIR/azure-pipelines.yml"

cd "$CLONE_DIR"
git add k8s/ci-cd/ azure-pipelines.yml
if git diff --staged --quiet; then
  echo "No changes (files already present and identical)."
  exit 0
fi
git commit -m "Add CI/CD: auto-versioning, build, push, deploy-after-approval"
echo "Pushing to $BRANCH ..."
git push origin "$BRANCH"

echo ""
echo "Done. Pushed to $REPO_URL (branch: $BRANCH):"
echo "  k8s/ci-cd/get-version.sh"
echo "  k8s/ci-cd/azure-pipelines.build-deploy.yml"
echo "  k8s/ci-cd/example-one-repo-azure-pipelines.yml"
echo "  k8s/ci-cd/README.md"
echo "  azure-pipelines.yml"
echo ""
echo "Next: In that repo, edit azure-pipelines.yml (imageName, k8sDeployment, approvalNotifyUsers), then create the pipeline in Azure DevOps."
