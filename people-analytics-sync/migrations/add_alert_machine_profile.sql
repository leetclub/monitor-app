-- Per-machine Alert admin metadata (spec: alert.theleetclub.com Admin sheet).
-- Idempotent.

CREATE TABLE IF NOT EXISTS alert_machine_profile (
  machine_id TEXT PRIMARY KEY,
  machine_name TEXT,
  location_owner TEXT,
  location_hours TEXT CHECK (location_hours IS NULL OR location_hours IN ('9', '12', '16', '24')),
  operating_days JSONB NOT NULL DEFAULT '{"preset":"all_week"}'::jsonb,
  cleaning_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  operator_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
  technician_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  qa_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuwait',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_machine_profile_updated ON alert_machine_profile (updated_at DESC);
