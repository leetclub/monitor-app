-- Singleton cache for /api/red-alert/* payloads (monitoring_dashboard).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS red_alert_snapshot_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ,
  compute_error TEXT
);

INSERT INTO red_alert_snapshot_cache (id, payload_json)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
