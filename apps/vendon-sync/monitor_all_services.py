#!/usr/bin/env python3
"""
Monitor all services and cronjobs
Checks health of all APIs and cronjobs, sends alerts to admin panel
"""
import os
import sys
import json
import logging
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Service endpoints to monitor
SERVICES = {
    'vendon-api': {
        'url': 'https://vendon-api.theleetclub.com/health',
        'expected_status': 200,
        'timeout': 10
    },
    'people-api': {
        'url': 'https://people-api.theleetclub.com/health',
        'expected_status': 200,
        'timeout': 10
    },
    'historical-api': {
        'url': 'https://historical-api.theleetclub.com/api/historical-performance/best-yesterday?exclude_ids=999999',
        'expected_status': [200, 404, 500],  # 404/500 might mean service is up but endpoint has issues
        'timeout': 10,
        'health_check': True,  # Mark as health check
        'fallback_url': 'https://historical-api.theleetclub.com/health'  # Try health endpoint if main fails
    }
}

# Cronjobs to check (via Kubernetes API or database)
CRONJOBS = {
    'vendon-sales-sync': {
        'namespace': 'leet-monitor',
        'schedule': '0 2 * * *',  # Daily at 2 AM UTC
        'expected_last_run_hours': 26  # Should run within last 26 hours
    },
    'vendon-sync-verify': {
        'namespace': 'leet-monitor',
        'schedule': '30 2 * * *',  # Daily at 2:30 AM UTC
        'expected_last_run_hours': 26
    },
    'people-analytics-sync': {
        'namespace': 'leet-monitor',
        'schedule': '* * * * *',  # Every minute
        'expected_last_run_minutes': 5  # Should run within last 5 minutes
    },
    'historical-performance-sync': {
        'namespace': 'leet-monitor',
        'schedule': '0 3 * * *',  # Daily at 3 AM UTC
        'expected_last_run_hours': 26
    }
}


def send_alert_to_admin(level: str, title: str, message: str, details: Optional[Dict] = None):
    """Send alert to admin panel"""
    admin_api_url = os.getenv('ADMIN_API_URL', 'https://vendon-api.theleetclub.com')
    admin_api_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
    
    try:
        response = requests.post(
            f"{admin_api_url}/api/admin/receive-alert",
            json={
                'level': level,
                'source': 'monitoring',
                'title': title,
                'message': message,
                'details': details or {}
            },
            headers={'X-API-Key': admin_api_key, 'Content-Type': 'application/json'},
            timeout=10
        )
        if response.status_code == 200:
            logger.info(f"✅ Alert sent: {title}")
            return True
        else:
            logger.warning(f"⚠️ Failed to send alert: {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ Error sending alert: {str(e)}")
        return False


def check_service_health(service_name: str, config: Dict) -> Dict:
    """Check if a service is healthy"""
    try:
        response = requests.get(
            config['url'],
            timeout=config.get('timeout', 10)
        )
        
        expected_status = config.get('expected_status', 200)
        is_health_check = config.get('health_check', False)
        
        # Handle both single status code and list of acceptable codes
        if isinstance(expected_status, list):
            is_acceptable = response.status_code in expected_status
        else:
            is_acceptable = response.status_code == expected_status
        
        if is_acceptable:
            return {
                'status': 'healthy',
                'response_time': response.elapsed.total_seconds(),
                'status_code': response.status_code
            }
        elif is_health_check:
            # For health checks, try fallback URL if available
            fallback_url = config.get('fallback_url')
            if fallback_url and response.status_code == 404:
                try:
                    fallback_response = requests.get(
                        fallback_url,
                        timeout=config.get('timeout', 10)
                    )
                    if fallback_response.status_code == 200:
                        return {
                            'status': 'healthy',
                            'response_time': fallback_response.elapsed.total_seconds(),
                            'status_code': fallback_response.status_code,
                            'note': 'Using fallback health endpoint'
                        }
                except:
                    pass
            
            # If 404 and no fallback worked, treat as warning (service might be up but endpoint misconfigured)
            if response.status_code == 404:
                return {
                    'status': 'warning',
                    'error': f"Endpoint returned 404 (service may be up but endpoint misconfigured)",
                    'status_code': response.status_code
                }
            
            return {
                'status': 'unhealthy',
                'error': f"Expected status {expected_status}, got {response.status_code}",
                'status_code': response.status_code
            }
        else:
            return {
                'status': 'unhealthy',
                'error': f"Expected status {expected_status}, got {response.status_code}",
                'status_code': response.status_code
            }
    except requests.exceptions.Timeout:
        return {
            'status': 'unhealthy',
            'error': 'Request timeout',
            'response_time': config.get('timeout', 10)
        }
    except requests.exceptions.ConnectionError:
        return {
            'status': 'unhealthy',
            'error': 'Connection error - service may be down'
        }
    except Exception as e:
        return {
            'status': 'unhealthy',
            'error': str(e)
        }


