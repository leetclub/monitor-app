-- Waste Analysis Reasons: user-entered reason per machine per date
-- DB: people_analytics (same DB as people-analytics API; no separate DB created for waste).
-- Run in Cursor WSL: psql -d people_analytics -f migrations/add_waste_analysis_reasons.sql
-- Or: bash run-waste-migration.sh

CREATE TABLE IF NOT EXISTS waste_analysis_reasons (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(64) NOT NULL,
    date DATE NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UNIQUE(machine_id, date)
);

CREATE INDEX IF NOT EXISTS idx_waste_reasons_machine_date ON waste_analysis_reasons (machine_id, date);
CREATE INDEX IF NOT EXISTS idx_waste_reasons_date ON waste_analysis_reasons (date);

COMMENT ON TABLE waste_analysis_reasons IS 'User-entered reasons for waste analysis results per machine per date';
