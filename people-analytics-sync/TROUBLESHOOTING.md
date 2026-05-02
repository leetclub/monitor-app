# Troubleshooting Guide

## Database Connection Issues

### Connection Timeout

**Symptoms:**
```
connection to server at "..." port 5432 failed: Connection timed out
```

**Solutions:**

1. **Check Port**: Digital Ocean databases use port `25060` (SSL) or `25061` (non-SSL), not `5432`
   ```bash
   # Verify in secrets
   kubectl get secret people-analytics-secrets -n leet-monitor -o yaml
   
   # Should be:
   # db-port: 25060
   ```

2. **Update Secrets** (if port is wrong):
   ```bash
   kubectl delete secret people-analytics-secrets -n leet-monitor
   
   kubectl create secret generic people-analytics-secrets -n leet-monitor \
     --from-literal=db-host=your-db-host.db.ondigitalocean.com \
     --from-literal=db-port=25060 \
     --from-literal=db-name=people_analytics \
     --from-literal=db-user=doadmin \
     --from-literal=db-password=YOUR_PASSWORD \
     --from-literal=videoloft-email=YOUR_EMAIL \
     --from-literal=videoloft-password=YOUR_PASSWORD
   ```

3. **Check Firewall Rules**: Ensure your Kubernetes cluster IPs are whitelisted in Digital Ocean database settings
   - Go to Digital Ocean Dashboard → Databases → Your Database → Settings → Trusted Sources
   - Add your Kubernetes cluster IPs or allow all sources for testing

4. **Test Connection from Pod**:
   ```bash
   # Run a test pod
   kubectl run -it --rm psql-test --image=postgres:15-alpine --restart=Never -n leet-monitor -- \
     psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics
   ```

### SSL Connection Issues

**Symptoms:**
```
SSL connection required
```

**Solution:**
- Port 25060 requires SSL (already configured in code)
- Make sure you're using port 25060, not 5432

### No Data Synced

**Check Logs:**
```bash
# Get latest job logs
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=200

# Check for errors
kubectl logs -l app=people-analytics-sync -n leet-monitor | grep ERROR
```

**Common Issues:**

1. **Authentication Failed**:
   ```
   Authentication failed with status 401
   ```
   - Check Videoloft credentials in secrets
   - Verify email/username and password are correct

2. **No Cameras Found**:
   ```
   No cameras found
   ```
   - Check if Videoloft account has cameras configured
   - Verify authentication is working

3. **No Data from Videoloft**:
   ```
   No data received from Videoloft
   ```
   - Check date range (SYNC_DAYS_BACK)
   - Verify cameras have data for the time period

### Check Database

```bash
# Connect to database
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics

# Check sync logs
SELECT * FROM sync_logs ORDER BY sync_started_at DESC LIMIT 10;

# Check records
SELECT COUNT(*) FROM people_analytics_records;
SELECT * FROM people_analytics_records ORDER BY first_timestamp DESC LIMIT 10;
```

### Debug Steps

1. **Check Job Status**:
   ```bash
   kubectl get jobs -n leet-monitor -l app=people-analytics-sync
   kubectl describe job <job-name> -n leet-monitor
   ```

2. **Check Pod Logs**:
   ```bash
   kubectl get pods -n leet-monitor -l app=people-analytics-sync
   kubectl logs <pod-name> -n leet-monitor
   ```

3. **Run Manual Job with Debug**:
   ```bash
   # Edit manual-run-job.yaml to add DEBUG env var
   # Or create job with debug
   kubectl create job --from=cronjob/people-analytics-sync test-sync -n leet-monitor
   kubectl set env job/test-sync DEBUG=true -n leet-monitor
   kubectl logs job/test-sync -n leet-monitor
   ```

4. **Test Database Connection**:
   ```bash
   # From a pod
   kubectl run -it --rm db-test --image=postgres:15-alpine --restart=Never -n leet-monitor -- \
     psql "postgresql://doadmin:$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)@$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d):25060/people_analytics?sslmode=require"
   ```

## CronJob Not Running

**Check CronJob Status**:
```bash
kubectl get cronjob people-analytics-sync -n leet-monitor
kubectl describe cronjob people-analytics-sync -n leet-monitor
```

**Check if Jobs are Created**:
```bash
kubectl get jobs -n leet-monitor -l app=people-analytics-sync
```

**Common Issues:**
- CronJob suspended: `kubectl patch cronjob people-analytics-sync -p '{"spec":{"suspend":false}}' -n leet-monitor`
- Wrong schedule format
- Resource limits too low

## API Service Issues

**Check API Service**:
```bash
kubectl get pods -l app=people-analytics-api -n leet-monitor
kubectl logs -l app=people-analytics-api -n leet-monitor
```

**Test API**:
```bash
# Port forward
kubectl port-forward svc/people-analytics-api 5000:80 -n leet-monitor

# Test
curl http://localhost:5000/health
curl "http://localhost:5000/api/people-analytics?start_date=2024-01-01&end_date=2024-01-31"
```

