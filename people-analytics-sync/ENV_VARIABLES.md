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
SYNC_DAYS_BACK=1              # Number of days back to fetch (default: 1)
SYNC_INTERVAL=date            # Time interval: 'date', 'hour', or '60000' (default: 'date')
SYNC_UIDDS=                   # Optional: comma-separated device IDs, leave empty to sync all cameras
TIMEZONE=Asia/Kuwait          # Timezone for data (default: 'Asia/Kuwait')
```

### API Configuration

```bash
API_PORT=5000                 # Port for API service (default: 5000)
DEBUG=false                   # Enable debug mode (default: false)
```

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


