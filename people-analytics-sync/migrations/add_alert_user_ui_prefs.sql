-- Per-user Alert app UI preferences (column layouts, etc.)
CREATE TABLE IF NOT EXISTS alert_user_ui_prefs (
  email TEXT PRIMARY KEY,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_user_ui_prefs_updated ON alert_user_ui_prefs (updated_at);
