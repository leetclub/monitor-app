-- Intra-Day Checkup: control staff records midday operator readiness per machine per day.
-- DB: people_analytics. Run: psql -d people_analytics -f migrations/add_intra_day_checkups.sql

CREATE TABLE IF NOT EXISTS intra_day_checkups (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(64) NOT NULL,
    operator_id VARCHAR(64) NOT NULL,
    operator_name VARCHAR(256),
    check_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('ready', 'not_ready')),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
    recorded_by VARCHAR(128),
    UNIQUE(machine_id, operator_id, check_date)
);

CREATE INDEX IF NOT EXISTS idx_intra_day_checkups_machine_date ON intra_day_checkups (machine_id, check_date);
CREATE INDEX IF NOT EXISTS idx_intra_day_checkups_check_date ON intra_day_checkups (check_date);

COMMENT ON TABLE intra_day_checkups IS 'Midday operator readiness check per machine per day (control staff)';
COMMENT ON COLUMN intra_day_checkups.status IS 'ready | not_ready';