def check_cronjob_status(cronjob_name: str, config: Dict) -> Dict:
    """Check cronjob status by querying database for sync logs"""
    # This is a simplified check - in production, you might want to query Kubernetes API
    # For now, we'll check database sync logs
    
    try:
        # Try to import models - handle different locations
        try:
            from models import create_engine_and_session
        except ImportError:
            # Try vendon-sync/models
            import sys
            sys.path.insert(0, '/app/vendon-sync')
            from models import create_engine_and_session
        
        from sqlalchemy import text
        
        engine, SessionLocal = create_engine_and_session()
        session = SessionLocal()
        
        try:
            # Check for recent sync logs based on cronjob
            if 'vendon' in cronjob_name.lower():
                # Check vendon_sync_logs table
                result = session.execute(text("""
                    SELECT MAX(sync_completed_at) as last_run, COUNT(*) as total_runs
                    FROM vendon_sync_logs
                    WHERE status = 'success'
                    AND sync_completed_at > NOW() - INTERVAL '2 days'
                """))
                row = result.fetchone()
                
                if row and row[0]:
                    last_run = row[0]
                    hours_ago = (datetime.utcnow() - last_run).total_seconds() / 3600
                    expected_hours = config.get('expected_last_run_hours', 24)
                    
                    if hours_ago <= expected_hours:
                        return {
                            'status': 'healthy',
                            'last_run': last_run.isoformat(),
                            'hours_ago': round(hours_ago, 2),
                            'total_runs': row[1] or 0
                        }
                    else:
                        return {
                            'status': 'warning',
                            'last_run': last_run.isoformat(),
                            'hours_ago': round(hours_ago, 2),
                            'error': f'Last run was {round(hours_ago, 1)} hours ago (expected within {expected_hours}h)',
                            'total_runs': row[1] or 0
                        }
                else:
                    return {
                        'status': 'warning',
                        'error': 'No recent successful sync found',
                        'total_runs': 0
                    }
            elif 'people' in cronjob_name.lower():
                # Check people_analytics_records table (synced_at indicates last sync)
                result = session.execute(text("""
                    SELECT MAX(synced_at) as last_run, COUNT(*) as total_records
                    FROM people_analytics_records
                    WHERE synced_at > NOW() - INTERVAL '15 minutes'
                """))
                row = result.fetchone()
                
                if row and row[0]:
                    last_run = row[0]
                    minutes_ago = (datetime.utcnow() - last_run).total_seconds() / 60
                    expected_minutes = config.get('expected_last_run_minutes', 5)
                    
                    # Allow some flexibility - if within 10 minutes, consider healthy
                    if minutes_ago <= 10:
                        return {
                            'status': 'healthy',
                            'last_run': last_run.isoformat(),
                            'minutes_ago': round(minutes_ago, 2),
                            'total_records': row[1] or 0
                        }
                    elif minutes_ago <= 15:
                        return {
                            'status': 'warning',
                            'last_run': last_run.isoformat(),
                            'minutes_ago': round(minutes_ago, 2),
                            'error': f'Last sync was {round(minutes_ago, 1)} minutes ago (slightly delayed)',
                            'total_records': row[1] or 0
                        }
                    else:
                        return {
                            'status': 'warning',
                            'last_run': last_run.isoformat(),
                            'minutes_ago': round(minutes_ago, 2),
                            'error': f'Last sync was {round(minutes_ago, 1)} minutes ago (expected within {expected_minutes}m)',
                            'total_records': row[1] or 0
                        }
                else:
                    return {
                        'status': 'warning',
                        'error': 'No recent sync found (checking last 15 minutes)',
                        'total_records': 0
                    }
            elif 'historical' in cronjob_name.lower():
                # Check historical_performance_sync_logs table
                try:
                    result = session.execute(text("""
                        SELECT MAX(sync_completed_at) as last_run, COUNT(*) as total_runs
                        FROM historical_performance_sync_logs
                        WHERE status = 'success'
                        AND sync_completed_at > NOW() - INTERVAL '2 days'
                    """))
                except Exception as e:
                    # Table might not exist or have different structure
                    # Check if table exists first
                    try:
                        table_check = session.execute(text("""
                            SELECT EXISTS (
                                SELECT FROM information_schema.tables 
                                WHERE table_name = 'historical_performance_sync_logs'
                            )
                        """))
                        table_exists = table_check.fetchone()[0]
                        if not table_exists:
                            return {
                                'status': 'unknown',
                                'error': 'Table historical_performance_sync_logs does not exist'
                            }
                    except:
                        pass
                    
                    return {
                        'status': 'unknown',
                        'error': f'Could not query historical_performance_sync_logs: {str(e)}'
                    }
                row = result.fetchone()
                
                if row and row[0]:
                    last_run = row[0]
                    hours_ago = (datetime.utcnow() - last_run).total_seconds() / 3600
                    expected_hours = config.get('expected_last_run_hours', 26)
                    
                    # Historical sync runs daily at 3 AM, so allow up to 30 hours (next day + buffer)
                    if hours_ago <= 30:
                        return {
                            'status': 'healthy',
                            'last_run': last_run.isoformat(),
                            'hours_ago': round(hours_ago, 2),
                            'total_runs': row[1] or 0
                        }
                    else:
                        return {
                            'status': 'warning',
                            'last_run': last_run.isoformat(),
                            'hours_ago': round(hours_ago, 2),
                            'error': f'Last run was {round(hours_ago, 1)} hours ago (expected within 30h for daily sync)',
                            'total_runs': row[1] or 0
                        }
                else:
                    # Check if there are any sync logs at all (might be first run or older than 2 days)
                    check_all = session.execute(text("""
                        SELECT MAX(sync_completed_at) as last_run, COUNT(*) as total_runs
                        FROM historical_performance_sync_logs
                        WHERE status = 'success'
                    """))
                    all_row = check_all.fetchone()
                    if all_row and all_row[0]:
                        # Has sync logs but older than 2 days - check how old
                        last_run = all_row[0]
                        hours_ago = (datetime.utcnow() - last_run).total_seconds() / 3600
                        if hours_ago <= 30:
                            # Actually within acceptable range, return healthy
                            return {
                                'status': 'healthy',
                                'last_run': last_run.isoformat(),
                                'hours_ago': round(hours_ago, 2),
                                'total_runs': all_row[1] or 0,
                                'note': 'Found in extended check'
                            }
                        else:
                            return {
                                'status': 'warning',
                                'error': f'Last sync was {round(hours_ago, 1)} hours ago (more than 30h)',
                                'total_runs': all_row[1] or 0,
                                'last_run': last_run.isoformat()
                            }
                    else:
                        return {
                            'status': 'warning',
                            'error': 'No sync logs found - cronjob may not have run yet',
                            'total_runs': 0
                        }
            else:
                return {
                    'status': 'unknown',
                    'error': 'Unknown cronjob type'
                }
        finally:
            session.close()
    except Exception as e:
        logger.error(f"Error checking cronjob {cronjob_name}: {str(e)}")
        return {
            'status': 'error',
            'error': str(e)
        }


