# Historical Performance Sync - Deployment Instructions

## ✅ Completed Steps

1. **Database tables created** ✓
   - `historical_performance_records` table created
   - `historical_performance_sync_logs` table created

2. **Kubernetes resources deployed** ✓
   - CronJob: `historical-performance-sync` (scheduled for 3 AM UTC daily)
   - Deployment: `historical-performance-api` (2 replicas)
   - Service: `historical-performance-api`
   - Ingress: `historical-performance-api-ingress` (exposed at `historical-api.theleetclub.com`)

## 🔨 Remaining Steps

### Step 1: Build and Push Docker Images

You need to build and push the Docker images. Run this script (requires Docker and Docker Hub access):

```bash
cd historical-performance-sync
./build-and-push.sh
```

Or manually:

```bash
# Build sync service
docker build -f Dockerfile -t programmeradmin25/historical-performance-sync:latest .
docker push programmeradmin25/historical-performance-sync:latest

# Build API service
docker build -f Dockerfile.api -t programmeradmin25/historical-performance-api:latest .
docker push programmeradmin25/historical-performance-api:latest
```

### Step 2: Add DNS Record

Add a DNS A record pointing `historical-api.theleetclub.com` to your Kubernetes ingress IP address.

To get the ingress IP:
```bash
kubectl get ingress historical-performance-api-ingress -n leet-monitor
```

### Step 3: Verify Deployment

After images are pushed, check pod status:

```bash
kubectl get pods -n leet-monitor -l app=historical-performance-api
kubectl logs -n leet-monitor -l app=historical-performance-api --tail=50
```

### Step 4: Test API

Once pods are running, test the API:

```bash
curl https://historical-api.theleetclub.com/health
```

### Step 5: Trigger Initial Sync (Optional)

To populate data immediately instead of waiting for the cron job:

```bash
kubectl create job --from=cronjob/historical-performance-sync historical-performance-sync-manual-$(date +%s) -n leet-monitor
```

Monitor the job:
```bash
kubectl get jobs -n leet-monitor -l app=historical-performance-sync
kubectl logs -n leet-monitor -l job-name=<job-name> --tail=50
```

## 📊 Current Status

- **Database**: ✅ Tables created
- **Kubernetes**: ✅ Resources deployed (waiting for Docker images)
- **Docker Images**: ⏳ Need to be built and pushed
- **DNS**: ⏳ Need to add A record for `historical-api.theleetclub.com`

## 🎯 Expected Behavior

Once images are pushed:
1. API pods will start and become ready
2. CronJob will run daily at 3 AM UTC to sync last 30 days of data
3. Frontend will automatically use cached API (falls back to direct Vendon API if cache misses)
4. Historical Performance tab preload should be much faster (< 1 second vs 30-60 seconds)

