#!/usr/bin/env python3
"""
Script to verify historical performance data accuracy by comparing
cached database values with direct Vendon API calls
"""
import os
import sys
import requests
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import HistoricalPerformanceRecord, create_engine_and_session

# Kuwait timezone
KUWAIT_TZ = timezone(timedelta(hours=3))

def get_vendon_data(machine_id, date_str, vendon_api_key):
    """Get data directly from Vendon API for a specific machine and date"""
    # Calculate Kuwait timezone boundaries
    date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    start_dt = datetime.combine(date_obj, datetime.min.time(), tzinfo=KUWAIT_TZ)
    end_dt = datetime.combine(date_obj, datetime.max.time(), tzinfo=KUWAIT_TZ)
    from_timestamp = int(start_dt.timestamp())
    to_timestamp = int(end_dt.timestamp())
    
    url = "https://cloud.vendon.net/rest/v1.9.0/stats/vends"
    params = {
        'from_timestamp': from_timestamp,
        'to_timestamp': to_timestamp,
        'machine_id': machine_id,
        'limit': 10000
    }
    headers = {
        'Authorization': f'Token {vendon_api_key}',
        'Accept': 'application/json'
    }
    
    all_vends = []
    offset = 0
    while True:
        params['offset'] = offset
        response = requests.get(url, params=params, headers=headers, timeout=60)
        if response.status_code != 200:
            break
        data = response.json()
        if data.get('code') != 200:
            break
        vends = data.get('result', [])
        if not vends:
            break
        all_vends.extend(vends)
        if len(vends) < 10000:
            break
        offset += 10000
    
    total_revenue = sum(v.get('price', 0) for v in all_vends)
    total_quantity = len(all_vends)
    
    return {
        'revenue': round(total_revenue, 2),
        'quantity': total_quantity,
        'vends': all_vends
    }

def get_cached_data(machine_id, date_str, session):
    """Get data from cached database"""
    date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
    kuwait_tz = timezone(timedelta(hours=3))
    start_dt_kuwait = datetime.combine(date_obj, datetime.min.time(), tzinfo=kuwait_tz)
    end_dt_kuwait = datetime.combine(date_obj, datetime.max.time(), tzinfo=kuwait_tz)
    start_datetime_utc = start_dt_kuwait.astimezone(timezone.utc).replace(tzinfo=None)
    end_datetime_utc = end_dt_kuwait.astimezone(timezone.utc).replace(tzinfo=None)
    
    record = session.query(HistoricalPerformanceRecord).filter(
        HistoricalPerformanceRecord.machine_id == machine_id,
        HistoricalPerformanceRecord.start_date <= end_datetime_utc,
        HistoricalPerformanceRecord.end_date >= start_datetime_utc,
        HistoricalPerformanceRecord.start_date == HistoricalPerformanceRecord.end_date
    ).first()
    
    if record:
        return {
            'revenue': round(record.total_revenue, 2),
            'quantity': record.total_quantity
        }
    return None

if __name__ == '__main__':
    # Get credentials from environment or Kubernetes
    vendon_api_key = os.getenv('VENDON_API_KEY')
    if not vendon_api_key:
        print("VENDON_API_KEY not set")
        sys.exit(1)
    
    engine, Session = create_engine_and_session()
    session = Session()
    
    # Test with a specific machine and date
    machine_id = "375535"  # Jaber Hospital - Gate 2
    test_date = (datetime.now(KUWAIT_TZ).date() - timedelta(days=1)).isoformat()  # Yesterday
    
    print(f"Testing machine {machine_id} for date {test_date}")
    print("=" * 60)
    
    # Get Vendon data
    print("Fetching from Vendon API...")
    vendon_data = get_vendon_data(machine_id, test_date, vendon_api_key)
    print(f"Vendon API: {vendon_data['revenue']} KWD, {vendon_data['quantity']} vends")
    
    # Get cached data
    print("Fetching from cached database...")
    cached_data = get_cached_data(machine_id, test_date, session)
    if cached_data:
        print(f"Cached DB: {cached_data['revenue']} KWD, {cached_data['quantity']} vends")
        
        # Compare
        revenue_diff = abs(vendon_data['revenue'] - cached_data['revenue'])
        quantity_diff = abs(vendon_data['quantity'] - cached_data['quantity'])
        
        print("=" * 60)
        if revenue_diff < 0.01 and quantity_diff == 0:
            print("✅ Data matches exactly!")
        else:
            print(f"❌ Mismatch detected:")
            print(f"   Revenue difference: {revenue_diff} KWD")
            print(f"   Quantity difference: {quantity_diff} vends")
    else:
        print("❌ No cached data found")
    
    session.close()

