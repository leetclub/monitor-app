# CronJob Strategy: Live Sync (DB ≈ Videoloft)

## Production CronJob (current)

**Goal:** Postgres `people_analytics_records` stays aligned with Videoloft for **today + yesterday** (Kuwait), including when Videoloft **revises** past hour buckets.

| Setting | Value | Meaning |
|--------|--------|---------|
| `schedule` | `*/5 * * * *` | Every 5 minutes |
| `SYNC_DAYS_BACK` | `0` | Not a multi-day backfill |
| `SYNC_LIVE_DAYS` | `2` | From **yesterday 00:00** through **current hour** (Kuwait) |
| `SYNC_INTERVAL` | `hour` | Hour buckets (sent to Videoloft as `3600000`) |
| `TIMEZONE` | `Asia/Kuwait` | Bucket boundaries |

Each run **upserts** all hour rows in that window. If Videoloft increases `in`/`out` for an earlier hour, the next sync run updates the same `(uidd, first_timestamp, interval_type)` row.

### Why not “last hour only”?

Hourly “last 1 hour” sync does **not** re-pull older buckets. The Monitor **DB vs Videoloft** compare then shows drift for any day that Videoloft adjusted after the hour was first stored.

### Optional env overrides (`sync_service.py`)

- `SYNC_LIVE_DAYS=3` — wider live window (e.g. today + 2 prior days)
- `SYNC_HOURS_BACK=48` — rolling 48h (used when `SYNC_LIVE_DAYS` is unset and `SYNC_DAYS_BACK=0`)
- `SYNC_DAYS_BACK>0` — backfill mode (see `hourly-backfill-365d-job.yaml`)

### Example timeline (live)

```
14:05 — sync runs: upsert all hours from yesterday 00:00 → today 14:00 (Kuwait)
14:10 — Videoloft revises today 10:00 bucket; sync runs again and updates DB row
```

### Backfill / historical days

**Only fetch all days when:**
- Initial historical sync (`initial-sync-job.yaml`, `hourly-backfill-365d-job.yaml`)
- Manual job with higher `SYNC_DAYS_BACK`
- Recovery from downtime

Older dates (e.g. a single day weeks ago) are **not** refreshed by the live cron; run a one-off backfill for that range.

## Migration from Every Minute to Every Hour

### Step 1: Update CronJob

```bash
kubectl apply -f people-analytics-sync/k8s/cronjob.yaml -n leet-monitor
```

### Step 2: Verify

```bash
# Check schedule
kubectl get cronjob people-analytics-sync -n leet-monitor -o jsonpath='{.spec.schedule}'
# Should show: "0 * * * *"

# Wait for next hour and check job
kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp | tail -2
```

### Step 3: Monitor First Hourly Run

```bash
# Get latest job
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')

# Check logs
kubectl logs -l job-name=$LATEST_JOB -n leet-monitor
```

Look for:
- ✅ "Fetching data from [1 hour ago] to [now]"
- ✅ "Successfully synced X records"
- ✅ No errors

## Verifying Historical Data Before Switch

Before switching the frontend to use the API, verify all historical data is synced:

```bash
# Run verification script
python3 people-analytics-sync/verify_historical_data.py
```

This will:
- Compare database date range with Videoloft
- Check if recent data is present
- Recommend if you need to run a full sync

## Manual Full Sync (If Needed)

If you need to sync all historical data:

```bash
# Create a one-time job for full historical sync
kubectl create job --from=cronjob/people-analytics-sync people-analytics-sync-full-$(date +%s) \
  -n leet-monitor \
  --overrides='{
    "spec": {
      "template": {
        "spec": {
          "containers": [{
            "name": "sync",
            "env": [
              {"name": "SYNC_DAYS_BACK", "value": "365"},
              {"name": "SYNC_INTERVAL", "value": "date"}
            ]
          }]
        }
      }
    }
  }'
```

Or use the existing initial-sync-job.yaml:

```bash
kubectl apply -f people-analytics-sync/k8s/initial-sync-job.yaml -n leet-monitor
```

