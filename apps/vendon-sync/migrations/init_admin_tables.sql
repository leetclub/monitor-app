-- Admin Panel Database Tables
-- Run this migration to create admin tables

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_username ON admin_users(username);

-- Alert Logs Table
CREATE TABLE IF NOT EXISTS alert_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    source VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_level ON alert_logs(level);
CREATE INDEX IF NOT EXISTS idx_alert_source ON alert_logs(source);
CREATE INDEX IF NOT EXISTS idx_alert_resolved ON alert_logs(is_resolved);
CREATE INDEX IF NOT EXISTS idx_alert_created ON alert_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_alert_level_created ON alert_logs(level, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_source_created ON alert_logs(source, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_unresolved ON alert_logs(is_resolved, created_at);

-- Sync Verification Results Table
CREATE TABLE IF NOT EXISTS sync_verification_results (
    id SERIAL PRIMARY KEY,
    sync_date TIMESTAMP NOT NULL,
    verification_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL,
    date_check BOOLEAN DEFAULT FALSE,
    sync_logs_check BOOLEAN DEFAULT FALSE,
    data_completeness_check BOOLEAN DEFAULT FALSE,
    api_verification_check BOOLEAN DEFAULT FALSE,
    summary TEXT,
    errors TEXT,
    warnings TEXT,
    machine_count INTEGER DEFAULT 0,
    total_revenue VARCHAR(50),
    total_transactions INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_verification_sync_date ON sync_verification_results(sync_date);
CREATE INDEX IF NOT EXISTS idx_verification_date ON sync_verification_results(verification_date);
CREATE INDEX IF NOT EXISTS idx_verification_status ON sync_verification_results(status);
CREATE INDEX IF NOT EXISTS idx_verification_date_status ON sync_verification_results(sync_date, status);

-- Create default admin user (password: admin123)
-- Change this password immediately after first login!
INSERT INTO admin_users (username, password_hash, is_active)
VALUES ('admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', TRUE)
ON CONFLICT (username) DO NOTHING;

-- Note: The password hash above is SHA256 of 'admin123'
-- To generate a new hash: echo -n 'yourpassword' | sha256sum
