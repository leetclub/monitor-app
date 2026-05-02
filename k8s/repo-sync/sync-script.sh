#!/bin/sh
# Syncs GitHub repos to Azure DevOps per mapping file.
# Env: GITHUB_TOKEN, AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG
# Mapping file: two columns per line: "github_org/repo_name" "AzureProjectName"

set -e
CLONE_ROOT="${CLONE_ROOT:-/sync/repos}"
MAPPING_FILE="${MAPPING_FILE:-/config/repo-mapping.txt}"

if [ -z "$GITHUB_TOKEN" ] || [ -z "$AZURE_DEVOPS_PAT" ] || [ -z "$AZURE_DEVOPS_ORG" ]; then
  echo "Missing required env: GITHUB_TOKEN, AZURE_DEVOPS_PAT, AZURE_DEVOPS_ORG"
  exit 1
fi

if [ ! -f "$MAPPING_FILE" ]; then
  echo "Mapping file not found: $MAPPING_FILE"
  exit 1
fi

mkdir -p "$CLONE_ROOT"
cd "$CLONE_ROOT"

while IFS= read -r line || [ -n "$line" ]; do
  line=$(echo "$line" | sed 's/#.*//' | tr -s ' \t' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -z "$line" ] && continue

  github_slug=$(echo "$line" | awk '{print $1}')
  rest=$(echo "$line" | awk '{$1=""; sub(/^[ \t]+/,""); print $0}')
  [ -z "$github_slug" ] || [ -z "$rest" ] && continue
  # Optional: "ProjectName | AzureRepoName" (pipe with spaces); else azure_repo = GitHub repo name
  if echo "$rest" | grep -q ' | '; then
    azure_project=$(echo "$rest" | sed 's/ | .*$//' | sed 's/[[:space:]]*$//')
    azure_repo=$(echo "$rest" | sed 's/^.* | //' | sed 's/^[[:space:]]*//')
  else
    azure_project="$rest"
    azure_repo=$(echo "$github_slug" | sed 's|.*/||')
  fi
  [ -z "$azure_project" ] && continue
  [ -z "$azure_repo" ] && azure_repo=$(echo "$github_slug" | sed 's|.*/||')

  repo_name=$(echo "$github_slug" | sed 's|.*/||')
  github_url="https://${GITHUB_TOKEN}@github.com/${github_slug}.git"
  azure_project_encoded=$(echo "$azure_project" | sed 's/ /%20/g')
  azure_repo_encoded=$(echo "$azure_repo" | sed 's/ /%20/g')
  azure_url="https://${AZURE_DEVOPS_PAT}@dev.azure.com/${AZURE_DEVOPS_ORG}/${azure_project_encoded}/_git/${azure_repo_encoded}"

  echo "--- $github_slug -> $azure_project / $azure_repo ---"

  if [ -d "$repo_name/.git" ]; then
    (cd "$repo_name" && git fetch origin --prune)
  else
    # Clone all branches (default clone fetches all refs; we need them for push)
    if ! git clone "$github_url" "$repo_name"; then
      echo "Clone failed: $github_slug"
      continue
    fi
  fi

  (cd "$repo_name" && \
    git remote add azure "$azure_url" 2>/dev/null || git remote set-url azure "$azure_url")
  # Push ALL branches (refs/remotes/origin/* -> azure refs/heads/*) and all tags; GitHub is source of truth
  if (cd "$repo_name" && git push azure '+refs/remotes/origin/*:refs/heads/*' --force && git push azure '+refs/tags/*:refs/tags/*' --force); then
    echo "Synced: $repo_name"
  else
    echo "Push to Azure FAILED: $repo_name (check: repo exists in project? PAT has Code write?)"
  fi
done < "$MAPPING_FILE"

echo "Sync finished."
