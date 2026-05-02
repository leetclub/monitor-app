-- Run against Postgres DB used by people-api (e.g. monitoring_dashboard).
-- psql -d monitoring_dashboard -f migrations/add_attendance_snapshot_cache.sql

CREATE TABLE IF NOT EXISTS attendance_snapshot_cache (
  cache_key     text PRIMARY KEY,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  machine_id    text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_snapshot_cache_dates
  ON attendance_snapshot_cache (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_attendance_snapshot_cache_generated
  ON attendance_snapshot_cache (generated_at DESC);
