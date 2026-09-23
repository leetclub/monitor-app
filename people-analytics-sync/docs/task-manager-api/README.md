# Task Manager API (Leet Workflow)

Upstream for Alert **Attendance**, **Last clean**, **tech visit**, **active technical issues**, and GO CHECK / DM / cleaning-overdue writes (`https://workflow.theleetclub.com`).

## Connector handoff (other teams)

→ **[CONNECTOR-HANDOFF.md](./CONNECTOR-HANDOFF.md)** — full catalog, Live test results (2026-09-23), curl examples, Alert mapping.

## Pending vs Alert needs

See **[PENDING-ALERT-INTEGRATION.md](./PENDING-ALERT-INTEGRATION.md)**.

## Postman / package

- `Task-Manager-API.postman_collection.json` — schedule, attendance, daily checks, QC, **API Pull Data View** (vm-technical-issues / tasks / projects), writes, mobile auth.
- `Task-Manager-API-Live.postman_environment.example.json` — production base URL; copy and set `api_key` locally.
- `Task-Manager-API-Test.postman_environment.example.json` — staging (`task.almaghrerb.com:8890`).

Import a fresh Omar export (redacts keys):

```bash
python3 scripts/import_task_manager_postman.py "/path/to/postman" docs/task-manager-api
```

### API Pull Data View (new)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/vm-technical-issues` | Paginated VM tech tickets (`vendon_id`, `status`, dates, search) |
| `GET /api/v1/vm-technical-issues/{ticket_id}` | Ticket detail + media |
| `GET /api/v1/tasks` | Paginated tasks (full detail) |
| `GET /api/v1/tasks/{id}` | Task detail |
| `GET /api/v1/projects` | Paginated projects (full detail) |
| `GET /api/v1/projects/{id}` | Project detail |

### Daily checks (Last clean)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/daily-checks?all=true&date=YYYY-MM-DD` | List all VM checks for a day |
| `GET /api/v1/daily-checks?all=true&from=&until=` | Date range |
| `GET /api/v1/daily-checks?...&vendon_id=` | Filter by Vendon machine id |
| `GET /api/v1/daily-checks/{id}` | Full detail — `media`, `vm_review` |

### Write / QC

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/tasks/urgent-operator` | Urgent task → Received inbox |
| `POST /api/v1/direct-messages` | System DM to operator |
| `POST /api/v1/notifications/cleaning-overdue` | Cleaning-overdue DM |
| `GET /api/v1/quality-control` | QC visits (tech visit + SC fallback) |

## people-analytics-api proxy

| Route | Purpose |
|-------|---------|
| `GET /api/alert/workflow/operator-schedule?machine_id=` | Operator name, today status, MTD absent/late, clock times |
| `GET /api/alert/workflow/machine-attendance-map?machine_ids=` | Batch pills for Overall fleet table |
| `GET /api/alert/workflow/cleaning?machine_id=` | Last clean |
| `GET /api/alert/workflow/cleaning-map?machine_ids=` | Batch last clean |
| `GET /api/alert/workflow/tech-visit?machine_id=` | Last QC/tech visit |
| `GET /api/alert/workflow/technical-issues?machine_id=` | Active open/in_progress tech tickets |
| `GET /api/alert/workflow/technical-issues-map?machine_ids=` | Batch active tech tickets |
| `POST /api/alert/workflow/go-check` | Urgent Received task |
| `POST /api/alert/workflow/dm-operator` | System DM |
| `POST /api/alert/workflow/cleaning-overdue` | Cleaning-overdue notification |

Kubernetes: `LEET_WORKFLOW_API_BASE` on deployment; `leet-workflow-api-key` in `people-analytics-secrets`.
