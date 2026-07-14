-- Multi-product + location metric targets for Alert Admin → Targets / Performance
-- Run (WSL): cd people-analytics-sync && psql -d people_analytics -f migrations/add_promoted_products_targets.sql
-- Note: live_machine_config lives on the monitoring dashboard DB. If your psql
-- default DB is people_analytics, connect to the dashboard DB name instead, e.g.:
--   psql -d monitoring_dashboard -f migrations/add_promoted_products_targets.sql

ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS location_target_metric TEXT;

ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS daily_location_cups_target NUMERIC(14, 4);

ALTER TABLE live_machine_config
  ADD COLUMN IF NOT EXISTS promoted_products JSONB;

COMMENT ON COLUMN live_machine_config.location_target_metric IS 'revenue | cups — location target unit';
COMMENT ON COLUMN live_machine_config.daily_location_cups_target IS 'Location cups target when metric=cups';
COMMENT ON COLUMN live_machine_config.promoted_products IS '[{productName, metric, dailyTarget, period, primary}]';
