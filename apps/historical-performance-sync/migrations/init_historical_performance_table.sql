-- Create historical_performance_records table
CREATE TABLE IF NOT EXISTS historical_performance_records (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(100) NOT NULL,
    machine_name VARCHAR(255),
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    total_revenue FLOAT DEFAULT 0.0,
    total_quantity INTEGER DEFAULT 0,
    product_breakdown TEXT,
    top_products TEXT,
    bottom_products TEXT,
    raw_vends_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_machine_id_historical ON historical_performance_records(machine_id);
CREATE INDEX IF NOT EXISTS idx_start_date_historical ON historical_performance_records(start_date);
CREATE INDEX IF NOT EXISTS idx_end_date_historical ON historical_performance_records(end_date);
CREATE INDEX IF NOT EXISTS idx_machine_date_range ON historical_performance_records(machine_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_synced_at_historical ON historical_performance_records(synced_at);

-- Create unique constraint
ALTER TABLE historical_performance_records
    DROP CONSTRAINT IF EXISTS uq_machine_date_range;
ALTER TABLE historical_performance_records
    ADD CONSTRAINT uq_machine_date_range UNIQUE (machine_id, start_date, end_date);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE historical_performance_records TO doadmin;
GRANT ALL PRIVILEGES ON SEQUENCE historical_performance_records_id_seq TO doadmin;

SELECT 'Historical performance table created successfully' as status;
\d historical_performance_records

