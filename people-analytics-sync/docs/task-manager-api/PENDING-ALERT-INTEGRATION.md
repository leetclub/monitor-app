# Workflow / Task Manager — pending vs Alert needs

**Updated:** 2026-07-30  
**Source package:** Postman collection + `Task-Manager-API-New-Endpoints.pdf` (2026-07-28)

## Live write APIs — root cause (probed from people-api pod)

Same API key + base URL as working reads (`https://workflow.theleetclub.com`).

| Check | Result |
|-------|--------|
| Reads (schedule, attendance, daily-checks, quality-control) | **200 OK** |
| Write routes exist | **Yes** — GET returns `405 … Supported methods: POST` |
| Invalid write body | **422** with Laravel validation errors (routes + validators work) |
| Valid write body (urgent / DM / cleaning-overdue) | **500** `{ "message": "Server Error" }` only |
| Staging host from PDF | `task.almaghrerb.com:8890` — **DNS fails** from cluster |

Conclusion: **not an Alert/payload/auth bug**. Validation passes; server crashes while creating the task/DM (issuer/sender). Docs say writes need **`TASKS_SYSTEM_ISSUER_ADMIN_ID`** in Live `.env` pointing at a real admin — most likely missing/invalid on Live (or related DB/notification error). Workflow team must check Live Laravel logs + that env var.

Probe script: `people-analytics-sync/scripts/probe_tm_writes_vs_reads.py`

---

## Your six asks → status

| # | Need | Upstream | Alert / people-api | Still open |
|---|------|----------|--------------------|------------|
| **1** | POST urgent operator task → Received | `POST /api/v1/tasks/urgent-operator` | **Wired** — GO CHECK → TM; Slack fallback | **Live 500 after validation** |
| **2** | POST message to scheduled operator | `POST /api/v1/direct-messages` | **Wired** — Call OP DM | **Live 500 after validation** |
| **3** | GET last tech visit (`vendon_id`) | `GET /api/v1/quality-control` | **Wired** — QC + SC fallback | Confirm QC ≡ tech visit |
| **4** | POST cleaning-overdue → inbox | `POST /api/v1/notifications/cleaning-overdue` | **Wired** — Cleaning alert send | **Live 500 after validation** |
| **5** | CC review approved/rejected samples | Daily checks still evolving | Parser ready | Need samples |
| **6** | Daily-checks `from`/`until` / sync | Not on daily-checks yet | Day-loop lookback | Need from Workflow |

## Proxy routes

| Alert route | TM upstream |
|-------------|-------------|
| `POST /api/alert/workflow/go-check` | `POST /api/v1/tasks/urgent-operator` |
| `POST /api/alert/workflow/dm-operator` | `POST /api/v1/direct-messages` |
| `POST /api/alert/workflow/cleaning-overdue` | `POST /api/v1/notifications/cleaning-overdue` |
| `GET /api/alert/workflow/tech-visit` | `GET /api/v1/quality-control` (+ SC fallback) |
