# What's Needed to Make Targets Tab Read from Database

## Current Status

✅ **Database**: Tables created and data synced (37 machines)
✅ **Frontend Code**: Updated to call cached API (`fetchLowestMachineYesterdayFromCache`)
✅ **API Code**: Endpoints added to `people-analytics-sync/api_service.py`
✅ **Models**: `VendonSalesRecord` added to `people-analytics-sync/models.py`
⏳ **API Deployment**: Needs Docker image rebuild

## What's Missing

The API service Docker image needs to be rebuilt with the updated code that includes the Vendon endpoints.

## Steps to Complete

### 1. Rebuild Docker Image

```bash
cd people-analytics-sync
docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest .
docker push programmeradmin25/people-analytics-sync:api-latest
```

### 2. Restart Deployment (Already Done)

The deployment was already restarted, but it will use the new image once it's pushed.

### 3. Verify

```bash
# Test the endpoint
curl "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday"

# Should return JSON with lowestMachine data
```

## Alternative: Quick Test Without Rebuilding

If you want to test immediately without rebuilding, you can exec into a pod and manually update the code:

```bash
# Get a pod name
POD=$(kubectl get pods -n leet-monitor -l app=people-analytics-api -o jsonpath='{.items[0].metadata.name}')

# Copy updated files into the pod
kubectl cp people-analytics-sync/api_service.py leet-monitor/$POD:/app/api_service.py
kubectl cp people-analytics-sync/models.py leet-monitor/$POD:/app/models.py

# Restart the container (or the pod will restart automatically)
kubectl delete pod $POD -n leet-monitor
```

But this is temporary - the proper solution is to rebuild the image.

## Summary

**Everything is ready except the Docker image needs to be rebuilt with the new code.**

Once the image is rebuilt and pushed, the targets tab will automatically use the cached database instead of scanning all machines!


