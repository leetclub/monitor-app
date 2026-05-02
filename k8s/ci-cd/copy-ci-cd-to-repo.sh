#!/bin/bash
# Copies CI/CD files from this repo (monitoring-app) into your target app repo.
# Usage: ./copy-ci-cd-to-repo.sh /path/to/your/repo
# Example: ./copy-ci-cd-to-repo.sh ../Leet Monitor

set -e
TARGET="${1:?Usage: $0 /path/to/target/repo}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$TARGET/k8s/ci-cd"

# Copy template + version script + example (keep same layout under k8s/ci-cd/)
cp "$SCRIPT_DIR/get-version.sh" "$TARGET/k8s/ci-cd/"
cp "$SCRIPT_DIR/azure-pipelines.build-deploy.yml" "$TARGET/k8s/ci-cd/"
cp "$SCRIPT_DIR/example-one-repo-azure-pipelines.yml" "$TARGET/k8s/ci-cd/"
cp "$SCRIPT_DIR/README.md" "$TARGET/k8s/ci-cd/"

# Copy example to repo root as azure-pipelines.yml (they still need to edit parameters)
cp "$SCRIPT_DIR/example-one-repo-azure-pipelines.yml" "$TARGET/azure-pipelines.yml"

echo "Done. Copied to $TARGET:"
echo "  k8s/ci-cd/get-version.sh"
echo "  k8s/ci-cd/azure-pipelines.build-deploy.yml"
echo "  k8s/ci-cd/example-one-repo-azure-pipelines.yml"
echo "  k8s/ci-cd/README.md"
echo "  azure-pipelines.yml  (from example; edit parameters: imageName, k8sDeployment, approvalNotifyUsers)"
echo ""
echo "Next: cd to target repo, edit azure-pipelines.yml parameters, then add pipeline in Azure DevOps."
