-- Promo tab: product targets per machine/owner, calendar day targets, swipe instruments.
CREATE TABLE IF NOT EXISTS target_promo_assignment (
    id SERIAL PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('machine', 'owner')),
    machine_id TEXT,
    vendon_user_id TEXT,
    product_name TEXT NOT NULL DEFAULT 'Americano Max',
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_promo_assignment_machine
    ON target_promo_assignment (machine_id)
    WHERE scope_type = 'machine' AND machine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_promo_assignment_owner
    ON target_promo_assignment (vendon_user_id)
    WHERE scope_type = 'owner' AND vendon_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS target_promo_day_target (
    id SERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    target_date DATE NOT NULL,
    target_cups INTEGER NOT NULL DEFAULT 0 CHECK (target_cups >= 0),
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (machine_id, target_date)
);

CREATE INDEX IF NOT EXISTS idx_target_promo_day_target_date
    ON target_promo_day_target (target_date DESC);

CREATE TABLE IF NOT EXISTS target_promo_instrument (
    id SERIAL PRIMARY KEY,
    vendon_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_target_promo_instrument_owner
    ON target_promo_instrument (vendon_user_id, sort_order);

CREATE TABLE IF NOT EXISTS target_promo_swipe_event (
    id SERIAL PRIMARY KEY,
    instrument_id INTEGER NOT NULL REFERENCES target_promo_instrument(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    vendon_user_id TEXT NOT NULL,
    swiped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    product_cups_now INTEGER,
    product_cups_yesterday_same_time INTEGER,
    delta_cups INTEGER,
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_target_promo_swipe_event_owner
    ON target_promo_swipe_event (vendon_user_id, swiped_at DESC);
