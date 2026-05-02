# People Analytics Sync Service

This service fetches people analytics data from Videoloft API and stores it in a PostgreSQL database. It can be deployed as a Kubernetes CronJob to run periodically.

## Architecture

- **Sync Service** (`sync_service.py`): Fetches data from Videoloft and stores it in the database
- **API Service** (`api_service.py`): REST API to query stored data
- **Database**: PostgreSQL (Digital Ocean managed database)

## Setup

### 1. Local Development

1. Install dependencies:
```bash
cd people-analytics-sync
pip install -r requirements.txt
```

2. Set up environment variables (copy `.env.example` to `.env` and fill in values):
```bash
cp .env.example .env
# Edit .env with your Digital Ocean database credentials
```

3. Initialize database:
```bash
python init_db.py
# Or: python -c "from models import init_database; init_database()"
```

4. Run sync manually:
```bash
python sync_service.py
```

5. Run API service:
```bash
python api_service.py
```

### 2. Docker Build

#### Build Sync Service Image

```bash
cd people-analytics-sync

# Build the image
docker build -t people-analytics-sync:latest .

# Tag for your registry (replace with your registry)
docker tag people-analytics-sync:latest your-registry/people-analytics-sync:latest

# Push to registry
docker push your-registry/people-analytics-sync:latest
```

#### Build API Service Image

```bash
cd people-analytics-sync

# Build the API image
docker build -f Dockerfile.api -t people-analytics-sync:api-latest .

# Tag for your registry
docker tag people-analytics-sync:api-latest your-registry/people-analytics-sync:api-latest

# Push to registry
docker push your-registry/people-analytics-sync:api-latest
```

#### Example: Using Docker Hub

```bash
# Login to Docker Hub
docker login

# Build and tag
docker build -t your-dockerhub-username/people-analytics-sync:latest .
docker build -f Dockerfile.api -t your-dockerhub-username/people-analytics-sync:api-latest .

# Push
docker push your-dockerhub-username/people-analytics-sync:latest
docker push your-dockerhub-username/people-analytics-sync:api-latest
```

#### Example: Using Private Registry (e.g., Digital Ocean Container Registry)

```bash
# Login to Digital Ocean registry
doctl registry login

# Build and tag with registry URL
docker build -t registry.digitalocean.com/your-registry/people-analytics-sync:latest .
docker build -f Dockerfile.api -t registry.digitalocean.com/your-registry/people-analytics-sync:api-latest .

# Push
docker push registry.digitalocean.com/your-registry/people-analytics-sync:latest
docker push registry.digitalocean.com/your-registry/people-analytics-sync:api-latest
```

### 3. Kubernetes Deployment

#### Prerequisites

- Kubernetes cluster configured
- `kubectl` configured to access your cluster
- Digital Ocean PostgreSQL database created and accessible

#### Step 1: Update Image References

Edit `k8s/cronjob.yaml` and `k8s/api-deployment.yaml` to use your image registry:

```yaml
# In cronjob.yaml, change:
image: your-registry/people-analytics-sync:latest

# In api-deployment.yaml, change:
image: your-registry/people-analytics-sync:api-latest
```

#### Step 2: Create Secrets

Create Kubernetes secrets with your database and Videoloft credentials:

```bash
kubectl create secret generic people-analytics-secrets \
  --from-literal=db-host=your-db-host.db.ondigitalocean.com \
  --from-literal=db-port=25060 \
  --from-literal=db-name=people_analytics \
  --from-literal=db-user=doadmin \
  --from-literal=db-password=YOUR_DB_PASSWORD \
  --from-literal=videoloft-email=YOUR_VIDEOLOFT_EMAIL \
  --from-literal=videoloft-password=YOUR_VIDEOLOFT_PASSWORD

# OR if using username instead of email:
# --from-literal=videoloft-username=YOUR_USERNAME \
```

**Note**: Digital Ocean databases typically use:
- Port: `25060` (SSL) or `25061` (non-SSL)
- User: Usually `doadmin` or your custom user
- Host: `your-db-name.db.ondigitalocean.com`

#### Step 3: Initialize Database

Before deploying, initialize the database schema. You can either:

**Option A: Run init script locally** (if you have network access to DB):
```bash
# Set environment variables
export DB_HOST=your-db-host.db.ondigitalocean.com
export DB_PORT=25060
export DB_NAME=people_analytics
export DB_USER=doadmin
export DB_PASSWORD=your-password

# Run init
python init_db.py
```

**Option B: Run init in a Kubernetes job**:
```bash
# Create a temporary job to initialize database
kubectl run db-init --image=your-registry/people-analytics-sync:latest \
  --restart=Never \
  --env="DB_HOST=your-db-host.db.ondigitalocean.com" \
  --env="DB_PORT=25060" \
  --env="DB_NAME=people_analytics" \
  --env="DB_USER=doadmin" \
  --env="DB_PASSWORD=your-password" \
  -- python init_db.py

# Check logs
kubectl logs db-init

# Clean up
kubectl delete pod db-init
```

#### Step 4: Run Initial Full Sync (Recommended)

For the first sync, fetch all available historical data:

```bash
# Run initial sync (fetches 365 days of historical data)
kubectl apply -f k8s/initial-sync-job.yaml -n leet-monitor

# Watch the job
kubectl get jobs -n leet-monitor -w

# Check logs
kubectl logs job/people-analytics-sync-initial -n leet-monitor -f
```

