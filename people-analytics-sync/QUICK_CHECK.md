# Quick Check Commands

## One-Liner Health Check

```bash
# Check CronJob and latest job status
kubectl get cronjob people-analytics-sync -n leet-monitor && \
kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp | tail -2 && \
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=5
```

## Check if CronJob is Running

```bash
# See if CronJob exists and is active
kubectl get cronjob people-analytics-sync -n leet-monitor

# Check last 5 jobs
kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp | tail -6
```

## Check Latest Sync

```bash
# Get latest job and its logs
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
kubectl logs -l job-name=$LATEST_JOB -n leet-monitor --tail=20
```

## Check Database

```bash
# Quick database check
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT MAX(synced_at) as last_sync, COUNT(*) as records FROM people_analytics_records;"
```

## Run Full Health Check

```bash
# Run the health check script
./people-analytics-sync/health_check.sh
```

## What to Look For

### ✅ Good Signs:
- CronJob exists and schedule is `* * * * *` (every minute)
- Jobs are being created regularly (every minute)
- Jobs show status `Complete` or `Succeeded`
- Logs show "Successfully synced X records"
- Database shows recent `synced_at` timestamps
- No duplicate records

### ❌ Warning Signs:
- No jobs being created
- Jobs stuck in `Pending` or `Running`
- Jobs showing `Failed`
- Logs show errors (authentication, database connection, etc.)
- Database `last_sync` is old (> 5 minutes ago)
- Duplicate records found

