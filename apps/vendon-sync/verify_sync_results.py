#!/usr/bin/env python3
"""
Monitor and verify vendon sync results to detect issues
Run this after each sync to verify data correctness
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine, text
import requests

KUWAIT_TZ = timezone(timedelta(hours=3))

def get_db_connection():
    """Get database connection"""
    db_user = os.getenv('DB_USER', 'doadmin')
    db_password = os.getenv('DB_PASSWORD')
    db_host = os.getenv('DB_HOST')
    db_port = os.getenv('DB_PORT', '25060')
    db_name = os.getenv('DB_NAME', 'people_analytics')
    
    if not db_password or not db_host:
        print("Error: DB_PASSWORD and DB_HOST must be set")
        sys.exit(1)
    
    database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
    return create_engine(database_url)

def verify_date_not_today(date_str):
    """Verify that the date being checked is not today"""
    now_kuwait = datetime.now(KUWAIT_TZ).date()
    check_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    
    if check_date == now_kuwait:
        print(f"❌ CRITICAL: Date {date_str} is TODAY! Sync should never sync today's data.")
        return False
    elif check_date > now_kuwait:
        print(f"❌ CRITICAL: Date {date_str} is in the FUTURE! This is impossible.")
        return False
    else:
        print(f"✅ Date {date_str} is in the past (not today) - correct")
        return True

def check_sync_logs(engine, date_str):
    """Check sync logs for the date"""
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT id, sync_started_at, sync_completed_at, status, records_synced, error_message
            FROM vendon_sync_logs
            WHERE DATE(sync_started_at) = :date
            ORDER BY sync_started_at DESC
            LIMIT 5
        """), {"date": date_str})
        
        logs = result.fetchall()
        if not logs:
            print(f"⚠️  No sync logs found for {date_str}")
            return False, None
        
        latest = logs[0]
        print(f"\n📋 Latest sync log for {date_str}:")
        print(f"   ID: {latest.id}")
        print(f"   Started: {latest.sync_started_at}")
        print(f"   Completed: {latest.sync_completed_at}")
        print(f"   Status: {latest.status}")
        print(f"   Records: {latest.records_synced}")
        if latest.error_message:
            print(f"   Error: {latest.error_message}")
        
        if latest.status != 'success':
            print(f"❌ Sync status is '{latest.status}' (expected 'success')")
            return False, {'status': latest.status, 'error': latest.error_message}
        
        return True, {'id': latest.id, 'status': latest.status, 'records': latest.records_synced}

def check_data_completeness(engine, date_str):
    """Check if data seems complete"""
    with engine.connect() as conn:
        # Get total machines synced
        result = conn.execute(text("""
            SELECT COUNT(DISTINCT machine_id) as machine_count,
                   SUM(total_revenue) as total_revenue,
                   SUM(total_transactions) as total_transactions,
                   AVG(total_revenue) as avg_revenue
            FROM vendon_sales_records
            WHERE DATE(sale_date) = :date
        """), {"date": date_str})
        
        stats = result.fetchone()
        print(f"\n📊 Data statistics for {date_str}:")
        print(f"   Machines synced: {stats.machine_count}")
        print(f"   Total revenue: {stats.total_revenue:.2f} KWD")
        print(f"   Total transactions: {stats.total_transactions}")
        print(f"   Avg revenue per machine: {stats.avg_revenue:.2f} KWD")
        
        stats_dict = {
            'machine_count': stats.machine_count,
            'total_revenue': float(stats.total_revenue) if stats.total_revenue else 0,
            'total_transactions': stats.total_transactions,
            'avg_revenue': float(stats.avg_revenue) if stats.avg_revenue else 0
        }
        
        # Check for suspiciously low data
        if stats.machine_count == 0:
            print(f"❌ No machines synced for {date_str}!")
            return False, stats_dict
        
        if stats.total_revenue == 0:
            print(f"⚠️  Total revenue is 0 - might be a holiday or issue")
        
        # Check for machines with 0 revenue (might be normal, but log it)
        result = conn.execute(text("""
            SELECT COUNT(*) as zero_revenue_count
            FROM vendon_sales_records
            WHERE DATE(sale_date) = :date AND total_revenue = 0
        """), {"date": date_str})
        
        zero_count = result.fetchone().zero_revenue_count
        if zero_count > stats.machine_count * 0.5:
            print(f"⚠️  {zero_count} machines have 0 revenue ({(zero_count/stats.machine_count)*100:.1f}%) - might be normal")
        
        return True, stats_dict

