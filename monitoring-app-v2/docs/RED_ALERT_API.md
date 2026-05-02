# Red Alert — canonical HTTP API (v2)

Monitoring **v2** loads Red Alert only from **`GET /api/red-alert/snapshot`**. It must not depend on the Google Apps Script app (v1) or on path names that mean “GAS”.

## Goals

- **v2**: session-backed `GET` on the same host / BFF as the rest of the dashboard (cookies or gateway auth).
- **v1**: may continue to call existing routes (e.g. `POST /api/red-alert/gas/snapshot` with `{ "email" }`) until v1 is retired.
- **Data & crons**: keep the **same Postgres cache and refresh jobs** v1 relies on today; add or extend HTTP handlers only.

## Canonical route (v2)

**`GET /api/red-alert/snapshot`**

- **Auth**: resolve the signed-in user server-side (same pattern as `GET /api/me/dashboard-access`, live dashboard, etc.).
- **Authorisation**: user must be allowed tab `redAlert` or `liveDashboard` (same product rule as v1 `auth-access.js` aliasing).
- **Response**: `200` and JSON body:

```json
{
  "generatedAt": "2026-04-15T12:34:56.789Z",
  "rows": [ /* see TypeScript `RedAlertRow` in `src/features/redAlert/redAlertTypes.ts` */ ]
}
```

- **Empty board**: `200` with `"rows": []` is valid.
- **Errors**: `401` if unauthenticated; `403` if not allowed; `500` with `{ "error": "message" }` on failure.

Implementation note: return the **same row objects** you already store or compute for the GAS client (e.g. from `monitoring_dashboard.red_alert_snapshot_cache` or equivalent). No new business logic is required if the GET handler reads the same snapshot the GAS POST returns today.

## Legacy route (v1 — do not remove until v1 sunset)

**`POST /api/red-alert/gas/snapshot`** with JSON `{ "email": "user@domain" }` (lowercased) can remain for the classic dashboard. v2 **does not** call this endpoint.

Keeping both URLs avoids breaking v1 while v2 uses only the canonical `GET`.

## Refresh / cron

If you already expose an internal refresh (e.g. `POST /api/red-alert/internal/refresh` for schedulers), **leave it unchanged**. v2 does not call it; only operators / jobs should.

## Local development without people-api

Set **`VITE_USE_MOCK_RED_ALERT=true`** (or runtime **`USE_MOCK_RED_ALERT=true`** in `config.js`) so the React app uses the bundled mock in `src/features/redAlert/redAlertMock.ts`.

## Sidebar: when does “Red Alert” appear?

The nav only lists tabs the user is allowed to open. After **`GET /api/me/dashboard-access`**, the client normalises **`liveDashboard`**, **`redAlert`**, and **`redAlertExpert`** together: having **any** of those ids in `allowedTabs` grants **all three** (`expandAllowedTabsWithAliases` in `src/api/dashboardAccess.ts`, applied inside `fetchDashboardAccess`). `redAlertExpert` is a second layout over the same snapshot for side‑by‑side product comparison.

For mock dev with a **comma-separated** `VITE_MOCK_ALLOWED_TABS`, include one of those ids or **`*`**.
