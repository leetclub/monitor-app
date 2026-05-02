# monitoring-app-v2

React + TypeScript + Vite **standalone** replacement for the Google Apps Script dashboard in `monitoring-app`. Goal: **full functional parity** so the classic app can be retired. We do **not** modify `monitoring-app` for v2 work, and we **do not** remove APIs it relies on — extend `people-analytics-api` / BFF as needed. Same tab model, routes under `/tab/:tabId`, access hooks, Docker + nginx. See **`REFACTOR-SCOPE.txt`** for the porting checklist.

## Prerequisites

- Node.js 20+

## Local development

```bash
cd monitoring-app-v2
npm install
```

Create a `.env` file (see `env.example.txt`):

- `VITE_USE_MOCK_ACCESS=true` — skip API and grant tabs from `VITE_MOCK_ALLOWED_TABS` (`*` = all).
- `VITE_DEV_USER_EMAIL` — simulates a signed-in user for access queries.

```bash
npm run dev
```

Open http://localhost:5173 — you should see main sections (Operation, Sales, …), sub-tabs, and placeholder content per tab.

### API proxy

`vite.config.ts` proxies `/api` to `VITE_DEV_API_PROXY` (default `http://127.0.0.1:5000`). Point it at people-api or a BFF while you implement endpoints.

## Backend contract (to implement)

The browser must **not** use the `DASHBOARD_ACCESS_API_KEY` secret. Expose a **session- or OIDC-backed** route that resolves the current user’s email server-side, then applies PostgreSQL rules (same as today’s people-api).

Expected response shape for:

`GET /api/me/dashboard-access`

```json
{
  "email": "user@theleetclub.com",
  "allowedTabs": ["events", "people"],
  "fullAccess": false
}
```

Use `allowedTabs: ["*"]` for full access. Adjust `fetchDashboardAccess` in `src/api/dashboardAccess.ts` if your path or JSON differs.

**Red Alert** (`src/features/redAlert/`): the UI calls only **`GET /api/red-alert/snapshot`** (session). It does **not** call legacy GAS paths; implement that route on people-api (same data as today’s cache — see **`docs/RED_ALERT_API.md`**). Classic **v1** can keep using **`POST /api/red-alert/gas/snapshot`** until you retire the GAS app. For local UI demos without the route, set **`VITE_USE_MOCK_RED_ALERT=true`** (or **`USE_MOCK_RED_ALERT=true`** in `config.js`).

**Tab visibility:** `fetchDashboardAccess` expands **`liveDashboard`**, **`redAlert`**, and **`redAlertExpert`** so any one of those permissions grants all three tabs in the nav. With a **partial** mock list (`VITE_MOCK_ALLOWED_TABS`), include one of those ids or **`*`**.

`VITE_MONITORING_API_URL` — set at **build time** if the UI and API are on different origins; leave empty to use same-origin relative `/api` (typical when Ingress serves both under one host).

## Kubernetes

Build and run the static bundle behind your Ingress (same namespace as people-api is optional).

```bash
docker build -t your-registry/monitoring-app-v2:latest .
docker push your-registry/monitoring-app-v2:latest
```

Deployment should expose port **8080**, set env for the **build** via CI args or a build stage variable for `VITE_MONITORING_API_URL` if needed.

SPA routing: all paths fall back to `index.html` (see `nginx.conf`).

### K8s manifests

Manifests live under `k8s/`:

- `k8s/deployment.yaml` (image `programmeradmin25/monitoring-app-v2:latest`)
- `k8s/service.yaml`
- `k8s/ingress.yaml` (host `monitor-v2.theleetclub.com`)

Apply:

```bash
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/ingress.yaml
```

## Porting tabs from v1

For each legacy tab, replace `google.script.run` with `fetch` via `src/api/client.ts` and swap the placeholder in `TabPage` for a real component (lazy-loaded under `src/pages/tabs/` as the app grows). Tab ids in `src/navigation/tabs.ts` align with `auth-access.js` `ALL_DASHBOARD_TAB_IDS`.

## Scripts

| Script        | Action              |
|---------------|---------------------|
| `npm run dev` | Vite dev server     |
| `npm run build` | Typecheck + production bundle |
| `npm run preview` | Serve `dist` locally |
| `npm run lint`  | ESLint              |

## GitHub and Azure DevOps

Remotes are configured as:

| Remote   | URL |
|----------|-----|
| `origin` | `https://github.com/leetclub/monitoring-app-v2.git` |
| `azure`  | `https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitoring-app-v2` |

1. Create an **empty** repo on GitHub at `leetclub/monitoring-app-v2` (no README/license) if it does not exist yet, and an empty repo on [Azure DevOps](https://dev.azure.com/leetclub/Leet%20Monitor/_git/monitoring-app-v2).
2. Push to GitHub, then mirror branches/tags to Azure (same flow as in the legacy `monitoring-app` repo’s `GITHUB_TO_AZURE_DEVOPS_MIGRATION.md`):

```bash
./scripts/push-all.sh
# or manually:
git push -u origin main
git push azure main
# When you add more branches or tags:
git push azure --all
git push azure --tags
```

**Azure DevOps HTTPS:** use a [PAT](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate) as the password when prompted.

**Alternative:** in Azure DevOps use **Repos → Import repository** and import from GitHub (one-time full copy); ongoing sync still uses `git push` to both remotes from your machine or CI.
