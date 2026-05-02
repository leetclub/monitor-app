-- Create historical_performance_sync_logs table
CREATE TABLE IF NOT EXISTS historical_performance_sync_logs (
    id SERIAL PRIMARY KEY,
    sync_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_completed_at TIMESTAMP,
    status VARCHAR(50),
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    machines_processed TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_historical_sync_started_at ON historical_performance_sync_logs(sync_started_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE historical_performance_sync_logs TO doadmin;
GRANT ALL PRIVILEGES ON SEQUENCE historical_performance_sync_logs_id_seq TO doadmin;

SELECT 'Historical performance sync logs table created successfully' as status;
\d historical_performance_sync_logs

