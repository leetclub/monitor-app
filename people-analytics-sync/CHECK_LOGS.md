# How to Check CronJob Logs

## Check CronJob Status

```bash
# View CronJob
kubectl get cronjob people-analytics-sync -n leet-monitor

# Get detailed info
kubectl describe cronjob people-analytics-sync -n leet-monitor
```

## View Recent Jobs

```bash
# List all jobs created by the CronJob
kubectl get jobs -l app=people-analytics-sync -n leet-monitor

# List with timestamps
kubectl get jobs -l app=people-analytics-sync -n leet-monitor --sort-by=.metadata.creationTimestamp
```

## View Logs

### Latest Job Logs

```bash
# Get logs from the most recent job
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100

# Follow logs in real-time
kubectl logs -f -l app=people-analytics-sync -n leet-monitor
```

### Specific Job Logs

```bash
# List jobs to get the job name
kubectl get jobs -l app=people-analytics-sync -n leet-monitor

# View logs for a specific job (replace <job-name> with actual name)
kubectl logs job/<job-name> -n leet-monitor

# Example:
kubectl logs job/people-analytics-sync-28451234 -n leet-monitor
```

### Last N Jobs Logs

```bash
# Get logs from last 5 jobs
for job in $(kubectl get jobs -l app=people-analytics-sync -n leet-monitor --sort-by=.metadata.creationTimestamp -o name | tail -5); do
  echo "=== $job ==="
  kubectl logs $job -n leet-monitor --tail=20
  echo ""
done
```

## Monitor in Real-Time

```bash
# Watch jobs being created
watch -n 5 'kubectl get jobs -l app=people-analytics-sync -n leet-monitor'

# Follow latest logs continuously
kubectl logs -f -l app=people-analytics-sync -n leet-monitor --tail=50
```

## Check for Errors

```bash
# Filter for errors only
kubectl logs -l app=people-analytics-sync -n leet-monitor | grep -i error

# Check failed jobs
kubectl get jobs -l app=people-analytics-sync -n leet-monitor | grep -i failed

# View logs of failed jobs
kubectl get jobs -l app=people-analytics-sync -n leet-monitor -o json | \
  jq -r '.items[] | select(.status.failed > 0) | .metadata.name' | \
  xargs -I {} kubectl logs job/{} -n leet-monitor
```

## Check Sync Status in Database

```bash
# Connect to database
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics

# View recent sync logs
SELECT 
    id,
    sync_started_at,
    sync_completed_at,
    status,
    records_synced,
    error_message
FROM sync_logs
ORDER BY sync_started_at DESC
LIMIT 10;

# Check record counts
SELECT COUNT(*) as total_records FROM people_analytics_records;
SELECT DATE(first_timestamp) as date, COUNT(*) as records 
FROM people_analytics_records 
GROUP BY DATE(first_timestamp) 
ORDER BY date DESC 
LIMIT 10;
```

## Quick Status Check

```bash
# One-liner to see latest sync status
kubectl get jobs -l app=people-analytics-sync -n leet-monitor --sort-by=.metadata.creationTimestamp | tail -1 | awk '{print $1}' | xargs -I {} kubectl logs job/{} -n leet-monitor --tail=10
```

