# Vendon Sales Sync Service

This service syncs daily sales data from the Vendon API to the database to speed up the targets tab, especially the "PRELOAD LOWEST PERFORMING MACHINE YESTERDAY" feature.

## Overview

The system consists of:
1. **Database Table**: Stores daily sales data per machine (`vendon_sales_records`)
2. **Sync Service**: Fetches data from Vendon API and stores it in the database
3. **API Endpoints**: Query cached data quickly (endpoints are in `people-analytics-sync/api_service.py`)

## Setup

### 1. Create Database Table

Run the migration script:

```bash
# In WSL shell (psql without password)
psql -h localhost -U postgres -d people_analytics -f migrations/init_vendon_sales_table.sql
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

```bash
export VENDON_API_KEY="your-vendon-api-key"
export DB_HOST="your-db-host"
export DB_PORT="5432"
export DB_NAME="people_analytics"
export DB_USER="postgres"
export DB_PASSWORD="your-password"
```

### 4. Run Sync Manually

```bash
# Sync yesterday's data
python sync_service.py

# Sync specific date
VENDON_SYNC_TARGET_DATE=2025-01-15 python sync_service.py

# Sync last 7 days
VENDON_SYNC_DAYS_BACK=7 python sync_service.py
```

### 5. Deploy CronJob

```bash
kubectl apply -f k8s/cronjob.yaml
```

The cronjob runs daily at 2 AM UTC (5 AM Kuwait time) to sync yesterday's data.

## API Endpoints

The API endpoints are served by the people-analytics API service:

- `GET /api/vendon-sales/lowest-yesterday` - Get lowest performing machine from yesterday
- `GET /api/vendon-sales` - Query sales data by date/machine

See `people-analytics-sync/api_service.py` for endpoint details.

## Performance

**Before (scanning all machines):**
- Time: 30-60 seconds
- API calls: 1 per machine (e.g., 150 machines = 150 API calls)

**After (using cache):**
- Time: < 1 second
- API calls: 1 database query

## Structure

```
vendon-sync/
├── models.py              # Database models
├── sync_service.py        # Sync service
├── requirements.txt       # Python dependencies
├── migrations/
│   └── init_vendon_sales_table.sql
├── k8s/
│   └── cronjob.yaml      # Kubernetes cronjob
└── README.md
```



