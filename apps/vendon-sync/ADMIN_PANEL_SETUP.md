# Admin Panel Setup Guide

## Overview

The Admin Panel provides:
- **Authentication**: Username/password login
- **Alerts & Logs**: View all alerts from sync/verification jobs
- **Verification Results**: View sync verification results comparing DB vs Vendon API

## Setup Steps

### 1. Add Secrets to Kubernetes

Add the following secrets to `people-analytics-secrets`:

```bash
kubectl create secret generic people-analytics-secrets \
  --from-literal=admin-secret-key='<generate-random-key>' \
  --from-literal=admin-api-key='<generate-random-key>' \
  --from-literal=admin-username='admin' \
  --from-literal=admin-password='<strong-password>' \
  -n leet-monitor \
  --dry-run=client -o yaml | kubectl apply -f -
```

Or update existing secret:
```bash
kubectl create secret generic people-analytics-secrets \
  --from-literal=admin-secret-key='<random-key>' \
  --from-literal=admin-api-key='<random-key>' \
  --from-literal=admin-username='admin' \
  --from-literal=admin-password='<password>' \
  -n leet-monitor \
  --dry-run=client -o yaml | kubectl apply -f -
```

Generate random keys:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Build and Push Docker Image

```bash
cd vendon-sync
docker build -f Dockerfile.admin -t programmeradmin25/vendon-admin-panel:latest .
docker push programmeradmin25/vendon-admin-panel:latest
```

### 3. Deploy Admin Panel

```bash
kubectl apply -f k8s/admin-deployment.yaml
```

### 4. Create Ingress (Optional - for external access)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: admin-panel-ingress
  namespace: leet-monitor
spec:
  rules:
  - host: admin.theleetclub.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: admin-api-service
            port:
              number: 5002
```

### 5. Verify Deployment

```bash
# Check pods
kubectl get pods -n leet-monitor | grep admin-panel

# Check logs
kubectl logs -n leet-monitor deployment/admin-panel-api

# Port forward to test locally
kubectl port-forward -n leet-monitor svc/admin-api-service 5002:5002
```

Then access: http://localhost:5002

## How It Works

### Verification Flow

1. **Sync Job** runs at 2 AM UTC
   - Syncs yesterday's data
   - Logs any critical errors to admin panel

2. **Verification Job** runs at 2:30 AM UTC
   - Compares DB vs Vendon API
   - Sends results to admin panel
   - Creates alerts for failures

3. **Admin Panel** displays:
   - All alerts (info, warning, error, critical)
   - Verification results with pass/fail status
   - Detailed error messages

### API Endpoints

- `POST /api/admin/login` - Login
- `POST /api/admin/logout` - Logout
- `GET /api/admin/alerts` - Get alerts (requires auth)
- `GET /api/admin/verification-results` - Get verification results (requires auth)
- `POST /api/admin/receive-alert` - Receive alert from jobs (uses API key)
- `POST /api/admin/receive-verification` - Receive verification results (uses API key)

## Default Credentials

- **Username**: Set via `ADMIN_USERNAME` env var (default: `admin`)
- **Password**: Set via `ADMIN_PASSWORD` env var (default: `admin123`)

**⚠️ Change default password in production!**

## Monitoring

The admin panel auto-refreshes every 30 seconds to show new alerts and verification results.

## Troubleshooting

### Can't login
- Check if admin user was created in database
- Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set correctly
- Check pod logs for errors

### No alerts showing
- Verify verification cronjob has `ADMIN_API_URL` and `ADMIN_API_KEY` set
- Check verification job logs
- Verify admin API is accessible from verification pods

### Verification results not appearing
- Check verification job completed successfully
- Verify `ADMIN_API_URL` points to correct service
- Check admin API logs for incoming requests
