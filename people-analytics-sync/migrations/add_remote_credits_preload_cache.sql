-- Remote Credits preload cache (people_analytics DB).
-- Stores yesterday's "top WEB cashless machine" and its resolved logs payload to avoid GAS UrlFetch.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS remote_credits_preload_cache (
  id SERIAL PRIMARY KEY,
  cache_date DATE NOT NULL UNIQUE,
  best_machine_id TEXT,
  best_machine_name TEXT,
  best_machine_count INTEGER NOT NULL DEFAULT 0,
  from_date TEXT,
  to_date TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remote_credits_preload_cache_date
  ON remote_credits_preload_cache (cache_date);

