# Azure DevOps CI/CD + repo sync

This repo currently contains multiple deployable components:

- `monitoring-app-v2/` → Docker image `programmeradmin25/monitoring-app-v2:latest` → k8s `deployment/monitoring-app-v2` in namespace `leet-monitor`
- `apps/alert-theleetclub-com/` → Docker image `programmeradmin25/alert-theleetclub-com:latest` → k8s `deployment/alert-app` in namespace `leet-monitor`
- `people-analytics-sync/` (API) → Docker image `programmeradmin25/people-analytics-sync:api-latest` → k8s `deployment/people-analytics-api` in namespace `leet-monitor`

Each component has an `azure-pipelines.yml` that:

1. triggers on `dev`
2. builds + pushes the Docker image to Docker Hub
3. runs `kubectl rollout restart` and verifies the rollout

## Azure DevOps pipeline secret variables (required)

Create these **secret** variables in each Azure DevOps pipeline (or a shared Variable Group):

- `DOCKERHUB_USERNAME`: Docker Hub username
- `DOCKERHUB_TOKEN`: Docker Hub access token (recommended) or password
- `KUBECONFIG_B64`: base64 of the kubeconfig file contents

Example to generate `KUBECONFIG_B64` locally:

```bash
base64 -w0 k8s-1-31-1-do-5-nyc1-1737653282089-kubeconfig.yaml
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("k8s-1-31-1-do-5-nyc1-1737653282089-kubeconfig.yaml"))
```

## Repo sync: monorepo → separate Azure repos

You currently have these Azure repos:

- `monitoring-app-v2`: `https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitoring-app-v2`
- `alert`: `https://dev.azure.com/leetclub/Leet%20Monitor/_git/alert`

Recommended sync approach: **subtree split** from this monorepo and force the Azure repo to represent only that subdirectory.

### monitoring-app-v2 repo

From the monorepo root:

```bash
git remote add azure-monitor-v2 https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitoring-app-v2
git fetch azure-monitor-v2

# Create a synthetic history for just monitoring-app-v2/
git subtree split --prefix=monitoring-app-v2 -b split/monitoring-app-v2

# Push to Azure 'dev' branch (first time use --force to establish history)
git push azure-monitor-v2 split/monitoring-app-v2:dev --force
```

### alert repo

From the monorepo root:

```bash
git remote add azure-alert https://dev.azure.com/leetclub/Leet%20Monitor/_git/alert
git fetch azure-alert

git subtree split --prefix=apps/alert-theleetclub-com -b split/alert
git push azure-alert split/alert:dev --force
```

### Ongoing sync (dev branch only)

After new commits land in this monorepo, rerun the same `git subtree split` + `git push ... :dev`.

If you want this to be fully automated, create a small script (or an Azure pipeline in the monorepo) that performs the split + push using a PAT with repo write permissions.

## Future: dev + prod instances (dev branch → dev, main branch → prod)

When you’re ready:

- Keep `dev` deploying to the **dev instance** (either separate namespace, or separate deployments like `monitoring-app-v2-dev`)
- Make `main` deploy to **prod instance**

The simplest change is:

- Add a second trigger:
  - `dev` → uses `K8S_NAMESPACE=leet-monitor-dev` (or similar)
  - `main` → uses `K8S_NAMESPACE=leet-monitor` (prod)

You can implement that as:

- two stages, each conditioned on `Build.SourceBranchName`, OR
- two pipelines (one per branch), OR
- same pipeline with runtime variables per branch.

