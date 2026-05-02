#!/usr/bin/env python3
"""Check admin panel data"""
import os
from sqlalchemy import create_engine, text

db_user = os.getenv('DB_USER', 'doadmin')
db_password = os.getenv('DB_PASSWORD')
db_host = os.getenv('DB_HOST')
db_port = os.getenv('DB_PORT', '25060')
db_name = os.getenv('DB_NAME', 'people_analytics')

if not db_password or not db_host:
    print("Error: DB_PASSWORD and DB_HOST must be set")
    exit(1)

database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
engine = create_engine(database_url)

with engine.connect() as conn:
    print("=" * 80)
    print("Admin Users:")
    print("=" * 80)
    result = conn.execute(text("SELECT id, username, is_active, created_at, last_login FROM admin_users"))
    for row in result:
        print(f"  {row.id} | {row.username} | Active: {row.is_active} | Created: {row.created_at} | Last login: {row.last_login}")
    
    print("\n" + "=" * 80)
    print("Recent Alerts (last 10):")
    print("=" * 80)
    result = conn.execute(text("""
        SELECT id, level, source, title, is_resolved, created_at 
        FROM alert_logs 
        ORDER BY created_at DESC 
        LIMIT 10
    """))
    for row in result:
        print(f"  [{row.level}] {row.source}: {row.title} | Resolved: {row.is_resolved} | {row.created_at}")
    
    print("\n" + "=" * 80)
    print("Recent Verification Results (last 5):")
    print("=" * 80)
    result = conn.execute(text("""
        SELECT id, sync_date, verification_date, status, machine_count, total_revenue
        FROM sync_verification_results
        ORDER BY verification_date DESC
        LIMIT 5
    """))
    for row in result:
        print(f"  {row.id} | Sync: {row.sync_date} | Status: {row.status} | Machines: {row.machine_count} | Revenue: {row.total_revenue}")
