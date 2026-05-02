# Deploy Vendon API Endpoints

The Vendon API endpoints have been added to `people-analytics-sync/api_service.py`, but the API service needs to be rebuilt and redeployed.

## Option 1: Rebuild Docker Image (Recommended)

1. Build the new API image:
```bash
cd people-analytics-sync
docker build -f Dockerfile.api -t programmeradmin25/people-analytics-sync:api-latest .
docker push programmeradmin25/people-analytics-sync:api-latest
```

2. Restart the deployment to pull the new image:
```bash
kubectl rollout restart deployment people-analytics-api -n leet-monitor
```

## Option 2: Use ConfigMap (Quick Test)

If you want to test without rebuilding the image, you can inject the updated code via ConfigMap:

```bash
# Create ConfigMap with updated API code
kubectl create configmap people-api-code \
  --from-file=api_service.py=people-analytics-sync/api_service.py \
  --from-file=models.py=people-analytics-sync/models.py \
  -n leet-monitor --dry-run=client -o yaml | kubectl apply -f -

# Update deployment to mount ConfigMap (requires modifying deployment YAML)
```

## Verify Endpoints

After deployment, test the endpoints:

```bash
# Test lowest machine endpoint
curl "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday"

# Test general sales endpoint
curl "https://people-api.theleetclub.com/api/vendon-sales?date=$(date -d yesterday +%Y-%m-%d)"
```

## Current Status

✅ Code updated: `people-analytics-sync/api_service.py` has Vendon endpoints
✅ Models added: `VendonSalesRecord` added to `people-analytics-sync/models.py`
✅ Frontend ready: `analytics-tab.js` has `fetchLowestMachineYesterdayFromCache()`
⏳ Pending: API service needs to be rebuilt and redeployed


