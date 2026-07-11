# Task Manager API (Leet Workflow)

Read-only upstream for Alert **Attendance** and **Last clean** (`https://workflow.theleetclub.com`).

## Postman

- `Task-Manager-API.postman_collection.json` — schedule periods, attendance users, **daily checks** (VM Check / cleaning uploads).
- `Task-Manager-API-Live.postman_environment.example.json` — production base URL; copy and set `api_key` locally.
- `Task-Manager-API-Test.postman_environment.example.json` — staging base URL (`task.almaghrerb.com:8890`).

**Daily checks (Last clean):**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/daily-checks?all=true&date=YYYY-MM-DD` | List all VM checks for a day |
| `GET /api/v1/daily-checks?...&vendon_id=` | Filter by Vendon machine id |
| `GET /api/v1/daily-checks/{id}` | Full detail — `media`, `vm_review` (Command Center audit) |

## people-analytics-api proxy

Alert app calls people-api (session auth), which proxies Task Manager:

| Route | Purpose |
|-------|---------|
| `GET /api/alert/workflow/operator-schedule?machine_id=` | Operator name, today status, MTD absent/late, clock times |
| `GET /api/alert/workflow/machine-attendance-map?machine_ids=` | Batch pills for Overall fleet table |
| `GET /api/alert/workflow/cleaning?machine_id=` | Last clean — Task Manager daily check + Vendon snapshot fallback |
| `GET /api/alert/workflow/cleaning-map?machine_ids=` | Batch last clean for Red Flags / Overall |

Kubernetes: `LEET_WORKFLOW_API_BASE` on deployment; `leet-workflow-api-key` in `people-analytics-secrets`. Optional `LEET_WORKFLOW_CLEANING_DAYS_BACK` (default `7`).

Probe daily checks from pod:

```bash
bash scripts/probe-daily-checks-pod.sh 525084
```

Patch secret (do not commit the key):

```bash
bash scripts/patch-leet-workflow-secret.sh "$API_KEY"
kubectl apply -f k8s/api-deployment.yaml
kubectl rollout restart deployment/people-analytics-api -n leet-monitor
```

Verify in pod:

```bash
bash scripts/verify-workflow-in-pod.sh 375482
```
