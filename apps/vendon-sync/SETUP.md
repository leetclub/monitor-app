# Vendon Sales Sync Setup Guide

This guide explains how to set up the Vendon sales data caching system to speed up the targets tab.

## Overview

The system consists of:
1. **Database Table**: Stores daily sales data per machine (`vendon_sales_records`)
2. **Sync Service**: Fetches data from Vendon API and stores it in the database
3. **API Endpoints**: Query cached data quickly (endpoints are in `people-analytics-sync/api_service.py`)

## Setup Steps

### 1. Create Database Table

Run the migration script:

```bash
# In WSL shell (psql without password)
psql -h localhost -U postgres -d people_analytics -f migrations/init_vendon_sales_table.sql
```

### 2. Add Vendon API Key to Kubernetes Secrets

Update your Kubernetes secrets:

```bash
kubectl patch secret people-analytics-secrets -n leet-monitor --type='json' \
  -p='[{"op": "add", "path": "/data/vendon-api-key", "value": "'$(echo -n '7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD' | base64)'"}]'
```

### 3. Deploy the CronJob

```bash
kubectl apply -f k8s/cronjob.yaml
```

The cronjob runs daily at 2 AM UTC (5 AM Kuwait time) to sync yesterday's data.

### 4. Manual Sync (Optional)

```bash
# Sync yesterday's data
python sync_service.py

# Sync specific date
VENDON_SYNC_TARGET_DATE=2025-01-15 python sync_service.py
```

### 5. Verify Setup

```bash
# Get lowest machine from yesterday
curl "https://people-api.theleetclub.com/api/vendon-sales/lowest-yesterday"
```

## API Endpoints

The API endpoints are served by the people-analytics API service:

- `GET /api/vendon-sales/lowest-yesterday` - Get lowest performing machine from yesterday
- `GET /api/vendon-sales` - Query sales data by date/machine

## Performance

**Before**: 30-60 seconds, 150+ API calls  
**After**: < 1 second, 1 database query



