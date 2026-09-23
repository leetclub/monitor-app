# Workflow / Task Manager — pending vs Alert needs

**Updated:** 2026-09-23  
**Source package:** Omar Postman (`postman 3`) + prior collection — see **[CONNECTOR-HANDOFF.md](./CONNECTOR-HANDOFF.md)**.  
**Live re-probe:** 2026-09-23 → `https://workflow.theleetclub.com`

## Live write APIs — verified 2026-08-03

| Check | Result |
|-------|--------|
| Reads (schedule, attendance, daily-checks, quality-control) | **200 OK** |
| `POST /api/v1/tasks/urgent-operator` | **201 Created** |
| `POST /api/v1/direct-messages` | **201 Created** |
| `POST /api/v1/notifications/cleaning-overdue` | **201 Created** |

## API Pull Data View — verified 2026-09-23

| Endpoint | Result |
|----------|--------|
| `GET /api/v1/vm-technical-issues` (+ detail by ticket) | **200** |
| `GET /api/v1/tasks` (+ detail by id) | **200** |
| `GET /api/v1/projects` (+ detail by id) | **200** |

Task `status=open` → **422** (use `pending` / `in_progress` / `completed` / `cancelled`). Tech issue `status=open` → **200**.

## Your six asks → status

| # | Need | Upstream | Alert / people-api | Still open |
|---|------|----------|--------------------|------------|
| **1** | POST urgent operator task → Received | `POST /api/v1/tasks/urgent-operator` | **Wired** | Live OK |
| **2** | POST message to scheduled operator | `POST /api/v1/direct-messages` | **Wired** | Live OK |
| **3** | GET last tech visit | `GET /api/v1/quality-control` | **Wired** | Confirm QC ≡ tech visit |
| **4** | POST cleaning-overdue → inbox | `POST /api/v1/notifications/cleaning-overdue` | **Wired** | Live OK |
| **5** | CC review samples | daily-checks `vm_review` | Parser updated | Rejected sample welcome |
| **6** | Daily-checks `from`/`until` | **Live OK** | Wired | Optional webhook |

## New view-only → Alert

| Need | Upstream | Alert |
|------|----------|-------|
| Active technical issues / tech fixing | `GET /api/v1/vm-technical-issues` | **Proxy wired** `GET /api/alert/workflow/technical-issues` (+ `-map`). UI column still TBD (sheet R52). |
| Tasks / projects lists | `/api/v1/tasks`, `/api/v1/projects` | Available for connectors; not on Alert boards yet |
| Customer calls | — | **Still blocked** — not in Workflow package |

## Proxy routes

| Alert route | TM upstream |
|-------------|-------------|
| `POST /api/alert/workflow/go-check` | `POST /api/v1/tasks/urgent-operator` |
| `POST /api/alert/workflow/dm-operator` | `POST /api/v1/direct-messages` |
| `POST /api/alert/workflow/cleaning-overdue` | `POST /api/v1/notifications/cleaning-overdue` |
| `GET /api/alert/workflow/tech-visit` | `GET /api/v1/quality-control` (+ SC fallback) |
| `GET /api/alert/workflow/cleaning` / `cleaning-map` | `GET /api/v1/daily-checks` |
| `GET /api/alert/workflow/technical-issues` / `technical-issues-map` | `GET /api/v1/vm-technical-issues` (open + in_progress) |