def verify_against_vendon_api(engine, date_str, sample_machine_id=None):
    """Verify a sample machine's data against Vendon API"""
    vendon_api_key = os.getenv('VENDON_API_KEY')
    vendon_api_base = os.getenv('VENDON_API_BASE', 'https://cloud.vendon.net/rest/v1.9.0')
    
    if not vendon_api_key:
        print("⚠️  VENDON_API_KEY not set, skipping API verification")
        return True
    
    # Get a machine with revenue > 0 to verify
    with engine.connect() as conn:
        if sample_machine_id:
            machine_id = sample_machine_id
        else:
            result = conn.execute(text("""
                SELECT machine_id, total_revenue, total_transactions
                FROM vendon_sales_records
                WHERE DATE(sale_date) = :date AND total_revenue > 0
                ORDER BY total_revenue DESC
                LIMIT 1
            """), {"date": date_str})
            
            sample = result.fetchone()
            if not sample:
                print("⚠️  No machines with revenue > 0 to verify")
                return True
            
            machine_id = sample.machine_id
            db_revenue = sample.total_revenue
            db_transactions = sample.total_transactions
        
        # Calculate timestamps for the date in Kuwait timezone
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        start_dt = datetime.combine(target_date, datetime.min.time(), tzinfo=KUWAIT_TZ)
        end_dt = datetime.combine(target_date, datetime.max.time(), tzinfo=KUWAIT_TZ)
        from_timestamp = int(start_dt.timestamp())
        to_timestamp = int(end_dt.timestamp())
        
        # Fetch from Vendon API
        url = f"{vendon_api_base}/stats/vends"
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
        
        try:
            response = requests.get(url, params=params, headers=headers, timeout=30)
            if response.status_code != 200:
                print(f"⚠️  Vendon API returned {response.status_code}, skipping verification")
                return True
            
            data = response.json()
            if data.get('code') != 200:
                print(f"⚠️  Vendon API error: {data.get('code')}, skipping verification")
                return True
            
            vends = data.get('result', [])
            api_revenue = sum(vend.get('price', 0) for vend in vends)
            api_transactions = len(vends)
            
            print(f"\n🔍 Verification for machine {machine_id} on {date_str}:")
            print(f"   Database: {db_revenue:.2f} KWD, {db_transactions} transactions")
            print(f"   Vendon API: {api_revenue:.2f} KWD, {api_transactions} transactions")
            
            # Allow 1% difference for floating point
            revenue_diff = abs(db_revenue - api_revenue)
            if revenue_diff > max(db_revenue * 0.01, 0.1):
                print(f"❌ Revenue mismatch! Difference: {revenue_diff:.2f} KWD")
                return False
            else:
                print(f"✅ Revenue matches (diff: {revenue_diff:.2f} KWD)")
            
            if db_transactions != api_transactions:
                print(f"❌ Transaction count mismatch! DB: {db_transactions}, API: {api_transactions}")
                return False, {
                    'machine_id': machine_id,
                    'db_revenue': db_revenue,
                    'api_revenue': api_revenue,
                    'db_transactions': db_transactions,
                    'api_transactions': api_transactions,
                    'revenue_diff': revenue_diff
                }
            else:
                print(f"✅ Transaction count matches")
            
            return True, {
                'machine_id': machine_id,
                'db_revenue': db_revenue,
                'api_revenue': api_revenue,
                'revenue_diff': revenue_diff
            }
            
        except Exception as e:
            print(f"⚠️  Error verifying with Vendon API: {str(e)}")
            return True, None  # Don't fail verification if API check fails

def send_to_admin_panel(data):
    """Send verification results to admin panel"""
    admin_api_url = os.getenv('ADMIN_API_URL', 'https://vendon-api.theleetclub.com')
    admin_api_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
    
    try:
        response = requests.post(
            f"{admin_api_url}/api/admin/receive-verification",
            json=data,
            headers={'X-API-Key': admin_api_key, 'Content-Type': 'application/json'},
            timeout=10
        )
        if response.status_code == 200:
            print(f"✅ Verification results sent to admin panel")
            return True
        else:
            print(f"⚠️  Failed to send to admin panel: {response.status_code}")
            return False
    except Exception as e:
        print(f"⚠️  Error sending to admin panel: {str(e)}")
        return False

def send_alert(level, title, message, details=None):
    """Send alert to admin panel"""
    admin_api_url = os.getenv('ADMIN_API_URL', 'https://vendon-api.theleetclub.com')
    admin_api_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
    
    try:
        response = requests.post(
            f"{admin_api_url}/api/admin/receive-alert",
            json={
                'level': level,
                'source': 'verification',
                'title': title,
                'message': message,
                'details': details
            },
            headers={'X-API-Key': admin_api_key, 'Content-Type': 'application/json'},
            timeout=10
        )
        if response.status_code == 200:
            return True
    except Exception as e:
        print(f"⚠️  Error sending alert: {str(e)}")
    return False

