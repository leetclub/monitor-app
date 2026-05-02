# Check and Fix Kubernetes Secret

## Issue
The API is using port 5432 instead of 25060, which means the secret might not have `db-port` set correctly.

## Check Current Secret

```bash
# View secret (values are base64 encoded)
kubectl get secret people-analytics-secrets -n leet-monitor -o yaml

# Decode and view values
kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d
echo ""
kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d
echo ""
```

## Fix Secret - Add/Update db-port

### Option 1: Patch the Secret

```bash
# Update db-port to 25060
kubectl patch secret people-analytics-secrets -n leet-monitor \
  --type='json' \
  -p='[{"op": "add", "path": "/data/db-port", "value": "'$(echo -n "25060" | base64)'"}]'
```

### Option 2: Delete and Recreate Secret

```bash
# Delete old secret
kubectl delete secret people-analytics-secrets -n leet-monitor

# Create new secret with all values including db-port
kubectl create secret generic people-analytics-secrets -n leet-monitor \
  --from-literal=db-host=db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
  --from-literal=db-port=25060 \
  --from-literal=db-name=people_analytics \
  --from-literal=db-user=doadmin \
  --from-literal=db-password=YOUR_PASSWORD \
  --from-literal=videoloft-email=YOUR_EMAIL \
  --from-literal=videoloft-password=YOUR_PASSWORD
```

## Restart API Pods

After updating the secret, restart the API pods to pick up the new environment variables:

```bash
kubectl rollout restart deployment people-analytics-api -n leet-monitor

# Check logs to verify
kubectl logs -f deployment/people-analytics-api -n leet-monitor
```

## Verify

Check the logs to confirm it's using port 25060:

```bash
kubectl logs -l app=people-analytics-api -n leet-monitor | grep "Connecting to database"
```

Should show: `:25060/people_analytics?sslmode=require`

