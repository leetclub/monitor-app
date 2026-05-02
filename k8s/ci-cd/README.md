# CI/CD: Versioning and K8s Deploy

## Move these files to your desired repo

The CI/CD files live in **this** repo (monitoring-app). To use them in another repo (the one you build and deploy):

### Option A: Push directly to the target repo (no local clone)

If you **don’t have the target repo locally**, use the script that clones it, adds the files, and pushes:

**WSL / Bash:**
```bash
cd path/to/monitoring-app/k8s/ci-cd
chmod +x copy-ci-cd-to-repo-and-push.sh
./copy-ci-cd-to-repo-and-push.sh "https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitor-app" main
```

For a **private** Azure DevOps repo, include a PAT in the URL so clone/push can authenticate:
```bash
./copy-ci-cd-to-repo-and-push.sh "https://anything:YOUR_PAT@dev.azure.com/leetclub/ProjectName/_git/repo-name" main
```

The script clones the repo, copies the CI/CD files, commits, and pushes. Then edit `azure-pipelines.yml` in that repo (e.g. in Azure Repos or after cloning) to set your parameters.

### Option B: Run the copy script (target repo already cloned)

If you **already have** the app repo on disk:

**Bash (WSL or Git Bash):**
```bash
cd path/to/monitoring-app/k8s/ci-cd
chmod +x copy-ci-cd-to-repo.sh
./copy-ci-cd-to-repo.sh /path/to/your/app-repo
```

**PowerShell:**
```powershell
cd path\to\monitoring-app\k8s\ci-cd
.\copy-ci-cd-to-repo.ps1 -Target "C:\path\to\your\app-repo"
```

The script copies into the target repo:
- `k8s/ci-cd/get-version.sh`
- `k8s/ci-cd/azure-pipelines.build-deploy.yml`
- `k8s/ci-cd/example-one-repo-azure-pipelines.yml`
- `k8s/ci-cd/README.md`
- `azure-pipelines.yml` (at repo root; copied from the example)

Then **edit** the target repo’s `azure-pipelines.yml`: set `imageName`, `k8sDeployment`, `approvalNotifyUsers`, etc.

### Option C: Copy by hand

| Copy from (here) | To (in your app repo) |
|------------------|------------------------|
| `k8s/ci-cd/get-version.sh` | `k8s/ci-cd/get-version.sh` |
| `k8s/ci-cd/azure-pipelines.build-deploy.yml` | `k8s/ci-cd/azure-pipelines.build-deploy.yml` |
| `k8s/ci-cd/example-one-repo-azure-pipelines.yml` | `k8s/ci-cd/` (optional, for reference) |
| `k8s/ci-cd/example-one-repo-azure-pipelines.yml` | **repo root** as `azure-pipelines.yml` |

Edit the root `azure-pipelines.yml` in the app repo with your parameters.

---

## How to use each file in `k8s/ci-cd/`

| File | What it is | How you use it |
|------|------------|----------------|
| **get-version.sh** | Script that computes the version string (e.g. `1.0.0-20260219.5` or `1.2.3` from a tag). | **Keep it in the repo** at `k8s/ci-cd/get-version.sh`. The pipeline runs it during Build; you don’t run it yourself. |
| **azure-pipelines.build-deploy.yml** | **Template** that defines Build (version + Docker build + push) and Deploy (approval + kubectl). | **Don’t use it as the pipeline file.** Your repo’s pipeline **extends** this template (see below). Keep a copy in the repo at `k8s/ci-cd/` so the pipeline can reference it. |
| **example-one-repo-azure-pipelines.yml** | **Example** pipeline that extends the template and sets parameters (image name, deployment name, approval, etc.). | **Copy it to the repo root** and rename to **`azure-pipelines.yml`**. Edit the parameters (imageName, k8sDeployment, approvalNotifyUsers, etc.). In Azure DevOps, create a pipeline that uses this repo and the file `azure-pipelines.yml`. |

### Flow in one picture

```
Your repo root
├── azure-pipelines.yml          ← YOU CREATE: copy from example-one-repo-azure-pipelines.yml, edit parameters
├── Dockerfile (or Dockerfile.api)
└── k8s/
    └── ci-cd/
        ├── get-version.sh       ← MUST BE IN REPO: pipeline calls this during Build
        ├── azure-pipelines.build-deploy.yml   ← MUST BE IN REPO: template that azure-pipelines.yml extends
        └── example-one-repo-azure-pipelines.yml   ← REFERENCE ONLY: copy to root as azure-pipelines.yml
```

### In Azure DevOps

