# GitHub → Azure DevOps repo sync (CronJob)

Keeps selected GitHub repos mirrored to Azure DevOps on a schedule until the team moves fully to Azure. Each run clones (or fetches) from GitHub and pushes all branches and tags to the mapped Azure DevOps project.

## Prerequisites

- **Azure DevOps**: Create a project per “destination” and create an **empty repo** in each project for each GitHub repo you want to sync (same repo name as on GitHub).
- **GitHub**: Personal Access Token with `repo` scope.
- **Azure DevOps**: PAT with **Code (Read & write)** and **Project and team (Read)** if needed.

## 1. Repo → project mapping (single source of truth)

Edit **only** **`repo-mapping.yaml`** (two columns: GitHub repo, Azure project name):

```yaml
# Format: "github_org/repo_name"    "AzureProjectName"
theleetclub/monitoring-app    monitoring
theleetclub/people-analytics-sync    people-analytics
```

The ConfigMap is created from this file—you never edit a second file.

## 2. Tokens (Secret)

Create the Secret **without** putting real tokens in git:

```bash
kubectl create secret generic repo-sync-tokens \
  --from-literal=github-token='ghp_xxxx' \
  --from-literal=azure-devops-pat='your-azure-pat' \
  --from-literal=azure-devops-org='your-org-name'
```

Or copy `secret.example.yaml` to `secret.yaml`, fill in values, then `kubectl apply -f secret.yaml` (add `secret.yaml` to `.gitignore`).

## 3. Deploy

From the `k8s/repo-sync` directory:

```bash
# Create/update mapping ConfigMap from repo-mapping.yaml (only file you edit)
kubectl create configmap repo-sync-mapping --from-file=repo-mapping.txt=repo-mapping.yaml -n repo-sync-temp --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f configmap-script.yaml -f cronjob.yaml
```

## When you edit the repo mapping

Every time you change **`repo-mapping.yaml`** (add/remove/change repos):

1. **Push the new mapping to the cluster** (from `k8s/repo-sync`):

   ```bash
   kubectl create configmap repo-sync-mapping \
     --from-file=repo-mapping.txt=repo-mapping.yaml \
     -n repo-sync-temp \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

2. **Optional:** Run a sync immediately instead of waiting for the next cron:

   ```bash
   kubectl create job --from=cronjob/repo-sync-github-to-azure manual-sync-$(date +%s) -n repo-sync-temp
   kubectl logs job/manual-sync-<timestamp> -n repo-sync-temp -f
   ```

Use your actual namespace if different from `repo-sync-temp`.

## 4. Schedule

Default in **`cronjob.yaml`** is every 5 minutes: `*/5 * * * *`. Only the latest successful and latest failed job are kept; each job is removed 5 minutes after it finishes.

## 5. Script changes

If you edit **`sync-script.sh`**, refresh the script ConfigMap:

```bash
kubectl create configmap repo-sync-script --from-file=sync-script.sh=sync-script.sh -o yaml --dry-run=client > configmap-script.yaml
kubectl apply -f configmap-script.yaml
```

## Verify

- List CronJobs: `kubectl get cronjobs`
- Logs of last run: `kubectl logs -l job-name=repo-sync-github-to-azure-<suffix>` (get exact job name from `kubectl get jobs`)
- Or trigger once: `kubectl create job --from=cronjob/repo-sync-github-to-azure manual-sync-1`

## Files

| File | Purpose |
|------|--------|
| `repo-mapping.yaml` | **Only file you edit** for mapping: GitHub repo → Azure project |
| `sync-script.sh` | Sync logic (clone/fetch + push) |
| `configmap-script.yaml` | ConfigMap with script (CronJob runs this) |
| `secret.example.yaml` | Example Secret; create real secret with kubectl |
| `cronjob.yaml` | CronJob definition |

## Azure DevOps: `TF402455` (push to `main` not permitted)

If logs show **`TF402455: Pushes to this branch are not permitted; you must use a pull request`**, Azure **branch policies** on `main` are blocking the mirror push. The sync job uses **force push** of GitHub branches into Azure `main`, so the account behind **`AZURE_DEVOPS_PAT`** must be allowed to bypass policies for those repos, or policies on `main` must exempt that user/build service.

Typical fixes (pick one per repo or project):

- **Project settings → Repositories → Policies**: for `main`, add the PAT user (or **Project Collection Build Service**) under **Bypass policies when pushing**, or relax “Require a pull request” for mirror-only repos.
- Or mirror into a **non-protected** branch (would require changing `sync-script.sh` / push refspec — not the default).

## Version control (`monitoring-app` repo)

This folder is allowlisted in the root **`.gitignore`** so `k8s/repo-sync/` can be committed with the Apps Script project. After editing **`repo-mapping.yaml`**, commit and push from a normal terminal (outside environments that wrap `git commit`):

```bash
cd /path/to/monitoring-app
git add .gitignore k8s/repo-sync/
git commit -m "Update repo-sync mapping"
git push
```
