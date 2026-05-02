-- Live Ops board (monitoring-app-v2). Apply to DASHBOARD_DB_NAME (default monitoring_dashboard).
-- Example: psql "$DASHBOARD_DATABASE_URL" -f migrations/add_live_dashboard.sql

CREATE TABLE IF NOT EXISTS live_machine_config (
    machine_id TEXT PRIMARY KEY,
    min_sale_interval_minutes INTEGER NOT NULL DEFAULT 10,
    max_hours_without_cleaning NUMERIC(10, 2),
    max_hours_without_qc NUMERIC(10, 2),
    strike_operator_email TEXT,
    daily_sales_target NUMERIC(14, 4),
    expected_shift_start TEXT,
    shift_timezone TEXT,
    shift_grace_minutes INTEGER NOT NULL DEFAULT 15,
    last_cleaning_at TIMESTAMPTZ,
    last_qc_visit_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_machine_config_updated ON live_machine_config (updated_at);

CREATE TABLE IF NOT EXISTS live_shift_clock_in (
    id SERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    shift_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    recorded_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_live_shift_machine_date UNIQUE (machine_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_live_shift_machine_date ON live_shift_clock_in (machine_id, shift_date);
