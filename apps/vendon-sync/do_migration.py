#!/usr/bin/env python3
from sqlalchemy import create_engine, text
import os

db_user = os.getenv('DB_USER', 'doadmin')
db_password = os.getenv('DB_PASSWORD')
db_host = os.getenv('DB_HOST')
db_port = os.getenv('DB_PORT', '25060')
db_name = os.getenv('DB_NAME', 'people_analytics')

database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
engine = create_engine(database_url)

with engine.connect() as conn:
    print("Adding sync_type column...")
    conn.execute(text("ALTER TABLE sync_verification_results ADD COLUMN IF NOT EXISTS sync_type VARCHAR(50)"))
    conn.commit()
    print("Creating index...")
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_verification_sync_type ON sync_verification_results(sync_type, verification_date)"))
    conn.commit()
    print("Updating existing records...")
    result = conn.execute(text("UPDATE sync_verification_results SET sync_type = 'vendon-sync' WHERE sync_type IS NULL"))
    conn.commit()
    print(f"Migration completed. Updated {result.rowcount} records.")
