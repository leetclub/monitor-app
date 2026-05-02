#!/usr/bin/env python3
"""
Manually fix machine 393033 data for 2026-01-16
Fetches correct data from Vendon API and updates database
"""
import requests
import json
from datetime import datetime
import os
import sys

# Import models
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import VendonSalesRecord, create_engine_and_session
from sqlalchemy.dialects.postgresql import insert

VENDON_API_KEY = os.getenv('VENDON_API_KEY')
VENDON_API_BASE = os.getenv('VENDON_API_BASE', 'https://cloud.vendon.net/rest/v1.9.0')

def fetch_and_fix():
    """Fetch correct data from Vendon and update database"""
    machine_id = "393033"
    target_date = "2026-01-16"
    
    # Calculate timestamps for the full day
    date_obj = datetime.strptime(target_date, '%Y-%m-%d')
    start_dt = datetime.combine(date_obj, datetime.min.time())
    end_dt = datetime.combine(date_obj, datetime.max.time())
    from_timestamp = int(start_dt.timestamp())
    to_timestamp = int(end_dt.timestamp())
    
    print(f"🔍 Fetching data for machine {machine_id} on {target_date}")
    print(f"   Timestamps: {from_timestamp} to {to_timestamp}")
    print(f"   Date range: {start_dt} to {end_dt}")
    
    # Fetch from Vendon API
    url = f"{VENDON_API_BASE}/stats/vends"
    params = {
        'from_timestamp': from_timestamp,
        'to_timestamp': to_timestamp,
        'machine_id': machine_id,
        'limit': 10000
    }
    headers = {"Authorization": f"Token {VENDON_API_KEY}"}
    
    print(f"   Calling Vendon API...")
    response = requests.get(url, params=params, headers=headers, timeout=30)
    if response.status_code != 200:
        print(f"❌ Error: {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return False
    
    data = response.json()
    if data.get('code') != 200:
        print(f"❌ API error: {data.get('code')} - {data.get('message', 'Unknown')}")
        return False
    
    vends = data.get('result', [])
    total_revenue = sum(v.get('price', 0) for v in vends)
    total_transactions = len(vends)
    machine_name = vends[0].get('machine_name') if vends else None
    
    print(f"\n✅ Fetched from Vendon API:")
    print(f"   Revenue: {total_revenue:.2f} KWD")
    print(f"   Transactions: {total_transactions}")
    print(f"   Machine name: {machine_name}")
    if vends:
        print(f"   First vend timestamp: {vends[0].get('timestamp')}")
        print(f"   Last vend timestamp: {vends[-1].get('timestamp')}")
    
    if total_revenue == 0:
        print(f"\n⚠️  Warning: Vendon API returned 0 revenue. This might be correct or a timezone issue.")
        print(f"   But we'll update the database anyway to ensure consistency.")
    
    # Update database
    engine, SessionLocal = create_engine_and_session()
    session = SessionLocal()
    try:
        sale_datetime = datetime.combine(date_obj, datetime.min.time())
        
        # Use upsert to update
        stmt = insert(VendonSalesRecord).values(
            machine_id=machine_id,
            machine_name=machine_name,
            sale_date=sale_datetime,
            total_revenue=total_revenue,
            total_transactions=total_transactions,
            raw_vends=json.dumps(vends),
            synced_at=datetime.utcnow()
        )
        
        stmt = stmt.on_conflict_do_update(
            constraint='uq_machine_date',
            set_=dict(
                machine_name=stmt.excluded.machine_name,
                total_revenue=stmt.excluded.total_revenue,
                total_transactions=stmt.excluded.total_transactions,
                raw_vends=stmt.excluded.raw_vends,
                synced_at=stmt.excluded.synced_at
            )
        )
        
        session.execute(stmt)
        session.commit()
        
        print(f"\n✅ Database updated successfully!")
        print(f"   Machine {machine_id} for {target_date}: {total_revenue:.2f} KWD")
        return True
        
    except Exception as e:
        session.rollback()
        print(f"❌ Error updating database: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        session.close()

if __name__ == "__main__":
    if not VENDON_API_KEY:
        print("❌ VENDON_API_KEY environment variable not set")
        sys.exit(1)
    
    success = fetch_and_fix()
    sys.exit(0 if success else 1)
