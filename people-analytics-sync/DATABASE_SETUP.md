# Database Setup Guide

## Database Type: PostgreSQL

We're using **PostgreSQL** (not MySQL). The code uses `psycopg2-binary` and PostgreSQL-specific features.

## Step 1: Create Database on Digital Ocean

### Option A: Using Digital Ocean Dashboard

1. Go to your Digital Ocean dashboard
2. Navigate to **Databases** → **Create Database**
3. Select **PostgreSQL**
4. Choose your configuration (size, region, etc.)
5. **Important**: Note down:
   - Database host (e.g., `your-db.db.ondigitalocean.com`)
   - Port (usually `25060` for SSL or `25061` for non-SSL)
   - Database name (default is usually `defaultdb`, but you can create a new one)
   - Username (usually `doadmin`)
   - Password

### Option B: Create Database via SQL

If you already have a PostgreSQL cluster on Digital Ocean, connect to it and create a new database:

```sql
-- Connect to your PostgreSQL cluster
-- Then create the database
CREATE DATABASE people_analytics;

-- Grant permissions (if needed)
GRANT ALL PRIVILEGES ON DATABASE people_analytics TO doadmin;
```

## Step 2: Initialize Database Tables

After creating the database, you need to create the tables. You have three options:

### Option A: Run SQL Script (Recommended)

```bash
# Connect to your database
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics

# Then run the SQL script
\i init_database.sql

# Or pipe it directly
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics -f init_database.sql
```

### Option B: Run Python Init Script

If you have network access to your Digital Ocean database:

```bash
cd people-analytics-sync

# Create .env file with your database credentials
cat > .env << EOF
DB_HOST=your-db-host.db.ondigitalocean.com
DB_PORT=25060
DB_NAME=people_analytics
DB_USER=doadmin
DB_PASSWORD=your-password
VIDEOLOFT_EMAIL=your-email@example.com
VIDEOLOFT_PASSWORD=your-password
EOF

# Install dependencies
pip install -r requirements.txt

# Initialize database tables
python init_db.py
```

### Option C: Auto-Create on First Sync

The sync service will automatically create tables on first run if they don't exist (via `init_database()` call in `sync_service.py`). However, it's better to initialize explicitly first.

## Step 3: Verify Database Setup

### Check Tables Were Created

Run the verification SQL script:

```bash
# Using psql
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics -f verify_database.sql
```

Or connect and run manually:

```bash
psql -h your-db-host.db.ondigitalocean.com -p 25060 -U doadmin -d people_analytics
\dt
```

## Database Schema

The initialization creates two tables:

### 1. `people_analytics_records`
Stores people analytics data with:
- Device information (uidd, device_id)
- Timestamps (first_timestamp, last_timestamp)
- People counts (people_in, people_out, net_traffic)
- Calculated metrics (traffic_ratio, traffic_pattern, etc.)
- Raw JSON data

### 2. `sync_logs`
Tracks sync operations with:
- Start/end times
- Status (success/failed/partial)
- Number of records synced
- Error messages

## Troubleshooting

### Connection Issues

If you can't connect, check:
1. **Firewall rules**: Ensure your Kubernetes cluster IPs are whitelisted in Digital Ocean database settings
2. **SSL mode**: Digital Ocean databases usually require SSL. The connection should work with `psycopg2-binary` by default
3. **Host/Port**: Verify the host and port are correct (usually port `25060` for SSL)

### Permission Issues

If you get permission errors:
```sql
-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE people_analytics TO doadmin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO doadmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO doadmin;
```

### Tables Not Created

If tables aren't created:
1. Check logs: `kubectl logs job/db-init -n leet-monitor`
2. Verify database connection string
3. Check if database exists: `\l` in psql
4. Manually run: `python init_db.py` with correct environment variables

## Next Steps

After database is set up:
1. Create Kubernetes secrets (see README.md)
2. Deploy CronJob: `kubectl apply -f k8s/cronjob.yaml`
3. Deploy API service: `kubectl apply -f k8s/api-deployment.yaml`
4. Verify sync is working: `kubectl logs -l app=people-analytics-sync -n leet-monitor`

