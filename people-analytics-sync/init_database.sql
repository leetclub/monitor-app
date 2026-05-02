-- Initialize People Analytics Database
-- Run this script to create the database and tables
-- 
-- Note: If database doesn't exist, connect to 'defaultdb' or 'postgres' first and run:
-- CREATE DATABASE people_analytics;
-- Then connect to people_analytics and run this script

-- Connect to the database (if running from psql)
\c people_analytics;

-- Create people_analytics_records table
CREATE TABLE IF NOT EXISTS people_analytics_records (
    id SERIAL PRIMARY KEY,
    uidd VARCHAR(100) NOT NULL,
    device_id VARCHAR(100),
    first_timestamp TIMESTAMP NOT NULL,
    last_timestamp TIMESTAMP NOT NULL,
    interval_type VARCHAR(50),
    timezone VARCHAR(50) DEFAULT 'Asia/Kuwait',
    people_in INTEGER DEFAULT 0,
    people_out INTEGER DEFAULT 0,
    net_traffic INTEGER DEFAULT 0,
    total_traffic INTEGER DEFAULT 0,
    traffic_ratio FLOAT,
    traffic_pattern VARCHAR(50),
    duration_hours FLOAT,
    event_count INTEGER DEFAULT 0,
    raw_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sync_logs table
CREATE TABLE IF NOT EXISTS sync_logs (
    id SERIAL PRIMARY KEY,
    sync_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_completed_at TIMESTAMP,
    status VARCHAR(50),
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    uidds_processed TEXT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_uidd ON people_analytics_records(uidd);
CREATE INDEX IF NOT EXISTS idx_device_id ON people_analytics_records(device_id);
CREATE INDEX IF NOT EXISTS idx_first_timestamp ON people_analytics_records(first_timestamp);
CREATE INDEX IF NOT EXISTS idx_synced_at ON people_analytics_records(synced_at);
CREATE INDEX IF NOT EXISTS idx_uidd_timestamp ON people_analytics_records(uidd, first_timestamp);
CREATE INDEX IF NOT EXISTS idx_sync_started_at ON sync_logs(sync_started_at);

-- Grant permissions (adjust user as needed)
GRANT ALL PRIVILEGES ON DATABASE people_analytics TO doadmin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO doadmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO doadmin;

-- Verify tables were created
SELECT 'Tables created successfully' as status;
\dt

