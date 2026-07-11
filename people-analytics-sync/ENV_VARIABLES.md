# Environment Variables Reference

## Required Environment Variables

### Database Configuration (Digital Ocean)

```bash
DB_HOST=your-db-host.db.ondigitalocean.com
DB_PORT=25060
DB_NAME=people_analytics
DB_USER=doadmin
DB_PASSWORD=your-digitalocean-db-password
```

**Note**: Digital Ocean databases typically use:
- Port: `25060` (SSL) or `25061` (non-SSL)
- User: Usually `doadmin` or your custom user
- Host: Format is `your-db-name.db.ondigitalocean.com`

### Videoloft API Configuration

```bash
# Use email (recommended)
VIDEOLOFT_EMAIL=your-email@example.com
VIDEOLOFT_PASSWORD=your-password

# OR use username if your account uses username instead of email
VIDEOLOFT_USERNAME=your-username
VIDEOLOFT_PASSWORD=your-password
```

**Note**: The Videoloft API accepts either email or username in the `email` field. You can use either `VIDEOLOFT_EMAIL` or `VIDEOLOFT_USERNAME` - both will work.

## Optional Environment Variables

### Sync Configuration

```bash
SYNC_DAYS_BACK=0              # 0 = live window (use SYNC_LIVE_DAYS); >0 = backfill last N days
SYNC_LIVE_DAYS=14             # Live cron: rolling Kuwait calendar days (default 2 in older docs)
SYNC_INTERVAL=hour            # Live cron: 'hour' (also set SYNC_ALSO_DATE=1 for daily buckets)
SYNC_CHUNK_DAYS=1             # Split long ranges into N-day Videoloft requests
SYNC_CHUNK_MIN_DAYS=1         # When span >= this, enable time chunking (hourly)
SYNC_PER_DEVICE=1             # 1 = one API call per camera (required; avoids ~100-row cap)
SYNC_ALSO_DATE=1              # After hourly sync, also upsert daily (date) buckets
SYNC_UIDDS=                   # Optional: comma-separated device IDs; empty = all cameras
TIMEZONE=Asia/Kuwait          # Timezone for data (default: 'Asia/Kuwait')
```

### API Configuration

```bash
API_PORT=5000                 # Port for API service (default: 5000)
DEBUG=false                   # Enable debug mode (default: false)
```

### Leet Task Manager / Workflow (Alert ops columns)

```bash
LEET_WORKFLOW_API_BASE=https://workflow.theleetclub.com
LEET_WORKFLOW_API_KEY=your-shared-api-key
LEET_WORKFLOW_API_TIMEOUT_SEC=30
LEET_WORKFLOW_CLEANING_DAYS_BACK=7
```

Used by Alert **`/api/alert/workflow/*`** routes (operator schedule, attendance map). Auth matches Task Manager docs: `X-Api-Key` header. Do **not** commit the key to git — set in k8s secret `people-analytics-secrets` key `leet-workflow-api-key`.

## Example .env File

Create a `.env` file in the `people-analytics-sync` directory:

```bash
# Database Configuration (Digital Ocean)
DB_HOST=your-db-host.db.ondigitalocean.com
DB_PORT=25060
DB_NAME=people_analytics
DB_USER=doadmin
DB_PASSWORD=your-digitalocean-db-password

# Videoloft API Configuration
VIDEOLOFT_EMAIL=your-email@example.com
VIDEOLOFT_PASSWORD=your-password

# Sync Configuration
SYNC_DAYS_BACK=1
SYNC_INTERVAL=date
SYNC_UIDDS=
TIMEZONE=Asia/Kuwait

# API Configuration
API_PORT=5000
DEBUG=false
```

## Kubernetes Secrets

When deploying to Kubernetes, create secrets:

```bash
kubectl create secret generic people-analytics-secrets \
  --from-literal=db-host=your-db-host.db.ondigitalocean.com \
  --from-literal=db-port=25060 \
  --from-literal=db-name=people_analytics \
  --from-literal=db-user=doadmin \
  --from-literal=db-password=YOUR_DB_PASSWORD \
  --from-literal=videoloft-email=YOUR_EMAIL \
  --from-literal=videoloft-password=YOUR_PASSWORD
```


