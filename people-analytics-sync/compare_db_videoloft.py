#!/usr/bin/env python3
"""
Script to compare data from database with Videoloft API
Verifies that database data matches Videoloft data
"""
import os
import sys
from datetime import datetime, timedelta
from sync_service import VideoloftClient, PeopleAnalyticsSync
from models import PeopleAnalyticsRecord, create_engine_and_session
from sqlalchemy import func, and_

def get_db_data(uidds, start_date, end_date, interval='date'):
    """Get data from database"""
    engine, SessionLocal = create_engine_and_session()
    session = SessionLocal()
    
    try:
        query = session.query(PeopleAnalyticsRecord)
        
        # Filter by device IDs
        if uidds:
            query = query.filter(PeopleAnalyticsRecord.uidd.in_(uidds))
        
        # Filter by date range
        if start_date:
            query = query.filter(PeopleAnalyticsRecord.first_timestamp >= start_date)
        if end_date:
            end_date_with_time = end_date.replace(hour=23, minute=59, second=59)
            query = query.filter(PeopleAnalyticsRecord.first_timestamp <= end_date_with_time)
        
        # Filter by interval
        if interval:
            query = query.filter(PeopleAnalyticsRecord.interval_type == interval)
        
        records = query.order_by(PeopleAnalyticsRecord.first_timestamp).all()
        
        # Convert to comparable format
        db_data = []
        for record in records:
            db_data.append({
                'uidd': record.uidd,
                'first_timestamp': record.first_timestamp,
                'last_timestamp': record.last_timestamp,
                'in': record.people_in,
                'out': record.people_out,
                'net_traffic': record.net_traffic,
                'total_traffic': record.total_traffic
            })
        
        return db_data
    finally:
        session.close()

def get_videoloft_data(uidds, start_date, end_date, interval='date'):
    """Get data from Videoloft API"""
    videoloft = VideoloftClient()
    
    if not videoloft.authenticate():
        print("❌ Failed to authenticate with Videoloft")
        return None
    
    # Convert dates to timestamps
    start_time = int(start_date.timestamp() * 1000)
    end_time = int(end_date.replace(hour=23, minute=59, second=59).timestamp() * 1000)
    
    # Convert interval
    api_interval = interval
    if interval == 'hour':
        api_interval = 3600000
    elif interval == '60000' or interval == 'minute':
        api_interval = 60000
    
    raw_data = videoloft.fetch_people_analytics(
        uidds=uidds,
        start_time=start_time,
        end_time=end_time,
        interval=api_interval,
        timezone=os.getenv('TIMEZONE', 'Asia/Kuwait')
    )
    
    if not raw_data:
        return []
    
    # Convert to comparable format
    videoloft_data = []
    for record in raw_data:
        # Parse timestamps
        first_ts = record.get('firstTimestamp', 0)
        last_ts = record.get('lastTimestamp', 0)
        if first_ts > 0 and first_ts < 1e10:
            first_ts = first_ts * 1000
        if last_ts > 0 and last_ts < 1e10:
            last_ts = last_ts * 1000
        
        first_timestamp = datetime.fromtimestamp(first_ts / 1000)
        last_timestamp = datetime.fromtimestamp(last_ts / 1000)
        
        uid_str = str(record.get('uid', '')) if record.get('uid') is not None else ''
        device_id_str = str(record.get('deviceId', '')) if record.get('deviceId') is not None else ''
        uidd = f"{uid_str}.{device_id_str}" if uid_str and device_id_str else (uid_str or device_id_str or '')
        
        videoloft_data.append({
            'uidd': uidd,
            'first_timestamp': first_timestamp,
            'last_timestamp': last_timestamp,
            'in': record.get('in', 0),
            'out': record.get('out', 0),
            'net_traffic': record.get('in', 0) - record.get('out', 0),
            'total_traffic': record.get('in', 0) + record.get('out', 0)
        })
    
    return videoloft_data

def normalize_timestamp(ts):
    """Normalize timestamp to minute precision for comparison"""
    return ts.replace(second=0, microsecond=0)

