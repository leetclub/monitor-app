#!/usr/bin/env python3
"""
Verify historical-performance-sync results
Checks if sync is working correctly and data is complete
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

def check_sync_logs(engine):
    """Check sync logs for recent successful sync"""
    with engine.connect() as conn:
        try:
            # First check if table exists
            table_check = conn.execute(text("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'historical_performance_sync_logs'
                )
            """))
            table_exists = table_check.fetchone()[0]
            
            if not table_exists:
                print("📋 Sync logs table (historical_performance_sync_logs) not found, checking sync_logs table")
                # Fall back to generic sync_logs table
                result = conn.execute(text("""
                    SELECT 
                        MAX(sync_completed_at) as last_run,
                        COUNT(*) as total_runs,
                        SUM(CASE WHEN status IN ('success', 'completed') THEN 1 ELSE 0 END) as successful_runs
                    FROM sync_logs
                    WHERE status IN ('success', 'completed')
                    AND sync_completed_at > NOW() - INTERVAL '2 days'
                    ORDER BY sync_completed_at DESC
                    LIMIT 1
                """))
            else:
                # Check historical_performance_sync_logs table
                # Note: historical-performance-sync uses 'completed' status, not 'success'
                result = conn.execute(text("""
                    SELECT 
                        MAX(sync_completed_at) as last_run,
                        COUNT(*) as total_runs,
                        SUM(CASE WHEN status IN ('success', 'completed') THEN 1 ELSE 0 END) as successful_runs
                    FROM historical_performance_sync_logs
                    WHERE status IN ('success', 'completed')
                    AND sync_completed_at > NOW() - INTERVAL '2 days'
                """))
            
            row = result.fetchone()
            
            if row and row[0]:
                hours_ago = (datetime.utcnow() - row[0]).total_seconds() / 3600
                print(f"✅ Last successful sync: {row[0]} ({hours_ago:.1f} hours ago)")
                print(f"   Total runs in last 2 days: {row[1]}")
                print(f"   Successful: {row[2]}")
                
                if hours_ago <= 30:
                    return True, {
                        'last_run': row[0].isoformat(),
                        'hours_ago': hours_ago,
                        'total_runs': row[1],
                        'successful_runs': row[2]
                    }
                else:
                    return False, {
                        'last_run': row[0].isoformat(),
                        'hours_ago': hours_ago,
                        'error': f'Last sync was {hours_ago:.1f} hours ago (more than 30h)'
                    }
            else:
                print("⚠️  No successful sync found in last 2 days")
                return False, {'error': 'No successful sync found in last 2 days'}
        except Exception as e:
            print(f"⚠️  Could not check sync logs: {str(e)}")
            # If table doesn't exist, treat as non-critical (data might still be syncing)
            if 'does not exist' in str(e).lower() or 'relation' in str(e).lower():
                print("   📋 Table not found - this is non-critical if data exists")
                return False, {'error': f'Table not found: {str(e)}', 'non_critical': True}
            return False, {'error': f'Could not check sync logs: {str(e)}'}

def check_data_completeness(engine):
    """Check if data seems complete"""
    with engine.connect() as conn:
        # Get stats for last 30 days
        result = conn.execute(text("""
            SELECT 
                COUNT(DISTINCT machine_id) as machine_count,
                COUNT(*) as total_records,
                SUM(total_revenue) as total_revenue,
                SUM(total_quantity) as total_transactions,
                MAX(start_date) as latest_sync_date
            FROM historical_performance_records
            WHERE start_date > CURRENT_DATE - INTERVAL '30 days'
        """))
        
        stats = result.fetchone()
        if stats and stats[0] > 0:
            print(f"\n📊 Data statistics (last 30 days):")
            print(f"   Machines: {stats.machine_count}")
            print(f"   Total records: {stats.total_records}")
            print(f"   Total revenue: {stats.total_revenue:.2f} KWD")
            print(f"   Total transactions: {stats.total_transactions}")
            print(f"   Latest sync date: {stats.latest_sync_date}")
            
            return True, {
                'machine_count': stats.machine_count,
                'total_records': stats.total_records,
                'total_revenue': float(stats.total_revenue) if stats.total_revenue else 0,
                'total_transactions': stats.total_transactions,
                'latest_sync_date': stats.latest_sync_date.isoformat() if stats.latest_sync_date else None
            }
        else:
            print("⚠️  No data found in last 30 days")
            return False, {'error': 'No data in last 30 days'}

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

def main():
    """Main verification function"""
    print(f"\n{'='*80}")
    print(f"🔍 Verifying historical-performance-sync")
    print(f"{'='*80}\n")
    
    # Track verification results
    results = {
        'sync_logs_check': False,
        'data_completeness_check': False,
        'errors': [],
        'warnings': [],
        'machine_count': 0,
        'total_revenue': None,
        'total_transactions': 0
    }
    
    engine = get_db_connection()
    
    # Step 1: Check sync logs
    logs_ok, logs_info = check_sync_logs(engine)
    if not logs_ok:
        error_msg = logs_info.get('error', 'Sync logs check failed')
        results['errors'].append(error_msg)
    else:
        results['sync_logs_check'] = True
        if logs_info.get('hours_ago', 0) > 26:
            results['warnings'].append(f"Last sync was {logs_info.get('hours_ago', 0):.1f} hours ago (slightly delayed)")
    
    # Step 2: Check data completeness
    data_ok, data_stats = check_data_completeness(engine)
    if not data_ok:
        results['errors'].append('No data found in last 30 days')
    else:
        results['data_completeness_check'] = True
        if data_stats:
            results['machine_count'] = data_stats.get('machine_count', 0)
            results['total_revenue'] = f"{data_stats.get('total_revenue', 0):.2f} KWD"
            results['total_transactions'] = data_stats.get('total_transactions', 0)
    
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
        summary_parts.append(f"✅ All verifications passed for historical-performance-sync")
    else:
        summary_parts.append(f"❌ Verification {status} for historical-performance-sync")
    
    if results['machine_count'] > 0:
        summary_parts.append(f"Machines: {results['machine_count']}, Revenue: {results['total_revenue']}, Transactions: {results['total_transactions']}")
    
    summary = "\n".join(summary_parts)
    
    # Send results to admin panel
    now_kuwait = datetime.now(KUWAIT_TZ)
    yesterday = (now_kuwait - timedelta(days=1)).date()
    verification_data = {
        'sync_date': f"{yesterday.isoformat()}T00:00:00Z",
        'status': status,
        'sync_type': 'historical-performance-sync',
        'date_check': True,  # Not applicable for daily sync
        'sync_logs_check': results['sync_logs_check'],
        'data_completeness_check': results['data_completeness_check'],
        'api_verification_check': True,  # Not applicable
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
        print(f"✅ All verifications passed")
    else:
        print(f"❌ Verification {status}")
        if results['errors']:
            print("\nErrors:")
            for error in results['errors']:
                print(f"  - {error}")
        if results['warnings']:
            print("\nWarnings:")
            for warning in results['warnings']:
                print(f"  - {warning}")
    print(f"{'='*80}\n")
    
    sys.exit(0 if status == 'passed' else 1)

if __name__ == '__main__':
    main()
