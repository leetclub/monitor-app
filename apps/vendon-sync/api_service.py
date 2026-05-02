"""
REST API service to query stored Vendon sales data
"""
import os
import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from flask import Flask, jsonify, request, session
from flask_cors import CORS
from functools import wraps
from models import (
    VendonSalesRecord, VendonSyncLog,
    create_engine_and_session
)

# Try to import admin models (may not exist yet)
try:
    from admin_models import AdminUser, AlertLog, SyncVerificationResult, Base as AdminBase
    ADMIN_MODELS_AVAILABLE = True
except ImportError:
    ADMIN_MODELS_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning("Admin models not available - admin endpoints will be disabled")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv('ADMIN_SECRET_KEY', secrets.token_hex(32))
CORS(app, supports_credentials=True)
engine, SessionLocal = create_engine_and_session()

# Initialize admin models if available
if ADMIN_MODELS_AVAILABLE:
    AdminBase.metadata.create_all(bind=engine)


def get_db_session():
    """Get database session"""
    return SessionLocal()


# Admin Panel Functions
def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not ADMIN_MODELS_AVAILABLE:
            return jsonify({'error': 'Admin features not available'}), 503
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'vendon-sales-api',
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/api/vendon-sales', methods=['GET'])
def get_vendon_sales():
    """
    Get Vendon sales data from cache
    
    Query parameters:
    - machine_ids: Comma-separated list of machine IDs (optional, if not provided returns all)
    - date: Date to query (YYYY-MM-DD). Defaults to yesterday
    - days_back: Number of days to fetch (default: 1). Ignored if date is provided
    - limit: Maximum number of records (default: 1000, max: 10000)
    """
    try:
        session = get_db_session()
        
        # Parse query parameters
        machine_ids_param = request.args.get('machine_ids')
        date_str = request.args.get('date')
        days_back = int(request.args.get('days_back', '1'))
        limit = min(int(request.args.get('limit', 1000)), 10000)
        
        logger.info(f"Vendon sales API request: machine_ids={machine_ids_param}, date={date_str}, days_back={days_back}")
        
        # Build query
        query = session.query(VendonSalesRecord)
        
        # Filter by machine IDs
        if machine_ids_param:
            machine_ids = [mid.strip() for mid in machine_ids_param.split(',')]
            query = query.filter(VendonSalesRecord.machine_id.in_(machine_ids))
            logger.info(f"Filtering by {len(machine_ids)} machine(s)")
        
        # Filter by date
        # Use simple datetime range comparison (fast, uses index)
        # The sale_date is stored as datetime with time=00:00:00 (naive, UTC)
        # We compare using datetime range to match the stored format exactly
        if date_str:
            try:
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                # Create datetime range for the date (00:00:00 to 23:59:59)
                start_dt = datetime.combine(target_date, datetime.min.time())
                end_dt = datetime.combine(target_date, datetime.max.time())
                query = query.filter(
                    VendonSalesRecord.sale_date >= start_dt,
                    VendonSalesRecord.sale_date <= end_dt
                )
                logger.info(f"Filtering by date: {date_str}")
            except ValueError:
                return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        else:
            # Default to yesterday (in Kuwait timezone to match sync service)
            from datetime import timezone as tz
            kuwait_tz = tz(timedelta(hours=3))
            yesterday_kuwait = datetime.now(kuwait_tz).date() - timedelta(days=1)
            start_dt = datetime.combine(yesterday_kuwait, datetime.min.time())
            end_dt = datetime.combine(yesterday_kuwait, datetime.max.time())
            query = query.filter(
                VendonSalesRecord.sale_date >= start_dt,
                VendonSalesRecord.sale_date <= end_dt
            )
            logger.info(f"Filtering by yesterday (Kuwait): {yesterday_kuwait}")
        
        # Order by revenue (ascending for lowest first)
        query = query.order_by(VendonSalesRecord.total_revenue.asc())
        
        # Apply limit
        query = query.limit(limit)
        
        logger.info("Executing database query...")
        start_time = datetime.now()
        records = query.all()
        query_time = (datetime.now() - start_time).total_seconds()
        logger.info(f"Query completed in {query_time:.2f}s, returned {len(records)} records")
        
        # Convert to JSON
        data = []
        for record in records:
            data.append({
                'id': record.id,
                'machineId': record.machine_id,
                'machineName': record.machine_name,
                'saleDate': record.sale_date.date().isoformat(),
                'totalRevenue': round(float(record.total_revenue), 2),
                'totalTransactions': record.total_transactions,
                'syncedAt': (record.synced_at.isoformat() + 'Z') if record.synced_at else None
            })
        
        # Calculate summary
        total_revenue = sum(r.total_revenue for r in records)
        total_transactions = sum(r.total_transactions for r in records)
        
        summary = {
            'totalRevenue': round(float(total_revenue), 2),
            'totalTransactions': total_transactions,
            'totalRecords': len(records),
            'averageRevenuePerMachine': round(float(total_revenue / len(records)), 2) if records else 0,
            'averageTransactionsPerMachine': total_transactions / len(records) if records else 0
        }
        
        # Find lowest performing machine
        lowest_machine = None
        if records:
            lowest = records[0]  # Already sorted by revenue ascending
            lowest_machine = {
                'machineId': lowest.machine_id,
                'machineName': lowest.machine_name,
                'revenue': round(float(lowest.total_revenue), 2),
                'transactions': lowest.total_transactions,
                'date': lowest.sale_date.date().isoformat()
            }
        
        return jsonify({
            'success': True,
            'data': data,
            'totalRecords': len(data),
            'summary': summary,
            'lowestMachine': lowest_machine
        })
        
    except Exception as e:
        logger.error(f"Error fetching Vendon sales: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        try:
            session.close()
        except:
            pass


@app.route('/api/vendon-sales/lowest-yesterday', methods=['GET'])
def get_lowest_machine_yesterday():
    """
    Get the lowest performing machine from yesterday (optimized endpoint for targets tab)
    
    Returns the machine with the lowest revenue yesterday, along with its data
    """
    try:
        session = get_db_session()
        
        # Get yesterday's date in Kuwait timezone (to match sync service)
        from datetime import timezone as tz
        kuwait_tz = tz(timedelta(hours=3))
        yesterday = (datetime.now(kuwait_tz).date() - timedelta(days=1))
        today = datetime.now(kuwait_tz).date()
        
        # Optional: exclude specific machine IDs
        exclude_ids_param = request.args.get('exclude_ids')
        exclude_ids = set()
        if exclude_ids_param:
            exclude_ids = set(mid.strip() for mid in exclude_ids_param.split(','))
        
        logger.info(f"Fetching lowest machine yesterday: {yesterday}, exclude_ids={exclude_ids}")
        
        # Try yesterday first, then today, then go back up to 7 days
        dates_to_try = [yesterday, today]
        for days_back in range(2, 8):
            dates_to_try.append((datetime.now() - timedelta(days=days_back)).date())
        
        lowest_record = None
        date_used = None
        
        for target_date in dates_to_try:
            start_dt = datetime.combine(target_date, datetime.min.time())
            end_dt = datetime.combine(target_date, datetime.max.time())
            
            # Query for lowest revenue machine for this date
            query = session.query(VendonSalesRecord)\
                .filter(
                    VendonSalesRecord.sale_date >= start_dt,
                    VendonSalesRecord.sale_date <= end_dt
                )
            
            if exclude_ids:
                query = query.filter(~VendonSalesRecord.machine_id.in_(exclude_ids))
            
            # Order by revenue ascending and get the first one
            lowest_record = query.order_by(VendonSalesRecord.total_revenue.asc()).first()
            
            if lowest_record:
                date_used = target_date
                logger.info(f"Found data for date: {date_used} (tried {dates_to_try.index(target_date) + 1} dates)")
                break
        
        if not lowest_record:
            # Check what dates actually have data
            latest_date = session.query(VendonSalesRecord.sale_date)\
                .order_by(VendonSalesRecord.sale_date.desc())\
                .first()
            
            if latest_date:
                latest_date_str = latest_date.date().isoformat() if hasattr(latest_date, 'date') else str(latest_date)
                return jsonify({
                    'success': True,
                    'lowestMachine': None,
                    'message': f'No sales data found for yesterday ({yesterday}). Latest data available: {latest_date_str}'
                })
            else:
                return jsonify({
                    'success': True,
                    'lowestMachine': None,
                    'message': 'No sales data found in database. Sync may not have run yet.'
                })
        
        # Get all machines for comparison (optional, for context)
        # Rebuild query for the date we found data for
        start_dt = datetime.combine(date_used, datetime.min.time())
        end_dt = datetime.combine(date_used, datetime.max.time())
        query = session.query(VendonSalesRecord)\
            .filter(
                VendonSalesRecord.sale_date >= start_dt,
                VendonSalesRecord.sale_date <= end_dt
            )
        if exclude_ids:
            query = query.filter(~VendonSalesRecord.machine_id.in_(exclude_ids))
        all_machines = query.order_by(VendonSalesRecord.total_revenue.asc()).all()
        
        result = {
            'success': True,
            'lowestMachine': {
                'machineId': lowest_record.machine_id,
                'machineName': lowest_record.machine_name,
                'revenue': round(float(lowest_record.total_revenue), 2),
                'transactions': lowest_record.total_transactions,
                'date': lowest_record.sale_date.date().isoformat()
            },
            'totalMachines': len(all_machines),
            'scannedMachines': len(all_machines),
            'dateUsed': date_used.isoformat() if date_used else None,
            'requestedDate': yesterday.isoformat()
        }
        
        logger.info(f"Found lowest machine: {lowest_record.machine_name} ({lowest_record.machine_id}) with {lowest_record.total_revenue:.2f} KWD on {date_used}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error fetching lowest machine: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        try:
            session.close()
        except:
            pass


@app.route('/api/vendon-sync-status', methods=['GET'])
def get_sync_status():
    """Get status of recent Vendon sync operations"""
    try:
        session = get_db_session()
        
        limit = int(request.args.get('limit', 10))
        
        sync_logs = session.query(VendonSyncLog)\
            .order_by(VendonSyncLog.sync_started_at.desc())\
            .limit(limit)\
            .all()
        
        logs = []
        for log in sync_logs:
            logs.append({
                'id': log.id,
                'syncStartedAt': log.sync_started_at.isoformat() if log.sync_started_at else None,
                'syncCompletedAt': log.sync_completed_at.isoformat() if log.sync_completed_at else None,
                'status': log.status,
                'recordsSynced': log.records_synced,
                'errorMessage': log.error_message,
                'machinesProcessed': log.machines_processed
            })
        
        return jsonify({
            'success': True,
            'logs': logs
        })
        
    except Exception as e:
        logger.error(f"Error fetching sync status: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        session.close()


@app.route('/api/vendon-sales/report', methods=['GET'])
def get_sales_report():
    """
    Get detailed sales report with product-level breakdown
    
    Query parameters:
    - machine_ids: Comma-separated list of machine IDs (optional)
    - dates: Comma-separated list of dates (YYYY-MM-DD) (optional, defaults to today)
    - products: Comma-separated list of product names to filter (optional)
    - tags: Comma-separated list of tags to filter (optional)
    - group_by_machine: If true, group results by machine (default: false for summary)
    """
    try:
        session = get_db_session()
        
        # Parse query parameters
        machine_ids_param = request.args.get('machine_ids')
        dates_param = request.args.get('dates')
        products_param = request.args.get('products')
        tags_param = request.args.get('tags')
        group_by_machine = request.args.get('group_by_machine', 'false').lower() == 'true'
        
        logger.info(f"Sales report request: machine_ids={machine_ids_param}, dates={dates_param}, products={products_param}, tags={tags_param}, group_by_machine={group_by_machine}")
        
        # Build query
        query = session.query(VendonSalesRecord)
        
        # Filter by machine IDs
        if machine_ids_param:
            machine_ids = [mid.strip() for mid in machine_ids_param.split(',')]
            query = query.filter(VendonSalesRecord.machine_id.in_(machine_ids))
        
        # Filter by dates
        if dates_param:
            date_list = [d.strip() for d in dates_param.split(',')]
            date_filters = []
            for date_str in date_list:
                try:
                    target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                    start_dt = datetime.combine(target_date, datetime.min.time())
                    end_dt = datetime.combine(target_date, datetime.max.time())
                    date_filters.append(
                        (VendonSalesRecord.sale_date >= start_dt) &
                        (VendonSalesRecord.sale_date <= end_dt)
                    )
                except ValueError:
                    continue
            if date_filters:
                from sqlalchemy import or_
                query = query.filter(or_(*date_filters))
        else:
            # Default to today (in Kuwait timezone)
            from datetime import timezone as tz
            kuwait_tz = tz(timedelta(hours=3))
            today_kuwait = datetime.now(kuwait_tz).date()
            start_dt = datetime.combine(today_kuwait, datetime.min.time())
            end_dt = datetime.combine(today_kuwait, datetime.max.time())
            query = query.filter(
                VendonSalesRecord.sale_date >= start_dt,
                VendonSalesRecord.sale_date <= end_dt
            )
        
        records = query.all()
        
        # Parse raw_vends and aggregate by product
        import json
        from collections import defaultdict
        
        product_data = defaultdict(lambda: {
            'product': '',
            'article': '',
            'quantity': 0,
            'vat_percent': '-',
            'with_vat': 0.0
        })
        
        machine_product_data = defaultdict(lambda: defaultdict(lambda: {
            'product': '',
            'article': '',
            'quantity': 0,
            'vat_percent': '-',
            'with_vat': 0.0
        }))
        
        # Track all distinct products and tags available for building frontend filters
        available_products = set()
        available_tags = set()
        
        products_filter = set()
        if products_param:
            products_filter = set(p.strip().lower() for p in products_param.split(','))
        
        tags_filter = set()
        if tags_param:
            tags_filter = set(t.strip().lower() for t in tags_param.split(','))
        
        for record in records:
            if not record.raw_vends:
                continue
            
            try:
                vends = json.loads(record.raw_vends)
            except:
                continue
            
            machine_id = record.machine_id
            machine_name = record.machine_name or f"Machine {machine_id}"
            
            for vend in vends:
                product_name = vend.get('name', 'Unknown Product')
                # Article can be in different fields - try article, product_id, selection, or id
                article = (vend.get('article') or 
                          vend.get('product_id') or 
                          vend.get('selection') or 
                          str(vend.get('id', '')) or 
                          '')
                price = float(vend.get('price', 0) or 0)
                tags = vend.get('tags', [])
                if isinstance(tags, str):
                    tags = [tags] if tags else []
                elif not isinstance(tags, list):
                    tags = []
                
                # Update global products/tags sets (for filters) regardless of current filters
                if product_name:
                    available_products.add(str(product_name))
                for t in tags:
                    if t:
                        available_tags.add(str(t))
                
                # Apply filters
                if products_filter and product_name.lower() not in products_filter:
                    continue
                
                if tags_filter:
                    vend_tags_lower = [str(t).lower() for t in tags]
                    if not any(t in vend_tags_lower for t in tags_filter):
                        continue
                
                # Aggregate for summary (all machines combined)
                key = product_name.lower()
                product_data[key]['product'] = product_name
                product_data[key]['article'] = article
                product_data[key]['quantity'] += 1
                product_data[key]['with_vat'] += price
                
                # Aggregate by machine
                machine_product_data[machine_id][key]['product'] = product_name
                machine_product_data[machine_id][key]['article'] = article
                machine_product_data[machine_id][key]['quantity'] += 1
                machine_product_data[machine_id][key]['with_vat'] += price
        
        # Convert to lists
        summary_data = []
        for key, data in sorted(product_data.items()):
            summary_data.append({
                'product': data['product'],
                'article': data['article'],
                'quantity': data['quantity'],
                'vatPercent': data['vat_percent'],
                'withVat': round(data['with_vat'], 2)
            })
        
        machine_data = {}
        for machine_id, products in machine_product_data.items():
            machine_records = []
            for key, data in sorted(products.items()):
                machine_records.append({
                    'product': data['product'],
                    'article': data['article'],
                    'quantity': data['quantity'],
                    'vatPercent': data['vat_percent'],
                    'withVat': round(data['with_vat'], 2)
                })
            machine_data[machine_id] = machine_records
        
        return jsonify({
            'success': True,
            'summary': summary_data,
            'byMachine': machine_data,
            'groupByMachine': group_by_machine,
            # Expose distinct products and tags so the frontend can build proper filters
            'availableProducts': sorted(available_products),
            'availableTags': sorted(available_tags)
        })
        
    except Exception as e:
        logger.error(f"Error fetching sales report: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        try:
            session.close()
        except:
            pass


# ===== ADMIN PANEL ENDPOINTS =====

@app.route('/api/admin/health', methods=['GET'])
def admin_health_check():
    """Admin API health check"""
    return jsonify({
        'status': 'healthy',
        'service': 'admin-panel-api',
        'admin_available': ADMIN_MODELS_AVAILABLE,
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Admin login endpoint"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({'error': 'Username and password required'}), 400
        
        session_db = get_db_session()
        try:
            user = session_db.query(AdminUser).filter(
                AdminUser.username == username,
                AdminUser.is_active == True
            ).first()
            
            if not user or not user.verify_password(password):
                return jsonify({'error': 'Invalid credentials'}), 401
            
            user.last_login = datetime.utcnow()
            session_db.commit()
            
            session['user_id'] = user.id
            session['username'] = user.username
            
            logger.info(f"Admin login successful: {username}")
            
            return jsonify({
                'success': True,
                'username': user.username,
                'message': 'Login successful'
            })
        finally:
            session_db.close()
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/logout', methods=['POST'])
@require_auth
def admin_logout():
    """Admin logout endpoint"""
    username = session.get('username', 'unknown')
    session.clear()
    logger.info(f"Admin logout: {username}")
    return jsonify({'success': True, 'message': 'Logged out'})


@app.route('/api/admin/me', methods=['GET'])
@require_auth
def admin_get_current_user():
    """Get current user info"""
    return jsonify({
        'username': session.get('username'),
        'user_id': session.get('user_id')
    })


@app.route('/api/admin/alerts', methods=['GET'])
@require_auth
def admin_get_alerts():
    """Get alerts/logs with filtering"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        level = request.args.get('level')
        source = request.args.get('source')
        resolved = request.args.get('resolved')
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        
        session_db = get_db_session()
        try:
            query = session_db.query(AlertLog)
            
            if level:
                query = query.filter(AlertLog.level == level)
            if source:
                query = query.filter(AlertLog.source == source)
            if resolved is not None:
                is_resolved = resolved.lower() == 'true'
                query = query.filter(AlertLog.is_resolved == is_resolved)
            
            total = query.count()
            alerts = query.order_by(AlertLog.created_at.desc()).limit(limit).offset(offset).all()
            
            result = []
            for alert in alerts:
                result.append({
                    'id': alert.id,
                    'level': alert.level,
                    'source': alert.source,
                    'title': alert.title,
                    'message': alert.message,
                    'details': json.loads(alert.details) if alert.details else None,
                    'is_resolved': alert.is_resolved,
                    'resolved_at': alert.resolved_at.isoformat() if alert.resolved_at else None,
                    'resolved_by': alert.resolved_by,
                    'created_at': alert.created_at.isoformat()
                })
            
            return jsonify({
                'success': True,
                'data': result,
                'total': total,
                'limit': limit,
                'offset': offset
            })
        finally:
            session_db.close()
    except Exception as e:
        logger.error(f"Error getting alerts: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/alerts/<int:alert_id>/resolve', methods=['POST'])
@require_auth
def admin_resolve_alert(alert_id):
    """Mark alert as resolved"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        session_db = get_db_session()
        try:
            alert = session_db.query(AlertLog).filter(AlertLog.id == alert_id).first()
            if not alert:
                return jsonify({'error': 'Alert not found'}), 404
            
            alert.is_resolved = True
            alert.resolved_at = datetime.utcnow()
            alert.resolved_by = session.get('username', 'unknown')
            session_db.commit()
            
            return jsonify({'success': True, 'message': 'Alert resolved'})
        finally:
            session_db.close()
    except Exception as e:
        logger.error(f"Error resolving alert: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/verification-results', methods=['GET'])
@require_auth
def admin_get_verification_results():
    """Get sync verification results"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        days = int(request.args.get('days', 7))
        status = request.args.get('status')
        
        session_db = get_db_session()
        try:
            since = datetime.utcnow() - timedelta(days=days)
            query = session_db.query(SyncVerificationResult).filter(
                SyncVerificationResult.verification_date >= since
            )
            
            if status:
                query = query.filter(SyncVerificationResult.status == status)
            
            results = query.order_by(SyncVerificationResult.verification_date.desc()).all()
            
            data = []
            for result in results:
                data.append({
                    'id': result.id,
                    'sync_date': result.sync_date.isoformat(),
                    'verification_date': result.verification_date.isoformat(),
                    'status': result.status,
                    # Don't default to 'vendon-sync' - use actual sync_type or try to infer from summary
                    'sync_type': result.sync_type if result.sync_type else (
                        'people-analytics-sync' if 'people-analytics' in (result.summary or '').lower() else
                        'historical-performance-sync' if 'historical-performance' in (result.summary or '').lower() else
                        'vendon-sync'  # Only default if truly unknown
                    ),
                    'date_check': result.date_check,
                    'sync_logs_check': result.sync_logs_check,
                    'data_completeness_check': result.data_completeness_check,
                    'api_verification_check': result.api_verification_check,
                    'summary': result.summary,
                    'errors': json.loads(result.errors) if result.errors else None,
                    'warnings': json.loads(result.warnings) if result.warnings else None,
                    'machine_count': result.machine_count,
                    'total_revenue': result.total_revenue,
                    'total_transactions': result.total_transactions
                })
            
            return jsonify({'success': True, 'data': data})
        finally:
            session_db.close()
    except Exception as e:
        logger.error(f"Error getting verification results: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/receive-alert', methods=['POST'])
def admin_receive_alert():
    """Receive alert from sync/verify jobs (no auth required, uses API key)"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        api_key = request.headers.get('X-API-Key')
        expected_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
        
        if api_key != expected_key:
            return jsonify({'error': 'Invalid API key'}), 401
        
        data = request.get_json()
        level = data.get('level', 'info')
        source = data.get('source', 'unknown')
        title = data.get('title', 'Alert')
        message = data.get('message', '')
        details = data.get('details')
        
        session_db = get_db_session()
        try:
            alert = AlertLog(
                level=level,
                source=source,
                title=title,
                message=message,
                details=json.dumps(details) if details else None
            )
            session_db.add(alert)
            session_db.commit()
            
            logger.info(f"Alert received: {level} from {source}: {title}")
            
            return jsonify({'success': True, 'alert_id': alert.id})
        finally:
            session_db.close()
    except Exception as e:
        logger.error(f"Error receiving alert: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/receive-verification', methods=['POST'])
def admin_receive_verification():
    """Receive verification results from verify job (no auth required, uses API key)"""
    if not ADMIN_MODELS_AVAILABLE:
        return jsonify({'error': 'Admin features not available'}), 503
    
    try:
        api_key = request.headers.get('X-API-Key')
        expected_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
        
        if api_key != expected_key:
            return jsonify({'error': 'Invalid API key'}), 401
        
        data = request.get_json()
        
        session_db = get_db_session()
        try:
            result = SyncVerificationResult(
                sync_date=datetime.fromisoformat(data['sync_date'].replace('Z', '+00:00')),
                status=data.get('status', 'unknown'),
                sync_type=data.get('sync_type', 'vendon-sync'),  # Default to vendon-sync for backward compatibility
                date_check=data.get('date_check', False),
                sync_logs_check=data.get('sync_logs_check', False),
                data_completeness_check=data.get('data_completeness_check', False),
                api_verification_check=data.get('api_verification_check', False),
                summary=data.get('summary'),
                errors=json.dumps(data.get('errors')) if data.get('errors') else None,
                warnings=json.dumps(data.get('warnings')) if data.get('warnings') else None,
                machine_count=data.get('machine_count', 0),
                total_revenue=data.get('total_revenue'),
                total_transactions=data.get('total_transactions', 0)
            )
            session_db.add(result)
            session_db.commit()
            
            # Create alert if verification failed
            if data.get('status') == 'failed':
                alert = AlertLog(
                    level='error',
                    source=data.get('sync_type', 'verification'),
                    title=f"Sync Verification Failed: {data.get('sync_type', 'unknown')} - {data['sync_date']}",
                    message=data.get('summary', 'Verification failed'),
                    details=json.dumps({'verification_id': result.id, 'errors': data.get('errors'), 'sync_type': data.get('sync_type')})
                )
                session_db.add(alert)
                session_db.commit()
            
            logger.info(f"Verification result received: {data.get('status')} for {data.get('sync_type', 'unknown')} - {data['sync_date']}")
            
            return jsonify({'success': True, 'verification_id': result.id})
        finally:
            session_db.close()
    except Exception as e:
            logger.error(f"Error receiving verification: {str(e)}")
            return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Create default admin user if doesn't exist
    if ADMIN_MODELS_AVAILABLE:
        session_db = get_db_session()
        try:
            admin_username = os.getenv('ADMIN_USERNAME', 'admin')
            admin_password = os.getenv('ADMIN_PASSWORD', 'admin123')
            
            existing = session_db.query(AdminUser).filter(AdminUser.username == admin_username).first()
            if not existing:
                admin_user = AdminUser(
                    username=admin_username,
                    password_hash=AdminUser.hash_password(admin_password),
                    is_active=True
                )
                session_db.add(admin_user)
                session_db.commit()
                logger.info(f"Created default admin user: {admin_username}")
        finally:
            session_db.close()
    
    port = int(os.getenv('API_PORT', '5001'))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    logger.info(f"Starting Vendon sales API service on port {port}")
    logger.info(f"Admin features available: {ADMIN_MODELS_AVAILABLE}")
    app.run(host='0.0.0.0', port=port, debug=debug)



