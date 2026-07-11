-- Login credentials for area owners (Areas tab — scoped to their machines).
ALTER TABLE target_area_owner
  ADD COLUMN IF NOT EXISTS login_username TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_area_owner_login_username
  ON target_area_owner (LOWER(login_username))
  WHERE login_username IS NOT NULL AND login_username <> '';
