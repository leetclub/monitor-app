-- Alert Admin: inactive schedule (weekdays / dates / ranges) on monitoring_dashboard.
-- Also ensures is_active exists (older deploys may only have had the status migration).
--
--   psql -d monitoring_dashboard -f migrations/add_alert_machine_inactive_schedule.sql

ALTER TABLE alert_machine_profile
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE alert_machine_profile
  ADD COLUMN IF NOT EXISTS inactive_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN alert_machine_profile.is_active IS
  'Alert Admin: false = always inactive on Red Flags / Overall (shaded).';

COMMENT ON COLUMN alert_machine_profile.inactive_schedule IS
  'When is_active=true: { weekdays:[0-6 Sun=0], dates:["YYYY-MM-DD"], ranges:[{start,end}] } — shade machine on matching Kuwait calendar days.';
