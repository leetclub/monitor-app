-- Create vendon_sync_logs table for tracking sync operations
CREATE TABLE IF NOT EXISTS vendon_sync_logs (
    id SERIAL PRIMARY KEY,
    sync_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_completed_at TIMESTAMP,
    status VARCHAR(50),
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    machines_processed TEXT
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_vendon_sync_started_at ON vendon_sync_logs(sync_started_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE vendon_sync_logs TO doadmin;
GRANT ALL PRIVILEGES ON SEQUENCE vendon_sync_logs_id_seq TO doadmin;

-- Verify table was created
SELECT 'Vendon sync logs table created successfully' as status;



