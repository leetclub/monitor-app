-- monitoring_dashboard.live_machine_config — Red Alert display + PFA cleaning exclusion
-- Idempotent: safe to re-run.

ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS red_alert_operator_name TEXT,
  ADD COLUMN IF NOT EXISTS exclude_cleaning_timeouts_pfa BOOLEAN NOT NULL DEFAULT FALSE;
