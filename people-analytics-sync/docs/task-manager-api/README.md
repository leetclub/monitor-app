# Task Manager API (Leet Workflow)

Upstream for Alert **Attendance**, **Last clean**, and (pending) GO CHECK / DM / tech visit / cleaning-overdue writes (`https://workflow.theleetclub.com`).

## Pending vs Alert needs

See **[PENDING-ALERT-INTEGRATION.md](./PENDING-ALERT-INTEGRATION.md)** — maps the six email asks to Postman/PDF (2026-07-28) and Live re-probes. **#1–#4 wired**; **#6 from/until Live OK**; **#5** has `complete` + `vm_review` samples (rejected sample still welcome).

## Postman / PDF

- `Task-Manager-API.postman_collection.json` — schedule, attendance, daily checks, **quality-control**, **urgent-operator**, **direct-messages**, **cleaning-overdue**.
- `Task-Manager-API-New-Endpoints.pdf` — write APIs + QC list (2026-07-28).
- `Task-Manager-API-Live.postman_environment.example.json` — production base URL; copy and set `api_key` locally.
- `Task-Manager-API-Test.postman_environment.example.json` — staging base URL (`task.almaghrerb.com:8890`).

**Daily checks (Last clean):**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/daily-checks?all=true&date=YYYY-MM-DD` | List all VM checks for a day |
| `GET /api/v1/daily-checks?all=true&from=&until=` | Date range (Live OK 2026-08-09) |
| `GET /api/v1/daily-checks?...&vendon_id=` | Filter by Vendon machine id |
| `GET /api/v1/daily-checks/{id}` | Full detail — `media`, `vm_review` (`check_result_*`, `load_audit_type`) |

**Write / QC (wired in Alert):**

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/tasks/urgent-operator` | Urgent task → Received inbox |
| `POST /api/v1/direct-messages` | System DM to operator |
| `POST /api/v1/notifications/cleaning-overdue` | Cleaning-overdue DM |
| `GET /api/v1/quality-control` | QC visits (used as tech visit + SC fallback) |

## people-analytics-api proxy

Alert app calls people-api (session auth), which proxies Task Manager:

| Route | Purpose |
|-------|---------|
| `GET /api/alert/workflow/operator-schedule?machine_id=` | Operator name, today status, MTD absent/late, clock times |
| `GET /api/alert/workflow/machine-attendance-map?machine_ids=` | Batch pills for Overall fleet table |
| `GET /api/alert/workflow/cleaning?machine_id=` | Last clean — Task Manager daily check + Vendon snapshot fallback |
| `GET /api/alert/workflow/cleaning-map?machine_ids=` | Batch last clean for Red Flags / Overall |
| `GET /api/alert/workflow/tech-visit?machine_id=` | Last QC/tech visit (TM quality-control + SafetyCulture fallback) |
| `POST /api/alert/workflow/go-check` | Urgent Received task (`/tasks/urgent-operator`); Slack/mailto fallback |
| `POST /api/alert/workflow/dm-operator` | System DM to scheduled operator (`/direct-messages`) |
| `POST /api/alert/workflow/cleaning-overdue` | Cleaning-overdue notification to operator inbox |

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
