-- Product target period for Alert SX / Performance (daily | weekly | monthly).
-- DB: monitoring_dashboard (not people_analytics).
-- Run: psql -d monitoring_dashboard -f migrations/add_sx_target_period.sql
ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS sx_target_period TEXT DEFAULT 'daily';

COMMENT ON COLUMN live_machine_config.sx_target_period IS
  'How product/location SX target applies: daily, weekly, or monthly (Alert Admin)';