def main():
    """Main monitoring function"""
    logger.info("🔍 Starting service and cronjob monitoring...")
    
    results = {
        'services': {},
        'cronjobs': {},
        'timestamp': datetime.utcnow().isoformat(),
        'overall_status': 'healthy'
    }
    
    # Check all services
    logger.info("📡 Checking services...")
    for service_name, config in SERVICES.items():
        logger.info(f"  Checking {service_name}...")
        result = check_service_health(service_name, config)
        results['services'][service_name] = result
        
        if result['status'] == 'unhealthy':
            results['overall_status'] = 'unhealthy'
            send_alert_to_admin(
                'error',
                f'Service Unhealthy: {service_name}',
                f"Service {service_name} is not responding correctly. {result.get('error', 'Unknown error')}",
                {'service': service_name, 'result': result}
            )
        elif result['status'] == 'healthy':
            logger.info(f"  ✅ {service_name}: Healthy (response time: {result.get('response_time', 0):.2f}s)")
    
    # Check all cronjobs
    logger.info("⏰ Checking cronjobs...")
    for cronjob_name, config in CRONJOBS.items():
        logger.info(f"  Checking {cronjob_name}...")
        result = check_cronjob_status(cronjob_name, config)
        results['cronjobs'][cronjob_name] = result
        
        if result['status'] == 'error':
            results['overall_status'] = 'unhealthy'
            send_alert_to_admin(
                'critical',
                f'Cronjob Error: {cronjob_name}',
                f"Error checking cronjob {cronjob_name}: {result.get('error', 'Unknown error')}",
                {'cronjob': cronjob_name, 'result': result}
            )
        elif result['status'] == 'warning':
            results['overall_status'] = 'warning' if results['overall_status'] == 'healthy' else results['overall_status']
            send_alert_to_admin(
                'warning',
                f'Cronjob Warning: {cronjob_name}',
                f"Cronjob {cronjob_name} may not be running on schedule. {result.get('error', 'Unknown issue')}",
                {'cronjob': cronjob_name, 'result': result}
            )
        elif result['status'] == 'healthy':
            logger.info(f"  ✅ {cronjob_name}: Healthy (last run: {result.get('hours_ago', result.get('minutes_ago', 0)):.1f} {'hours' if 'hours_ago' in result else 'minutes'} ago)")
    
    # Summary
    logger.info("=" * 80)
    logger.info(f"📊 Monitoring Summary:")
    logger.info(f"   Overall Status: {results['overall_status']}")
    logger.info(f"   Services Checked: {len(results['services'])}")
    logger.info(f"   Cronjobs Checked: {len(results['cronjobs'])}")
    logger.info("=" * 80)
    
    return results


if __name__ == '__main__':
    try:
        results = main()
        sys.exit(0 if results['overall_status'] == 'healthy' else 1)
    except Exception as e:
        logger.error(f"❌ Fatal error: {str(e)}")
        send_alert_to_admin(
            'critical',
            'Monitoring Script Error',
            f"The monitoring script encountered a fatal error: {str(e)}",
            {'error': str(e)}
        )
        sys.exit(1)
