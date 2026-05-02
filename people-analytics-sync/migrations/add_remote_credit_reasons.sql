-- Refund Tests (Remote Credit) Reasons: user-entered reason per log
-- DB: people_analytics. Run in Cursor WSL: psql -d people_analytics -f migrations/add_remote_credit_reasons.sql

CREATE TABLE IF NOT EXISTS remote_credit_reasons (
    id SERIAL PRIMARY KEY,
    log_id VARCHAR(128) NOT NULL,
    machine_id VARCHAR(64) NOT NULL,
    timestamp_val BIGINT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() AT TIME ZONE 'UTC'),
    UNIQUE(log_id, machine_id, timestamp_val)
);

CREATE INDEX IF NOT EXISTS idx_remote_credit_reasons_machine_ts ON remote_credit_reasons (machine_id, timestamp_val);
CREATE INDEX IF NOT EXISTS idx_remote_credit_reasons_log ON remote_credit_reasons (log_id);

COMMENT ON TABLE remote_credit_reasons IS 'User-entered reasons for Refund Tests (Reason Unidentified) per log';
COMMENT ON COLUMN remote_credit_reasons.timestamp_val IS 'Transaction timestamp (Unix seconds)';