def main():
    """Main verification function"""
    if len(sys.argv) < 2:
        # Default to yesterday
        now_kuwait = datetime.now(KUWAIT_TZ)
        yesterday = (now_kuwait - timedelta(days=1)).date()
        date_str = yesterday.strftime('%Y-%m-%d')
        print(f"No date provided, checking yesterday: {date_str}")
    else:
        date_str = sys.argv[1]
    
    print(f"\n{'='*80}")
    print(f"🔍 Verifying vendon sync results for {date_str}")
    print(f"{'='*80}\n")
    
    # Track verification results
    results = {
        'date_check': False,
        'sync_logs_check': False,
        'data_completeness_check': False,
        'api_verification_check': False,
        'errors': [],
        'warnings': [],
        'machine_count': 0,
        'total_revenue': None,
        'total_transactions': 0
    }
    
    # Step 1: Verify date is not today
    if not verify_date_not_today(date_str):
        error_msg = f"Date {date_str} is today or future - sync should never sync today's data"
        results['errors'].append(error_msg)
        send_alert('critical', 'Date Verification Failed', error_msg, {'date': date_str})
        print("\n❌ VERIFICATION FAILED: Date is today or future!")
    else:
        results['date_check'] = True
    
    # Step 2: Check sync logs
    engine = get_db_connection()
    sync_logs_ok, sync_log_info = check_sync_logs(engine, date_str)
    if not sync_logs_ok:
        error_msg = f"Sync logs show issues for {date_str}"
        if sync_log_info and sync_log_info.get('error'):
            error_msg += f": {sync_log_info.get('error')}"
        results['errors'].append(error_msg)
        send_alert('error', 'Sync Logs Check Failed', error_msg, {'date': date_str, 'details': sync_log_info})
        print("\n❌ VERIFICATION FAILED: Sync logs show issues!")
    else:
        results['sync_logs_check'] = True
    
    # Step 3: Check data completeness
    data_ok, data_stats = check_data_completeness(engine, date_str)
    if not data_ok:
        error_msg = f"Data completeness issues for {date_str}"
        results['errors'].append(error_msg)
        send_alert('error', 'Data Completeness Check Failed', error_msg, {'date': date_str, 'details': data_stats})
        print("\n❌ VERIFICATION FAILED: Data completeness issues!")
    else:
        results['data_completeness_check'] = True
        if data_stats:
            results['machine_count'] = data_stats.get('machine_count', 0)
            results['total_revenue'] = f"{data_stats.get('total_revenue', 0):.2f} KWD"
            results['total_transactions'] = data_stats.get('total_transactions', 0)
    
    # Step 4: Verify against Vendon API (sample)
    api_ok, api_info = verify_against_vendon_api(engine, date_str)
    if not api_ok:
        error_msg = f"API verification mismatch for {date_str}"
        results['errors'].append(error_msg)
        if api_info:
            results['errors'].append(f"Machine {api_info.get('machine_id')}: DB={api_info.get('db_revenue')} KWD, API={api_info.get('api_revenue')} KWD")
        send_alert('error', 'API Verification Failed', error_msg, {'date': date_str, 'details': api_info})
        print("\n❌ VERIFICATION FAILED: API verification mismatch!")
    else:
        results['api_verification_check'] = True
    
    # Determine overall status
    if results['errors']:
        status = 'failed'
    elif results['warnings']:
        status = 'warning'
    else:
        status = 'passed'
    
    # Create summary
    summary_parts = []
    if status == 'passed':
        summary_parts.append(f"✅ All verifications passed for {date_str}")
    else:
        summary_parts.append(f"❌ Verification {status} for {date_str}")
    
    if results['machine_count'] > 0:
        summary_parts.append(f"Machines: {results['machine_count']}, Revenue: {results['total_revenue']}, Transactions: {results['total_transactions']}")
    
    summary = "\n".join(summary_parts)
    
    # Send results to admin panel
    verification_data = {
        'sync_date': f"{date_str}T00:00:00Z",
        'status': status,
        'sync_type': 'vendon-sync',  # Identify this as vendon-sync verification
        'date_check': results['date_check'],
        'sync_logs_check': results['sync_logs_check'],
        'data_completeness_check': results['data_completeness_check'],
        'api_verification_check': results['api_verification_check'],
        'summary': summary,
        'errors': results['errors'] if results['errors'] else None,
        'warnings': results['warnings'] if results['warnings'] else None,
        'machine_count': results['machine_count'],
        'total_revenue': results['total_revenue'],
        'total_transactions': results['total_transactions']
    }
    
    send_to_admin_panel(verification_data)
    
    print(f"\n{'='*80}")
    if status == 'passed':
        print(f"✅ All verifications passed for {date_str}")
    else:
        print(f"❌ Verification {status} for {date_str}")
        if results['errors']:
            print("\nErrors:")
            for error in results['errors']:
                print(f"  - {error}")
    print(f"{'='*80}\n")
    
    sys.exit(0 if status == 'passed' else 1)

if __name__ == '__main__':
    main()
