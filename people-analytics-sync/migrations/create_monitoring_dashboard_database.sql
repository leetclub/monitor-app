-- One-time: create the dashboard permissions database on the same PostgreSQL instance
-- as people_analytics. Run connected to an existing database (e.g. people_analytics):
--   psql -d people_analytics -f people-analytics-sync/migrations/create_monitoring_dashboard_database.sql
--
-- DigitalOcean managed Postgres often has no "postgres" database; use people_analytics or defaultdb.
-- Idempotent: skips if monitoring_dashboard already exists (requires psql \gexec).

SELECT format('CREATE DATABASE %I', 'monitoring_dashboard')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'monitoring_dashboard')
\gexec
