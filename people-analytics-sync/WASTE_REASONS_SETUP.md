# Waste Analysis Reasons – Setup

User-entered reasons for waste analysis results are stored per machine per date.

**Database:** We use the existing **people_analytics** database (no new DB created). The waste reasons API runs in the same app as people-analytics-sync, so it uses that DB. One DB, one API.

## 1. Database migration

Create the table (run once):

```bash
# If people_analytics DB does not exist:
createdb people_analytics

# Run migration (psql without username/password – trust auth):
cd people-analytics-sync
psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
```

Or with host/user:

```bash
psql -h <host> -U <user> -d people_analytics -f migrations/add_waste_analysis_reasons.sql
```

Or use the script:

```bash
cd people-analytics-sync
chmod +x run_waste_reasons_migration.sh
./run_waste_reasons_migration.sh
```

## 2. API (people-analytics-sync)

The API service exposes:

- `GET /api/waste-reasons?date=YYYY-MM-DD&machine_ids=id1,id2` – fetch reasons for a date (and optional machine IDs).
- `POST /api/waste-reasons` – body `{ "machine_id": "...", "date": "YYYY-MM-DD", "reason": "..." }` – create/update one reason.

CORS is enabled so the Google Apps Script web app can call the API.

Deploy/run the API so it uses the same `people_analytics` DB (e.g. point `WASTE_REASONS_API_BASE` in the frontend to this service).

## 3. Apps Script (Waste + Refund reasons)

Both **Waste Analysis** and **Refund Tests** tabs call the people-analytics API from **server-side** Apps Script (waste-tab.js, remote-credits-tab.js). Set this in **Apps Script → Project Settings → Script Properties**:

- **PEOPLE_ANALYTICS_API_BASE** = `https://people-api.theleetclub.com` (or your people-api base URL, no trailing slash)

If unset, the code falls back to `https://people-api.theleetclub.com`.

## 4. Push to Google

From the project root (where `.clasp.json` is):

```bash
clasp push
```

(or `npx clasp push` if clasp is installed via npm).
