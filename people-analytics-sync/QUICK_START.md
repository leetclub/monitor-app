# Quick Start Guide

## First Time Setup

### 1. Create Secrets

```bash
kubectl create secret generic people-analytics-secrets -n leet-monitor \
  --from-literal=db-host=your-db-host.db.ondigitalocean.com \
  --from-literal=db-port=25060 \
  --from-literal=db-name=people_analytics \
  --from-literal=db-user=doadmin \
  --from-literal=db-password=YOUR_DB_PASSWORD \
  --from-literal=videoloft-email=YOUR_EMAIL \
  --from-literal=videoloft-password=YOUR_PASSWORD
```

### 2. Initialize Database

```bash
# Connect and run SQL script
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics -f init_database.sql
```

### 3. Run Initial Full Sync (All Historical Data)

For the first sync, fetch all available historical data:

```bash
# Run initial sync (fetches 365 days of data)
kubectl apply -f k8s/initial-sync-job.yaml -n leet-monitor

# Watch the job
kubectl get jobs -n leet-monitor -w

# Check logs
kubectl logs job/people-analytics-sync-initial -n leet-monitor -f
```

**Note**: The initial sync fetches 365 days back. To change this, edit `k8s/initial-sync-job.yaml` and modify `SYNC_DAYS_BACK`.

### 4. Run Regular Sync (Daily/Incremental)

After initial sync, use regular sync for daily updates:

```bash
# Option 1: Use manual job file (1 day back)
kubectl apply -f k8s/manual-run-job.yaml -n leet-monitor

# Option 2: Create job from CronJob
kubectl create job --from=cronjob/people-analytics-sync people-analytics-sync-now -n leet-monitor

# Check logs
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100
```

### 4. Deploy CronJob (Runs Every Minute)

```bash
kubectl apply -f k8s/cronjob.yaml
```

## Common Commands

### Run Sync Manually

```bash
# Create a one-time job
kubectl create job --from=cronjob/people-analytics-sync people-analytics-sync-$(date +%s) -n leet-monitor

# Or use the manual job file
kubectl apply -f k8s/manual-run-job.yaml -n leet-monitor
```

### Check Status

```bash
# Check CronJob
kubectl get cronjob people-analytics-sync -n leet-monitor

# Check recent jobs
kubectl get jobs -l app=people-analytics-sync -n leet-monitor

# View logs
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100
```

### Change Schedule

Edit `k8s/cronjob.yaml` and change the schedule:
- `"* * * * *"` - Every minute (current)
- `"*/5 * * * *"` - Every 5 minutes
- `"*/15 * * * *"` - Every 15 minutes
- `"0 * * * *"` - Every hour

Then apply:
```bash
kubectl apply -f k8s/cronjob.yaml
```

## Troubleshooting

### Job Not Running

```bash
# Check CronJob status
kubectl describe cronjob people-analytics-sync -n leet-monitor

# Check if jobs are being created
kubectl get jobs -n leet-monitor
```

### Check Logs

```bash
# Latest job logs
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100

# Specific job logs
kubectl logs job/people-analytics-sync-<job-name> -n leet-monitor
```

### Verify Database

```bash
# Connect to database
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics

# Check records
SELECT COUNT(*) FROM people_analytics_records;
SELECT * FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;
```