1. **New pipeline** → choose your repo → **Existing Azure Pipelines YAML file** → branch: main, path: **`/azure-pipelines.yml`**.
2. That file (the one you copied from the example) contains `extends: template: k8s/ci-cd/azure-pipelines.build-deploy.yml`, so the pipeline runs the template with your parameters.
3. The template’s Build stage runs `k8s/ci-cd/get-version.sh`; that’s why both the template and the script must be in the repo.

**Summary:** Put all of `k8s/ci-cd/` in your app repo. In the repo root, add `azure-pipelines.yml` by copying from `example-one-repo-azure-pipelines.yml` and editing the parameters. Point the Azure DevOps pipeline at that root file.

---

## Quick setup in Azure DevOps

### 1. Registry

- Create a **service connection** for your container registry (Docker Hub or Azure ACR).
- Ensure the pipeline has permission to use it.

### 2. Kubernetes (service connection)

- Create a **Kubernetes** service connection: **Project settings** → **Service connections** → **New service connection** → **Kubernetes** (e.g. with kubeconfig or Azure Kubernetes Service).
- Note the connection name (e.g. `k8s-leet-monitor`) and pass it as the **k8sServiceConnection** parameter. The pipeline uses this to run `kubectl set image` and `kubectl rollout status`.

### 3. Pipeline

- In the repo (e.g. vendon-sync synced to Azure DevOps), add a pipeline that uses the template, or copy **azure-pipelines.build-deploy.yml** into the repo root as `azure-pipelines.yml`.
- Set **parameters**. The example uses **variables** so most values are automatic:
  - `imageName`: `programmeradmin25/$(Build.Repository.Name)` (registry fixed, image = repo name)
  - `k8sNamespace`: leave empty to use Azure DevOps **project name** (lowercase, spaces → hyphens)
  - `k8sDeployment`, `containerName`: `$(Build.Repository.Name)` (same as repo name)
  - `k8sServiceConnection`: name of your Kubernetes service connection (required)
  - `approvalNotifyUsers`: your email or group for deploy approval

### 4. Parameters vs variables (in the template)

| | Parameters | Variables |
|---|------------|-----------|
| **When set** | When the pipeline is defined or when you run it (YAML or pipeline UI). | At runtime: from variable groups, script output, or built-ins like `Build.Repository.Name`, `System.TeamProject`. |
| **In this template** | The template defines **parameters** (e.g. `imageName`, `k8sDeployment`). You pass values from the **calling** pipeline (e.g. `azure-pipelines.yml`). | In the calling pipeline you can pass **variable expressions** as parameter values: e.g. `imageName: 'programmeradmin25/$(Build.Repository.Name)'` — Azure DevOps replaces `$(Build.Repository.Name)` at queue time, so the template receives the actual repo name. |
| **Example** | `dockerfilePath: Dockerfile.api` (fixed). | `imageName: programmeradmin25/$(Build.Repository.Name)` (dynamic from repo). |

So the “variables” you see in the template (e.g. in comments) are **parameter names**. The **values** you pass can be literal or use pipeline variables like `$(Build.Repository.Name)`.

### 5. Versioning behaviour

- **Push to `main`**: version = `1.0.0-YYYYMMDD.BuildId`, image tagged with that and `latest`.
- **Push tag `v1.2.3`**: version = `1.2.3`, image tagged with that (and optionally `latest`).

Deploy stage runs after a successful build; it **waits for manual approval** (unless disabled), then updates the deployment with the new image tag.

### 6. Deploy approval

- **requireDeployApproval** (default `true`): pipeline pauses before deploy until someone approves (ManualValidation task).
- **approvalNotifyUsers**: when approval is required, set this to the user(s) or group to notify (e.g. your email). Required for the approval step to work.
- To test without approval: set `requireDeployApproval: false` in the template parameters.

## Example: vendon-app (from /mnt/c/Users/.../vendon-app)

Use the **example-one-repo-azure-pipelines.yml** as your root `azure-pipelines.yml`. It already sets:

- **imageName**: `programmeradmin25/$(Build.Repository.Name)` → e.g. `programmeradmin25/vendon-app`
- **k8sNamespace**: empty → derived from Azure DevOps **project name** (e.g. "Leet Motion" → `leet-motion`)
- **k8sDeployment**, **containerName**: `$(Build.Repository.Name)` → e.g. `vendon-app`

You only need to **replace two placeholders** in the file (or set them as pipeline variables in Azure DevOps):

1. **k8sServiceConnection**: replace `YOUR_K8S_SERVICE_CONNECTION_NAME` with the name of your Kubernetes service connection (e.g. `k8s-leet-monitor`).
2. **approvalNotifyUsers**: replace `YOUR_EMAIL_OR_GROUP` with your email or group so you get the deploy approval request.

Ensure the K8s deployment and container in the cluster match the repo name (e.g. deployment `vendon-app`, container `vendon-app`), or override `k8sDeployment` / `containerName` with literal values.
