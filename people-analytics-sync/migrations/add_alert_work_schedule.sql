-- Alert app: work schedules and other admin-only metadata (monitoring_dashboard).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS alert_work_schedule (
  id SERIAL PRIMARY KEY,
  machine_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuwait',
  start_time TEXT NOT NULL, -- "HH:MM" local
  end_time TEXT NOT NULL,   -- "HH:MM" local
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alert_work_schedule UNIQUE (machine_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_alert_work_schedule_machine ON alert_work_schedule (machine_id);

