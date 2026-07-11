-- Email admins for Targets site (Owners / Analytics / Promo admin).
CREATE TABLE IF NOT EXISTS target_site_admin (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_site_admin_email
    ON target_site_admin (LOWER(email));
