# Historical Performance Sync

This service caches historical performance data from Vendon API in a PostgreSQL database to speed up the Historical Performance tab in the monitoring app.

## Structure

- **Separate directory**: `historical-performance-sync/` (independent from `vendon-sync/`)
- **Separate API**: `historical-api.theleetclub.com` (port 5002)
- **Separate cron job**: Runs daily at 3 AM UTC

## Components

1. **Sync Service** (`sync_service.py`): Fetches data from Vendon API and stores aggregated results
2. **API Service** (`api_service.py`): Serves cached data via REST API
3. **Database Models** (`models.py`): SQLAlchemy models for data storage
4. **Kubernetes Manifests**: CronJob, Deployment, Service, and Ingress

## Database Schema

- `historical_performance_records`: Stores aggregated data per machine/date range
- `historical_performance_sync_logs`: Tracks sync operations

## Setup

1. **Create database tables**:
   ```bash
   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/init_historical_performance_table.sql
   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f migrations/add_historical_performance_sync_logs_table.sql
   ```

2. **Build and push Docker images**:
   ```bash
   # Sync service image
   docker build -f Dockerfile -t programmeradmin25/historical-performance-sync:latest .
   docker push programmeradmin25/historical-performance-sync:latest
   
   # API service image
   docker build -f Dockerfile.api -t programmeradmin25/historical-performance-api:latest .
   docker push programmeradmin25/historical-performance-api:latest
   ```

3. **Deploy to Kubernetes**:
   ```bash
   kubectl apply -f k8s/cronjob.yaml
   kubectl apply -f k8s/api-deployment.yaml
   kubectl apply -f k8s/api-ingress.yaml
   ```

4. **Add DNS record**: Point `historical-api.theleetclub.com` to your Kubernetes ingress

## API Endpoints

- `GET /health`: Health check
- `GET /api/historical-performance?machine_id={id}&start_date={date}&end_date={date}`: Get cached data
- `GET /api/historical-performance/best-yesterday?exclude_ids={ids}`: Get best machine from yesterday (for preload)

## Frontend Integration

The frontend automatically tries the cached API first, then falls back to direct Vendon API if cache misses. No configuration needed - it uses `https://historical-api.theleetclub.com` by default.

## Performance

- **Before**: 30-60 seconds to load historical data (direct Vendon API calls with pagination)
- **After**: < 1 second (cached database query)

