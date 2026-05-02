-- DC cleaning schedule (monitoring_dashboard) — Red Alert exclusions during cleaning windows.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS machine_cleaning_schedule (
  id SERIAL PRIMARY KEY,
  name_pattern TEXT NOT NULL,
  cleaning_operator TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuwait',
  windows JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_machine_cleaning_name_pattern UNIQUE (name_pattern)
);

CREATE INDEX IF NOT EXISTS idx_machine_cleaning_schedule_priority ON machine_cleaning_schedule (priority DESC);

-- Seed from "Schedule - Cleaning Schedule" PDF (operator, location, time).
-- Higher priority wins on multi-match; longer patterns should use higher priority when needed.
INSERT INTO machine_cleaning_schedule (name_pattern, cleaning_operator, timezone, windows, priority) VALUES
('jahra main gate', 'Ishor (Half cleaning)', 'Asia/Kuwait', '[{"start":"16:30","end":"17:00"}]'::jsonb, 10),
('jahra women center', 'Makumi (Half cleaning)', 'Asia/Kuwait', '[{"start":"14:00","end":"14:30"}]'::jsonb, 10),
('jahra parking', 'Makumi (Half cleaning)', 'Asia/Kuwait', '[{"start":"17:00","end":"18:00"}]'::jsonb, 10),
('o2 jahra', 'Dahir', 'Asia/Kuwait', '[{"start":"15:00","end":"15:30"}]'::jsonb, 10),
('jaber 2', 'Vinoth', 'Asia/Kuwait', '[{"start":"01:00","end":"02:00"}]'::jsonb, 10),
('jaber 6', 'Vinoth', 'Asia/Kuwait', '[{"start":"02:00","end":"03:00"}]'::jsonb, 10),
('adan opd', 'Vinkat', 'Asia/Kuwait', '[{"start":"01:00","end":"02:00"}]'::jsonb, 10),
('adan hallway', 'Mark', 'Asia/Kuwait', '[{"start":"02:00","end":"03:00"}]'::jsonb, 10),
('adan main gate', 'Vinkat', 'Asia/Kuwait', '[{"start":"03:00","end":"04:00"}]'::jsonb, 10),
('adan casualty', 'Mark', 'Asia/Kuwait', '[{"start":"04:00","end":"05:00"}]'::jsonb, 10),
('farwaniya 3rd', 'Fred', 'Asia/Kuwait', '[{"start":"01:00","end":"03:00"}]'::jsonb, 20),
('farwaniya opd', 'Jithin', 'Asia/Kuwait', '[{"start":"01:00","end":"03:00"}]'::jsonb, 20),
('amiri', 'Hillary', 'Asia/Kuwait', '[{"start":"19:00","end":"21:00"}]'::jsonb, 10),
('razi', 'Prashant', 'Asia/Kuwait', '[{"start":"14:00","end":"16:00"}]'::jsonb, 10),
('maternity', 'Angela', 'Asia/Kuwait', '[{"start":"14:00","end":"16:00"}]'::jsonb, 10),
('mubarak', 'Karma', 'Asia/Kuwait', '[{"start":"15:00","end":"16:00"}]'::jsonb, 10),
('dahia bl 3', 'Daniel', 'Asia/Kuwait', '[{"start":"14:00","end":"15:00"}]'::jsonb, 10),
('khaldiya', 'Mitchelle', 'Asia/Kuwait', '[{"start":"15:00","end":"16:00"}]'::jsonb, 10),
('o2 mahboula', 'Ashish', 'Asia/Kuwait', '[{"start":"14:30","end":"15:00"}]'::jsonb, 10),
('o2 riggae', 'Morris', 'Asia/Kuwait', '[{"start":"14:30","end":"15:00"}]'::jsonb, 10)
ON CONFLICT (name_pattern) DO UPDATE SET
  cleaning_operator = EXCLUDED.cleaning_operator,
  timezone = EXCLUDED.timezone,
  windows = EXCLUDED.windows,
  priority = EXCLUDED.priority,
  updated_at = NOW();
