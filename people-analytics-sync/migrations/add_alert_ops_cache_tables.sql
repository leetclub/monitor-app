-- Alert ops precomputed caches (monitoring_dashboard DB).
-- Workflow attendance: fast Live Op reads. Daily sales elapsed: fleet revenue bar + sales columns.

CREATE TABLE IF NOT EXISTS alert_workflow_attendance_cache (
  id INTEGER PRIMARY KEY,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ,
  compute_error TEXT
);

INSERT INTO alert_workflow_attendance_cache (id, payload_json)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_daily_sales_elapsed_cache (
  id INTEGER PRIMARY KEY,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  cache_bucket TEXT,
  generated_at TIMESTAMPTZ,
  compute_error TEXT
);

INSERT INTO alert_daily_sales_elapsed_cache (id, payload_json)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