def compare_data(db_data, videoloft_data):
    """Compare database data with Videoloft data"""
    print("=" * 80)
    print("Data Comparison: Database vs Videoloft")
    print("=" * 80)
    print()
    
    print(f"📦 Database records: {len(db_data)}")
    print(f"🌐 Videoloft records: {len(videoloft_data)}")
    print()
    
    # Create lookup maps
    db_map = {}
    for record in db_data:
        # Use normalized timestamp as key
        key = (record['uidd'], normalize_timestamp(record['first_timestamp']))
        db_map[key] = record
    
    videoloft_map = {}
    for record in videoloft_data:
        key = (record['uidd'], normalize_timestamp(record['first_timestamp']))
        videoloft_map[key] = record
    
    # Find matches and differences
    all_keys = set(db_map.keys()) | set(videoloft_map.keys())
    matches = []
    db_only = []
    videoloft_only = []
    differences = []
    
    for key in all_keys:
        db_rec = db_map.get(key)
        vl_rec = videoloft_map.get(key)
        
        if db_rec and vl_rec:
            # Compare values
            if (db_rec['in'] == vl_rec['in'] and 
                db_rec['out'] == vl_rec['out']):
                matches.append(key)
            else:
                differences.append({
                    'key': key,
                    'db': db_rec,
                    'videoloft': vl_rec
                })
        elif db_rec:
            db_only.append(key)
        elif vl_rec:
            videoloft_only.append(key)
    
    # Print results
    print("=" * 80)
    print("Comparison Results")
    print("=" * 80)
    print()
    
    print(f"✅ Matching records: {len(matches)}")
    print(f"⚠️  Records with differences: {len(differences)}")
    print(f"📦 Database only: {len(db_only)}")
    print(f"🌐 Videoloft only: {len(videoloft_only)}")
    print()
    
    # Show differences
    if differences:
        print("⚠️  Records with differences (first 10):")
        print("-" * 80)
        for diff in differences[:10]:
            key = diff['key']
            db = diff['db']
            vl = diff['videoloft']
            print(f"Device: {key[0]}, Time: {key[1]}")
            print(f"  DB:      in={db['in']}, out={db['out']}, net={db['net_traffic']}")
            print(f"  Videoloft: in={vl['in']}, out={vl['out']}, net={vl['net_traffic']}")
            print()
    
    # Show missing in database
    if videoloft_only:
        print(f"❌ Records in Videoloft but NOT in database ({len(videoloft_only)}):")
        print("-" * 80)
        for key in videoloft_only[:10]:
            rec = videoloft_map[key]
            print(f"  {key[0]} - {key[1]}: in={rec['in']}, out={rec['out']}")
        print()
    
    # Show extra in database
    if db_only:
        print(f"ℹ️  Records in database but NOT in Videoloft ({len(db_only)}):")
        print("   (This is OK - might be from different time periods or intervals)")
        print()
    
    # Summary
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    
    match_percentage = (len(matches) / len(videoloft_data) * 100) if videoloft_data else 0
    print(f"Match rate: {match_percentage:.1f}% ({len(matches)}/{len(videoloft_data)})")
    
    if match_percentage >= 95:
        print("✅ Database data matches Videoloft (95%+ match)")
    elif match_percentage >= 80:
        print("⚠️  Database data mostly matches Videoloft (80-95% match)")
    else:
        print("❌ Database data does not match Videoloft (<80% match)")
    
    return {
        'matches': len(matches),
        'differences': len(differences),
        'db_only': len(db_only),
        'videoloft_only': len(videoloft_only),
        'match_percentage': match_percentage
    }

def main():
    """Main comparison function"""
    if len(sys.argv) < 3:
        print("Usage: python compare_db_videoloft.py <start_date> <end_date> [uidds]")
        print("Example: python compare_db_videoloft.py 2026-01-14 2026-01-14")
        print("Example: python compare_db_videoloft.py 2026-01-14 2026-01-14 1382465.21,1382465.6")
        sys.exit(1)
    
    start_date_str = sys.argv[1]
    end_date_str = sys.argv[2]
    uidds_param = sys.argv[3] if len(sys.argv) > 3 else None
    
    # Parse dates
    start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
    end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
    
    # Parse uidds
    uidds = None
    if uidds_param:
        uidds = [uid.strip() for uid in uidds_param.split(',')]
    
    print("=" * 80)
    print("Comparing Database with Videoloft")
    print("=" * 80)
    print(f"Date range: {start_date.date()} to {end_date.date()}")
    if uidds:
        print(f"Devices: {', '.join(uidds)}")
    else:
        print("Devices: All")
    print()
    
    # Get data from both sources
    print("📦 Fetching data from database...")
    db_data = get_db_data(uidds, start_date, end_date, interval='date')
    print(f"   Found {len(db_data)} records")
    print()
    
    print("🌐 Fetching data from Videoloft...")
    videoloft_data = get_videoloft_data(uidds, start_date, end_date, interval='date')
    if videoloft_data is None:
        print("❌ Failed to fetch from Videoloft")
        sys.exit(1)
    print(f"   Found {len(videoloft_data)} records")
    print()
    
    # Compare
    result = compare_data(db_data, videoloft_data)
    
    # Exit code based on match
    if result['match_percentage'] >= 95:
        sys.exit(0)  # Success
    else:
        sys.exit(1)  # Warning/Error

if __name__ == '__main__':
    main()

