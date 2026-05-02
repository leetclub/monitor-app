-- Migration: Add Vendon Sales Records Table
-- This table stores daily sales data from Vendon API for fast queries

-- Create vendon_sales_records table
CREATE TABLE IF NOT EXISTS vendon_sales_records (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(100) NOT NULL,
    machine_name VARCHAR(255),
    sale_date TIMESTAMP NOT NULL,
    total_revenue FLOAT DEFAULT 0.0,
    total_transactions INTEGER DEFAULT 0,
    raw_vends TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_machine_id ON vendon_sales_records(machine_id);
CREATE INDEX IF NOT EXISTS idx_sale_date ON vendon_sales_records(sale_date);
CREATE INDEX IF NOT EXISTS idx_machine_date ON vendon_sales_records(machine_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_synced_at_vendon ON vendon_sales_records(synced_at);

-- Create unique constraint to prevent duplicate records for same machine/date
ALTER TABLE vendon_sales_records 
    DROP CONSTRAINT IF EXISTS uq_machine_date;
ALTER TABLE vendon_sales_records 
    ADD CONSTRAINT uq_machine_date UNIQUE (machine_id, sale_date);

-- Grant permissions (adjust user as needed)
GRANT ALL PRIVILEGES ON TABLE vendon_sales_records TO doadmin;
GRANT ALL PRIVILEGES ON SEQUENCE vendon_sales_records_id_seq TO doadmin;

-- Verify table was created
SELECT 'Vendon sales table created successfully' as status;
\d vendon_sales_records

