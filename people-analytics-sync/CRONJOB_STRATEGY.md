# CronJob Strategy: Hourly Sync

## Recommended Approach: Fetch Last Hour Only

### Why Fetch Only Last Hour?

✅ **Efficiency**: 
- Less data to process (only ~12 devices × 1 hour = minimal data)
- Faster syncs (typically < 5 seconds)
- Lower API usage

✅ **Upsert Logic Handles Everything**:
- The unique constraint prevents duplicates
- If a record already exists, it gets updated
- No need to fetch all data every time

✅ **Better Performance**:
- Less database load
- Faster queries
- Lower bandwidth usage

### How It Works

1. **Hourly CronJob** runs at minute 0 of every hour
2. **Fetches last 1 hour** of data from Videoloft
3. **Upsert logic**:
   - If record exists (same device + time period): Updates it
   - If record doesn't exist: Inserts it
4. **Result**: Database always has the latest data without duplicates

### Configuration

The CronJob is configured with:
- `schedule: "0 * * * *"` - Runs every hour at :00
- `SYNC_DAYS_BACK: "0"` - Fetch only last hour
- `SYNC_INTERVAL: "hour"` - Use hour-level intervals

### Example Timeline

```
10:00 AM - CronJob runs, fetches 9:00-10:00 data
10:01 AM - New data arrives in Videoloft for 9:00-10:00
11:00 AM - CronJob runs, fetches 10:00-11:00 data
          - Also updates 9:00-10:00 if Videoloft updated it
```

### Alternative: Fetch All Data (NOT Recommended)

If you fetch all data every hour:
- ❌ Slower (processes hundreds/thousands of records)
- ❌ More API calls
- ❌ Higher database load
- ❌ Unnecessary (upsert already handles it)

**Only fetch all data when:**
- Initial historical sync
- Manual full sync
- Recovery from downtime

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

