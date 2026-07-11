-- Area owner assignments for target.theleetclub.com (Vendon user → machine ids).
CREATE TABLE IF NOT EXISTS target_area_owner (
  vendon_user_id TEXT PRIMARY KEY,
  vendon_user_name TEXT NOT NULL DEFAULT '',
  machine_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_area_owner_updated ON target_area_owner (updated_at DESC);