**Note**: 
- Initial sync fetches 365 days back by default
- This may take a while depending on data volume
- To change the number of days, edit `SYNC_DAYS_BACK` in `k8s/initial-sync-job.yaml`

After initial sync completes, proceed to deploy the CronJob for regular updates.

#### Step 5: Deploy CronJob

```bash
kubectl apply -f k8s/cronjob.yaml
```

Verify deployment:
```bash
kubectl get cronjobs -n leet-monitor
kubectl describe cronjob people-analytics-sync -n leet-monitor
```

**Note**: The CronJob is configured to run **every minute**. To change the schedule, edit `k8s/cronjob.yaml`:
- `"* * * * *"` - Every minute (current)
- `"*/5 * * * *"` - Every 5 minutes
- `"*/15 * * * *"` - Every 15 minutes
- `"0 * * * *"` - Every hour

#### Step 5: Deploy API Service

```bash
kubectl apply -f k8s/api-deployment.yaml
```

Verify deployment:
```bash
kubectl get deployments
kubectl get pods -l app=people-analytics-api
kubectl get svc people-analytics-api
```

#### Step 6: Test the Services

Test API service:
```bash
# Port forward to access API locally
kubectl port-forward svc/people-analytics-api 5000:80

# Test health endpoint
curl http://localhost:5000/health

# Test people analytics endpoint
curl "http://localhost:5000/api/people-analytics?start_date=2024-01-01&end_date=2024-01-31"
```

Check CronJob execution:
```bash
# List recent jobs
kubectl get jobs -l app=people-analytics-sync -n leet-monitor

# View logs of latest job
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100

# View logs of specific job
kubectl logs job/people-analytics-sync-<timestamp> -n leet-monitor

# Check CronJob status
kubectl get cronjob people-analytics-sync -n leet-monitor
kubectl describe cronjob people-analytics-sync -n leet-monitor
```

### Manual Execution

To run the sync manually at any time:

```bash
# Option 1: Create a manual job
kubectl apply -f k8s/manual-run-job.yaml -n leet-monitor

# Option 2: Create job from CronJob template
kubectl create job --from=cronjob/people-analytics-sync people-analytics-sync-$(date +%s) -n leet-monitor

# Check logs
kubectl logs -l app=people-analytics-sync -n leet-monitor --tail=100
```

## Configuration

### CronJob Schedule

Edit `k8s/cronjob.yaml` to change the schedule. Examples:
- `"0 * * * *"` - Every hour
- `"0 0 * * *"` - Daily at midnight
- `"*/30 * * * *"` - Every 30 minutes

### Environment Variables

**Database Configuration:**
- `DB_HOST`: Digital Ocean database host (e.g., `your-db.db.ondigitalocean.com`)
- `DB_PORT`: Database port (usually `25060` for SSL or `25061` for non-SSL)
- `DB_NAME`: Database name (default: `people_analytics`)
- `DB_USER`: Database user (usually `doadmin` for Digital Ocean)
- `DB_PASSWORD`: Database password

**Videoloft Configuration:**
- `VIDEOLOFT_EMAIL`: Your Videoloft account email
- `VIDEOLOFT_PASSWORD`: Your Videoloft account password

**Sync Configuration:**
- `SYNC_DAYS_BACK`: Number of days back to fetch (default: 1)
- `SYNC_INTERVAL`: Time interval - 'date', 'hour', or '60000' (default: 'date')
- `SYNC_UIDDS`: Optional comma-separated device IDs (leave empty to sync all cameras)
- `TIMEZONE`: Timezone for data (default: 'Asia/Kuwait')

**API Configuration:**
- `API_PORT`: Port for API service (default: 5000)
- `DEBUG`: Enable debug mode (default: false)

## API Endpoints

### GET /health
Health check endpoint

### GET /api/people-analytics
Get people analytics data

Query parameters:
- `uidds`: Comma-separated device IDs
- `start_date`: Start date (YYYY-MM-DD)
- `end_date`: End date (YYYY-MM-DD)
- `interval`: Time interval ('date', 'hour', '60000')
- `limit`: Maximum records (default: 1000)

Example:
```
GET /api/people-analytics?uidds=1382465.6&start_date=2024-01-01&end_date=2024-01-31&interval=date
```

### GET /api/sync-status
Get status of recent sync operations

### GET /api/cameras
Get list of available cameras/devices

## Database Schema

### people_analytics_records
Stores people analytics data with:
- Device information (uidd, device_id)
- Timestamps (first_timestamp, last_timestamp)
- People counts (people_in, people_out, net_traffic)
- Calculated metrics (traffic_ratio, traffic_pattern, etc.)
- Raw JSON data

### sync_logs
Tracks sync operations with:
- Start/end times
- Status (success/failed/partial)
- Number of records synced
- Error messages

## Monitoring

Check CronJob status:
```bash
kubectl get cronjobs
kubectl get jobs
kubectl logs -l app=people-analytics-sync
```

Check API service:
```bash
kubectl get pods -l app=people-analytics-api
kubectl logs -l app=people-analytics-api
```

## Next Steps

After deploying this service, you can modify the frontend `people-analytics.js` to query the API service instead of directly calling Videoloft. The API endpoint `/api/people-analytics` returns data in a compatible format.

