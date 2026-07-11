-- Manual QA visit summaries entered in Alert Admin (monitoring_dashboard).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS qa_manual_summary (
  id SERIAL PRIMARY KEY,
  machine_name TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_qa_manual_summary_machine_created
  ON qa_manual_summary (lower(trim(machine_name)), created_at DESC);
