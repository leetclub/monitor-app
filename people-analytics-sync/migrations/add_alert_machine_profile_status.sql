-- Alert Admin: machine active/inactive override (monitoring_dashboard).
-- psql -d monitoring_dashboard -f migrations/add_alert_machine_profile_status.sql

ALTER TABLE alert_machine_profile
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN alert_machine_profile.is_active IS
  'Alert Admin override: inactive machines can be hidden/deprioritized on Red Flags / Overall.';
