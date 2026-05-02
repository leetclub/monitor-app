#!/usr/bin/env python3
"""
Script to verify all historical data from Videoloft is in the database
Compares Videoloft API data with database records
"""
import os
import sys
from datetime import datetime, timedelta
from sync_service import VideoloftClient, PeopleAnalyticsSync
from models import PeopleAnalyticsRecord, create_engine_and_session
from sqlalchemy import func

def get_date_range_from_db():
    """Get the date range of data in database"""
    engine, SessionLocal = create_engine_and_session()
    session = SessionLocal()
    
    try:
        result = session.query(
            func.min(PeopleAnalyticsRecord.first_timestamp).label('min_date'),
            func.max(PeopleAnalyticsRecord.first_timestamp).label('max_date'),
            func.count(PeopleAnalyticsRecord.id).label('total_records'),
            func.count(func.distinct(PeopleAnalyticsRecord.uidd)).label('unique_devices')
        ).first()
        
        return {
            'min_date': result.min_date,
            'max_date': result.max_date,
            'total_records': result.total_records,
            'unique_devices': result.unique_devices
        }
    finally:
        session.close()

def get_videoloft_data_summary(days_back=365):
    """Get summary of data available from Videoloft"""
    videoloft = VideoloftClient()
    
    if not videoloft.authenticate():
        print("❌ Failed to authenticate with Videoloft")
        return None
    
    cameras = videoloft.get_cameras()
    if not cameras:
        print("❌ No cameras found")
        return None
    
    uidds = [cam['id'] for cam in cameras]
    
    # Calculate date range
    end_time = int(datetime.now().timestamp() * 1000)
    start_time = int((datetime.now() - timedelta(days=days_back)).timestamp() * 1000)
    
    print(f"📊 Fetching data from Videoloft for last {days_back} days...")
    print(f"   Date range: {datetime.fromtimestamp(start_time/1000)} to {datetime.fromtimestamp(end_time/1000)}")
    print(f"   Devices: {len(uidds)}")
    
    # Fetch data
    raw_data = videoloft.fetch_people_analytics(
        uidds=uidds,
        start_time=start_time,
        end_time=end_time,
        interval='date',
        timezone=os.getenv('TIMEZONE', 'Asia/Kuwait')
    )
    
    if not raw_data:
        return {
            'total_records': 0,
            'unique_devices': len(uidds),
            'date_range': None
        }
    
    # Calculate date range from fetched data
    timestamps = [r.get('firstTimestamp', 0) for r in raw_data if r.get('firstTimestamp')]
    if timestamps:
        min_ts = min(timestamps)
        max_ts = max(timestamps)
        min_date = datetime.fromtimestamp(min_ts / 1000 if min_ts > 1e10 else min_ts)
        max_date = datetime.fromtimestamp(max_ts / 1000 if max_ts > 1e10 else max_ts)
    else:
        min_date = None
        max_date = None
    
    return {
        'total_records': len(raw_data),
        'unique_devices': len(set([f"{r.get('uid', '')}.{r.get('deviceId', '')}" for r in raw_data])),
        'date_range': (min_date, max_date) if min_date and max_date else None
    }

def compare_data():
    """Compare database data with Videoloft data"""
    print("=" * 60)
    print("Historical Data Verification")
    print("=" * 60)
    print()
    
    # Get database summary
    print("📦 Checking database...")
    db_data = get_date_range_from_db()
    
    if not db_data or db_data['total_records'] == 0:
        print("❌ No data found in database!")
        return False
    
    print(f"   Total records: {db_data['total_records']}")
    print(f"   Unique devices: {db_data['unique_devices']}")
    print(f"   Date range: {db_data['min_date']} to {db_data['max_date']}")
    print()
    
    # Get Videoloft summary
    print("🌐 Checking Videoloft API...")
    videoloft_data = get_videoloft_data_summary(days_back=365)
    
    if not videoloft_data:
        print("❌ Failed to fetch data from Videoloft")
        return False
    
    print(f"   Total records available: {videoloft_data['total_records']}")
    print(f"   Unique devices: {videoloft_data['unique_devices']}")
    if videoloft_data['date_range']:
        print(f"   Date range: {videoloft_data['date_range'][0]} to {videoloft_data['date_range'][1]}")
    print()
    
    # Compare
    print("=" * 60)
    print("Comparison Results")
    print("=" * 60)
    
    # Check date coverage
    if db_data['min_date'] and videoloft_data['date_range']:
        db_min = db_data['min_date'].date()
        videoloft_min = videoloft_data['date_range'][0].date()
        
        if db_min <= videoloft_min:
            print(f"✅ Database covers from start: {db_min} (Videoloft: {videoloft_min})")
        else:
            print(f"⚠️  Database missing early data: DB starts {db_min}, Videoloft starts {videoloft_min}")
    
    if db_data['max_date'] and videoloft_data['date_range']:
        db_max = db_data['max_date'].date()
        videoloft_max = videoloft_data['date_range'][1].date()
        today = datetime.now().date()
        
        if db_max >= today - timedelta(days=1):
            print(f"✅ Database is up to date: {db_max} (Today: {today})")
        else:
            print(f"⚠️  Database missing recent data: DB ends {db_max}, Today: {today}")
    
    # Check record count (rough estimate)
    if videoloft_data['total_records'] > 0:
        # Videoloft returns one record per device per day
        # Database might have multiple records per day (hourly, etc.)
        print(f"📊 Videoloft has {videoloft_data['total_records']} records (date-level)")
        print(f"📊 Database has {db_data['total_records']} records (may include hourly/minute data)")
        print("   Note: Database may have more records if it includes hourly/minute intervals")
    
    print()
    print("=" * 60)
    print("Recommendation:")
    print("=" * 60)
    
    if db_data['max_date'] and db_data['max_date'].date() >= datetime.now().date() - timedelta(days=1):
        print("✅ Database appears to have recent data")
        print("   You can proceed with switching frontend to use the API")
    else:
        print("⚠️  Database may be missing recent data")
        print("   Consider running a full sync before switching frontend")
    
    return True

if __name__ == '__main__':
    compare_data()

