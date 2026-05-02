#!/usr/bin/env python3
"""Check historical performance sync status"""
from sqlalchemy import create_engine, text
import os
from datetime import datetime

db_user = os.getenv('DB_USER', 'doadmin')
db_password = os.getenv('DB_PASSWORD')
db_host = os.getenv('DB_HOST')
db_port = os.getenv('DB_PORT', '25060')
db_name = os.getenv('DB_NAME', 'people_analytics')

database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
engine = create_engine(database_url)

with engine.connect() as conn:
    # Check if table exists
    result = conn.execute(text("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'historical_performance_sync_logs'
        )
    """))
    table_exists = result.fetchone()[0]
    print(f"Table exists: {table_exists}")
    
    if table_exists:
        # Check recent syncs
        result = conn.execute(text("""
            SELECT MAX(sync_completed_at) as last_run, COUNT(*) as total_runs
            FROM historical_performance_sync_logs
            WHERE status = 'success'
            AND sync_completed_at > NOW() - INTERVAL '2 days'
        """))
        row = result.fetchone()
        print(f"Last run (last 2 days): {row[0]}, Total: {row[1]}")
        
        if row[0]:
            hours_ago = (datetime.utcnow() - row[0]).total_seconds() / 3600
            print(f"Hours ago: {hours_ago:.1f}")
        
        # Check all syncs
        result = conn.execute(text("""
            SELECT MAX(sync_completed_at) as last_run, COUNT(*) as total_runs
            FROM historical_performance_sync_logs
            WHERE status = 'success'
        """))
        row = result.fetchone()
        print(f"Last run (all time): {row[0]}, Total: {row[1]}")
