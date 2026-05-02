#!/usr/bin/env python3
"""
Manual sync script for a specific date
Usage: python sync_specific_date.py YYYY-MM-DD
"""
import sys
import os
from datetime import datetime, timedelta, timezone
from sync_service import VendonSalesSync

KUWAIT_TZ = timezone(timedelta(hours=3))

def main():
    if len(sys.argv) < 2:
        print("Usage: python sync_specific_date.py YYYY-MM-DD")
        print("Example: python sync_specific_date.py 2026-01-17")
        sys.exit(1)
    
    date_str = sys.argv[1]
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        print(f"Invalid date format: {date_str}. Use YYYY-MM-DD")
        sys.exit(1)
    
    print(f"Syncing data for date: {target_date}")
    
    sync = VendonSalesSync()
    sync_id = sync.start_sync()
    
    if not sync_id:
        print("Failed to start sync")
        sys.exit(1)
    
    try:
        # Override the date range to sync only the specified date
        machines = sync.vendon.fetch_machines()
        if not machines:
            print("No machines found")
            sync.complete_sync('failed', 0, error_message="No machines found")
            sys.exit(1)
        
        print(f"Found {len(machines)} machines")
        
        # Calculate timestamps for the target date in Kuwait timezone
        start_dt = datetime.combine(target_date, datetime.min.time(), tzinfo=KUWAIT_TZ)
        end_dt = datetime.combine(target_date, datetime.max.time(), tzinfo=KUWAIT_TZ)
        from_timestamp = int(start_dt.timestamp())
        to_timestamp = int(end_dt.timestamp())
        
        print(f"Date range: {target_date} Kuwait ({from_timestamp} to {to_timestamp})")
        
        total_records = 0
        
        # Sync each machine for the target date
        for machine in machines:
            machine_id = machine['id']
            machine_name = machine['name']
            
            try:
                # Fetch sales for this machine and date
                vends = sync.vendon.fetch_sales(
                    machine_id=machine_id,
                    from_timestamp=from_timestamp,
                    to_timestamp=to_timestamp
                )
                
                if vends is None:
                    print(f"⚠️  Failed to fetch sales for machine {machine_id} ({machine_name}) on {target_date}")
                    continue
                
                # Calculate totals
                total_revenue = sum(vend.get('price', 0) for vend in vends)
                total_transactions = len(vends)
                
                # Get machine name from first vend (if available)
                if vends and len(vends) > 0:
                    machine_name = vends[0].get('machine_name', machine_name)
                
                # Store in database
                if sync._store_daily_sales(
                    machine_id=machine_id,
                    machine_name=machine_name,
                    sale_date=target_date,
                    total_revenue=total_revenue,
                    total_transactions=total_transactions,
                    raw_vends=vends
                ):
                    total_records += 1
                    print(f"✅ Stored: {machine_name} ({machine_id}) - {total_revenue:.2f} KWD, {total_transactions} transactions")
                else:
                    print(f"⚠️  Failed to store data for {machine_id}")
                    
            except Exception as e:
                print(f"❌ Error syncing machine {machine_id}: {str(e)}")
                continue
        
        # Complete sync
        sync.complete_sync('success', total_records)
        print(f"\n✅ Sync complete! Processed {total_records} machines")
        
    except Exception as e:
        print(f"❌ Sync failed: {str(e)}")
        sync.complete_sync('failed', total_records, error_message=str(e))
        sys.exit(1)

if __name__ == '__main__':
    main()


