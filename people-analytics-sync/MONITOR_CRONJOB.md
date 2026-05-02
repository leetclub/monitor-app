# How to Monitor CronJob and Verify Data

## 1. Check CronJob Status

### View CronJob Information
```bash
# List all cronjobs
kubectl get cronjobs -n leet-monitor

# Get detailed info about the cronjob
kubectl describe cronjob people-analytics-sync -n leet-monitor

# Check schedule
kubectl get cronjob people-analytics-sync -n leet-monitor -o jsonpath='{.spec.schedule}'
# Should show: "* * * * *" (every minute)
```

### Check Recent Jobs Created by CronJob
```bash
# List jobs created by the cronjob
kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp

# See last 5 jobs
kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp | tail -6
```

### Check Job Status
```bash
# Get latest job
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')

# Check job status
kubectl get job $LATEST_JOB -n leet-monitor

# Describe job (shows events and pod status)
kubectl describe job $LATEST_JOB -n leet-monitor
```

## 2. Check Pod Logs

### View Logs from Latest Job
```bash
# Get pods from latest job
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}')
POD_NAME=$(kubectl get pods -n leet-monitor -l job-name=$LATEST_JOB -o jsonpath='{.items[0].metadata.name}')

# View logs
kubectl logs $POD_NAME -n leet-monitor

# Follow logs in real-time
kubectl logs -f $POD_NAME -n leet-monitor
```

### View Logs from All Recent Jobs
```bash
# View logs from all pods with the label
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=50

# View logs from last 10 jobs
for job in $(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-10:].metadata.name}'); do
    echo "=== Job: $job ==="
    kubectl logs -l job-name=$job -n leet-monitor --tail=20
    echo ""
done
```

### Check for Errors
```bash
# Search logs for errors
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=1000 | grep -i "error\|failed\|exception"

# Search for success messages
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=1000 | grep -i "success\|synced"
```

## 3. Verify Data in Database

### Check Recent Syncs
```bash
# Connect to database and check sync logs
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT id, sync_started_at, sync_completed_at, status, records_synced, error_message FROM sync_logs ORDER BY sync_started_at DESC LIMIT 10;"
```

### Check Data Freshness
```bash
# Check when data was last synced
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT MAX(synced_at) as last_sync, COUNT(*) as total_records, COUNT(DISTINCT uidd) as unique_devices FROM people_analytics_records;"
```

### Check Today's Data
```bash
# Count records synced today
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT DATE(synced_at) as sync_date, COUNT(*) as records, COUNT(DISTINCT uidd) as devices FROM people_analytics_records WHERE synced_at >= CURRENT_DATE GROUP BY DATE(synced_at) ORDER BY sync_date DESC;"
```

### Check for Recent Data by Device
```bash
# See latest data per device
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT uidd, MAX(synced_at) as last_sync, COUNT(*) as record_count, SUM(people_in) as total_in, SUM(people_out) as total_out FROM people_analytics_records WHERE synced_at >= CURRENT_DATE GROUP BY uidd ORDER BY last_sync DESC LIMIT 20;"
```

## 4. Verify Data Correctness

### Check for Duplicates
```bash
# Quick duplicate check
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as duplicates FROM people_analytics_records;"
# Should return 0
```

### Verify Data Quality
```bash
# Check for null or invalid data
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT COUNT(*) as null_uidd, COUNT(*) FILTER (WHERE people_in < 0) as negative_in, COUNT(*) FILTER (WHERE people_out < 0) as negative_out FROM people_analytics_records WHERE uidd IS NULL OR people_in < 0 OR people_out < 0;"
```

### Check Sync Success Rate
```bash
# Check sync success/failure rate
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT status, COUNT(*) as count, AVG(records_synced) as avg_records FROM sync_logs WHERE sync_started_at >= CURRENT_DATE GROUP BY status;"
```

## 5. Test API Endpoint

### Check API Health
```bash
curl https://people-api.theleetclub.com/health
```

### Test Data Retrieval
```bash
# Get today's data
curl "https://people-api.theleetclub.com/api/people-analytics?start_date=$(date +%Y-%m-%d)&end_date=$(date +%Y-%m-%d)" | jq '.summary'

# Get data for specific device
curl "https://people-api.theleetclub.com/api/people-analytics?uidds=1382465.21&start_date=$(date +%Y-%m-%d)&end_date=$(date +%Y-%m-%d)" | jq '.data | length'
```

## 6. Quick Health Check Script

Create a simple script to check everything:

```bash
#!/bin/bash
# health_check.sh

echo "=== CronJob Status ==="
kubectl get cronjob people-analytics-sync -n leet-monitor

echo -e "\n=== Latest Job ==="
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
if [ -n "$LATEST_JOB" ]; then
    kubectl get job $LATEST_JOB -n leet-monitor
    echo -e "\n=== Latest Job Logs (last 20 lines) ==="
    POD_NAME=$(kubectl get pods -n leet-monitor -l job-name=$LATEST_JOB -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$POD_NAME" ]; then
        kubectl logs $POD_NAME -n leet-monitor --tail=20
    fi
else
    echo "No jobs found"
fi

echo -e "\n=== Database Status ==="
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT MAX(synced_at) as last_sync, COUNT(*) as total_records FROM people_analytics_records;" 2>/dev/null

echo -e "\n=== Recent Syncs ==="
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT status, sync_started_at, records_synced FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;" 2>/dev/null
```

## 7. Common Issues and Solutions

### Issue: CronJob not creating jobs
```bash
# Check if CronJob is suspended
kubectl get cronjob people-analytics-sync -n leet-monitor -o jsonpath='{.spec.suspend}'
# Should be false or empty

# Check CronJob events
kubectl describe cronjob people-analytics-sync -n leet-monitor | grep -A 10 Events
```

### Issue: Jobs failing
```bash
# Check failed jobs
kubectl get jobs -n leet-monitor -l app=people-analytics-sync | grep -i fail

# Check pod status
kubectl get pods -n leet-monitor -l app=people-analytics-sync | grep -v Running
```

### Issue: No data being synced
```bash
# Check logs for authentication errors
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100 | grep -i "auth\|token\|login"

# Check database connection
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100 | grep -i "database\|connection\|postgres"
```

## 8. Monitoring Dashboard (Optional)

You can set up continuous monitoring with:

```bash
# Watch CronJob in real-time
watch -n 5 'kubectl get cronjobs,jobs,pods -n leet-monitor -l app=people-analytics-sync'

# Monitor logs continuously
kubectl logs -f -l app=people-analytics-sync -n leet-monitor
```

