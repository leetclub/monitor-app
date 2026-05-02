-- Daily per-machine revenue cache for "Top revenue machines" preloads (people_analytics DB).
-- Warmed by cron for yesterday; used by GAS for Refill/Historical top machine selectors.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS vendon_daily_machine_revenue_cache (
  id SERIAL PRIMARY KEY,
  cache_date DATE NOT NULL,
  machine_id TEXT NOT NULL,
  machine_name TEXT,
  total_sales_kwd NUMERIC(12, 3) NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendon_daily_machine_revenue_cache_day_machine
  ON vendon_daily_machine_revenue_cache (cache_date, machine_id);

CREATE INDEX IF NOT EXISTS idx_vendon_daily_machine_revenue_cache_date
  ON vendon_daily_machine_revenue_cache (cache_date);

