# Intra-Day Checkup – Setup (psql + kubectl)

Control staff can record midday operator readiness (Ready / Not ready) per machine per day from the **Attendance & Cleaning** tab → **Intra-Day Checkup** section. Data is stored in Postgres and served by people-api.

## 1. Database (psql)

Run the migration on the `people_analytics` database (same DB used by people-api).

**Option A – From project root (WSL or where `psql` is available):**
```bash
cd people-analytics-sync
bash run-intra-day-checkup-migration.sh
```

**Option B – Manual:**
```bash
psql -d people_analytics -f people-analytics-sync/migrations/add_intra_day_checkups.sql
```

This creates the `intra_day_checkups` table and indexes.

## 2. People API (kubectl)

Redeploy the people-api so it loads the new model and routes (`/api/intra-day-checkups` GET/POST).

- Build and push the updated image (if you use a registry), then update the deployment, **or**
- If your deploy applies the repo (e.g. from Git), redeploy the people-api deployment so the new code (models + api_service.py) is used.

Example (adjust namespace/deployment name to your setup):
```bash
kubectl rollout restart deployment/people-api -n <your-namespace>
# Or apply the k8s manifest you use for people-api
kubectl apply -f k8s/api-deployment.yaml
```

## 3. Google Apps Script

- Deploy the updated Apps Script (e.g. `clasp push` and deploy a new version).
- Script Properties: optional `PEOPLE_ANALYTICS_API_BASE` if people-api is not at `https://people-api.theleetclub.com`.

## 4. Usage in the app

1. Open **Attendance & Cleaning**.
2. In **Intra-Day Checkup**:
   - Select **Machine**.
   - **Operator** is filled from the same criteria as attendance (operator type + machine access); if only one operator, they are selected by default.
   - Choose **Date** and **Status** (Ready / Not ready), then **Save checkup**.
3. **Recent checkups** lists the last 14 days; use **Refresh list** to reload.
