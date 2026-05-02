-- Vendon events cache for Delay Risk / Events tab (people_analytics DB).
-- Goal: avoid repeated Vendon API pagination during peak usage.
-- Cron warms yesterday; API can also fill on-demand.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS vendon_events_cache (
  id SERIAL PRIMARY KEY,
  cache_date DATE NOT NULL,
  event_key TEXT NOT NULL,
  vendon_event_id TEXT,
  machine_id TEXT,
  machine_name TEXT,
  name TEXT,
  base_code TEXT,
  display_name TEXT,
  received_at INTEGER,
  resolved_at INTEGER,
  duration INTEGER,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendon_events_cache_date_key
  ON vendon_events_cache (cache_date, event_key);

CREATE INDEX IF NOT EXISTS idx_vendon_events_cache_date
  ON vendon_events_cache (cache_date);

CREATE INDEX IF NOT EXISTS idx_vendon_events_cache_machine_date
  ON vendon_events_cache (machine_id, cache_date);

