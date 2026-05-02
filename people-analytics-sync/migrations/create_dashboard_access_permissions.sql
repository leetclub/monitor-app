-- Dashboard tab permissions for Motion / monitoring Apps Script web app.
-- Database: DASHBOARD_DB_NAME (default monitoring_dashboard), not people_analytics.
-- Create DB once (from any existing DB on the same cluster): psql -d people_analytics -c 'CREATE DATABASE monitoring_dashboard;'
-- Then: psql -d monitoring_dashboard -f people-analytics-sync/migrations/create_dashboard_access_permissions.sql

CREATE TABLE IF NOT EXISTS dashboard_access_default (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_tabs JSONB NOT NULL DEFAULT '["*"]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dashboard_access_default (id, default_tabs)
VALUES (1, '["*"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dashboard_access_user (
  email TEXT PRIMARY KEY,
  allowed_tabs JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_access_user_updated ON dashboard_access_user (updated_at DESC);
