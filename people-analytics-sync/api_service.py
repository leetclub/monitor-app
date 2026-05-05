"""
REST API service to query stored people analytics data
"""
import os
import logging
from datetime import datetime, timedelta, date, timezone
from typing import Optional, List
from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import and_, or_
from sqlalchemy import func
from zoneinfo import ZoneInfo
from models import (
    PeopleAnalyticsRecord, SyncLog, WasteAnalysisReason, RemoteCreditReason,
    IntraDayCheckup,
    create_engine_and_session
)
try:
    from auth_routes import register_auth_routes
except ImportError:
    register_auth_routes = None
try:
    from dashboard_access_routes import register_dashboard_access_routes
except ImportError:
    register_dashboard_access_routes = None
try:
    from vendon_proxy_routes import register_vendon_proxy_routes
except ImportError:
    register_vendon_proxy_routes = None
try:
    from live_dashboard_routes import register_live_dashboard_routes
except ImportError:
    register_live_dashboard_routes = None
try:
    from red_alert_routes import register_red_alert_routes
except ImportError:
    register_red_alert_routes = None
try:
    from alert_routes import register_alert_routes
except ImportError:
    register_alert_routes = None
try:
    from attendance_snapshot_routes import attendance_snapshot_bp
except ImportError:
    attendance_snapshot_bp = None

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _cors_origins() -> List[str]:
    raw = (os.environ.get('CORS_ALLOWED_ORIGINS') or '').strip()
    if raw:
        return [x.strip() for x in raw.split(',') if x.strip()]
    env = (os.environ.get('ENV') or os.environ.get('FLASK_ENV') or '').lower()
    # Default browser clients: monitoring-app-v2 (Vite) + Google Apps Script web app hosts.
    # Override with CORS_ALLOWED_ORIGINS (comma-separated) for a strict allowlist.
    defaults = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        # Production SPAs (Alert + Monitor v2) — cookie-auth requires explicit origin allowlist.
        r'https://.*\.theleetclub\.com',
        r'https://.*\.googleusercontent\.com',
        'https://script.googleusercontent.com',
        'https://script.google.com',
    ]
    if env == 'production':
        logger.warning(
            'CORS_ALLOWED_ORIGINS unset — using defaults for GAS (*.googleusercontent.com) + localhost v2'
        )
    return defaults

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-change-me')
_is_prod = (os.environ.get('FLASK_ENV') or os.environ.get('ENV') or '').lower() == 'production'
if _is_prod:
    _sk = (os.environ.get('FLASK_SECRET_KEY') or '').strip()
    if not _sk or _sk == 'dev-change-me':
        raise SystemExit(
            'Refusing to start: FLASK_SECRET_KEY must be set to a strong value in production '
            '(e.g. openssl rand -hex 32 in people-analytics-secrets).'
        )
if _is_prod:
    app.config['SESSION_COOKIE_SECURE'] = True
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    # Browser SPA on another origin (alert.theleetclub.com) -> people-api needs cross-site cookies.
    # Must be Secure + SameSite=None or browsers won't send the session cookie.
    app.config['SESSION_COOKIE_SAMESITE'] = 'None'

app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(
    hours=int(os.environ.get('SESSION_LIFETIME_HOURS', '12'))
)
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH_BYTES', str(2 * 1024 * 1024)))


@app.after_request
def _security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'DENY')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=()',
    )
    if response.mimetype == 'application/json':
        response.headers.setdefault('Cache-Control', 'no-store, private')
    return response


# CORS: explicit origins so browsers can send credentials (cookies) from monitoring-app-v2.
_cors_kw = {
    'origins': _cors_origins(),
    'methods': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allow_headers': [
        'Content-Type',
        'Authorization',
        'X-Dashboard-Access-Secret',
        'X-Dashboard-Access-Key',
        'X-Requested-With',
    ],
    'supports_credentials': True,
}
CORS(app, resources={r'/api/*': _cors_kw})
engine, SessionLocal = create_engine_and_session()


def get_db_session():
    """Get database session"""
    return SessionLocal()


if register_auth_routes:
    try:
        register_auth_routes(app)
        logger.info('Auth routes registered (/api/auth/*, /api/me)')
    except Exception as e:
        logger.warning('Could not register auth routes: %s', e)

if register_dashboard_access_routes:
    try:
        register_dashboard_access_routes(app)
        logger.info('Dashboard access API routes registered (/api/dashboard-access/*) -> DASHBOARD_DB_NAME')
    except Exception as e:
        logger.warning('Could not register dashboard access routes: %s', e)

if register_vendon_proxy_routes:
    try:
        register_vendon_proxy_routes(app)
        logger.info('Vendon proxy routes registered (/api/vendon/*, /api/monitoring/strike)')
    except Exception as e:
        logger.warning('Could not register vendon proxy routes: %s', e)

if register_live_dashboard_routes:
    try:
        register_live_dashboard_routes(app)
        logger.info('Live dashboard routes registered (/api/live-dashboard/*)')
    except Exception as e:
        logger.warning('Could not register live dashboard routes: %s', e)

if register_red_alert_routes:
    try:
        register_red_alert_routes(app)
        logger.info('Red Alert routes registered (/api/red-alert/*)')
    except Exception as e:
        logger.warning('Could not register red alert routes: %s', e)

if register_alert_routes:
    try:
        register_alert_routes(app)
        logger.info('Alert routes registered (/api/alert/*)')
    except Exception as e:
        logger.warning('Could not register alert routes: %s', e)

if attendance_snapshot_bp:
    try:
        app.register_blueprint(attendance_snapshot_bp)
        logger.info('Attendance snapshot routes registered (/api/attendance/*)')
    except Exception as e:
        logger.warning('Could not register attendance snapshot routes: %s', e)


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/api/reasons-health', methods=['GET'])
@app.route('/reasons-health', methods=['GET'])
def reasons_health():
    """Verify waste/refund reasons routes are deployed (returns 200 if this code is live)."""
    return jsonify({
        'status': 'ok',
        'reasons_routes': ['waste-reasons', 'remote-credit-reasons'],
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/api/people-analytics', methods=['GET'])
def get_people_analytics():
    """
    Get people analytics data
    
    Query parameters:
    - uidds: Comma-separated list of device IDs
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    - interval: Time interval ('date', 'hour', '60000')
    - limit: Maximum number of records (default: 1000, max: 10000)
    """
    try:
        session = get_db_session()
        
        # Parse query parameters
        uidds_param = request.args.get('uidds')
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        interval = request.args.get('interval', 'date')
        limit = min(int(request.args.get('limit', 1000)), 10000)  # Max 10000
        tz_name = request.args.get('timezone') or request.args.get('timeZone') or 'Asia/Kuwait'
        try:
            tzinfo = ZoneInfo(tz_name)
        except Exception:
            return jsonify({'error': f'Invalid timezone: {tz_name}'}), 400
        
        logger.info(f"API request: uidds={uidds_param}, start_date={start_date_str}, end_date={end_date_str}, interval={interval}, limit={limit}")
        
        # Require at least start_date or end_date to avoid full table scan
        if not start_date_str and not end_date_str:
            return jsonify({
                'success': False,
                'error': 'At least start_date or end_date is required'
            }), 400
        
        # Build query
        query = session.query(PeopleAnalyticsRecord)
        
        # Parse uidd list once (also used for metadata queries)
        uidds: Optional[List[str]] = None

        # Filter by device IDs
        if uidds_param:
            uidds = [uid.strip() for uid in uidds_param.split(',')]
            query = query.filter(PeopleAnalyticsRecord.uidd.in_(uidds))
            logger.info(f"Filtering by {len(uidds)} device(s)")
        
        # Filter by date range (required for performance)
        # Filter by date range in the requested timezone, but stored timestamps are treated as UTC.
        # Convert local day boundaries to UTC before filtering so "2026-01-14" doesn't leak into 01/15.
        if start_date_str:
            try:
                start_local = datetime.strptime(start_date_str, '%Y-%m-%d').replace(tzinfo=tzinfo)
                start_utc = start_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
                query = query.filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
                logger.info(f"Filtering from {start_date_str} ({tz_name}) => UTC {start_utc}")
            except ValueError:
                return jsonify({'error': 'Invalid start_date format. Use YYYY-MM-DD'}), 400
        
        if end_date_str:
            try:
                end_local = datetime.strptime(end_date_str, '%Y-%m-%d').replace(hour=23, minute=59, second=59, tzinfo=tzinfo)
                end_utc = end_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
                query = query.filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
                logger.info(f"Filtering until {end_date_str} ({tz_name}) => UTC {end_utc}")
            except ValueError:
                return jsonify({'error': 'Invalid end_date format. Use YYYY-MM-DD'}), 400
        
        # Filter by interval
        # IMPORTANT: Do NOT mix granularities (e.g. 'date' with 'hour').
        # If the UI asks for hourly data, returning daily rows will distort charts and totals.
        if interval:
            query = query.filter(PeopleAnalyticsRecord.interval_type == interval)
            logger.info(f"Filtering by interval: {interval}")
        
        # Order by timestamp (newest first) - use indexed column
        query = query.order_by(PeopleAnalyticsRecord.first_timestamp.desc())
        
        # Apply limit before fetching
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
                'uidd': record.uidd,
                'device_id': record.device_id,
                # IMPORTANT: stored timestamps are treated as UTC-naive. Emit them as UTC with 'Z'
                # so clients parse consistently (avoid JS treating them as local time).
                'first_timestamp': record.first_timestamp.isoformat() + 'Z',
                'last_timestamp': record.last_timestamp.isoformat() + 'Z',
                'interval': record.interval_type,
                'timezone': record.timezone,
                'in': record.people_in,
                'out': record.people_out,
                'netTraffic': record.net_traffic,
                'totalTraffic': record.total_traffic,
                'trafficRatio': record.traffic_ratio,
                'trafficPattern': record.traffic_pattern,
                'durationHours': record.duration_hours,
                'eventCount': record.event_count,
                'rawData': record.raw_data,
                'syncedAt': (record.synced_at.isoformat() + 'Z') if record.synced_at else None
            })
        
        # Calculate summary
        total_in = sum(r.people_in for r in records)
        total_out = sum(r.people_out for r in records)
        net_traffic = total_in - total_out
        
        summary = {
            'totalIn': total_in,
            'totalOut': total_out,
            'netTraffic': net_traffic,
            'totalRecords': len(records),
            'totalPeriods': len(records),
            'averageInPerPeriod': total_in / len(records) if records else 0,
            'averageOutPerPeriod': total_out / len(records) if records else 0
        }
        
        # Availability metadata (Option A)
        # If the client requests hourly, tell them from which date hourly data exists in DB
        availability = None
        if interval == 'hour':
            hour_q = session.query(func.min(PeopleAnalyticsRecord.first_timestamp))\
                .filter(PeopleAnalyticsRecord.interval_type == 'hour')
            if uidds:
                hour_q = hour_q.filter(PeopleAnalyticsRecord.uidd.in_(uidds))
            hourly_from = hour_q.scalar()

            availability = {
                'requestedInterval': interval,
                'hourlyAvailableFrom': hourly_from.isoformat() if hourly_from else None,
                'note': 'Hourly data may only be available from a recent period depending on Videoloft retention.'
            }

        return jsonify({
            'success': True,
            'data': data,
            'totalRecords': len(data),
            'summary': summary,
            'availability': availability
        })
        
    except Exception as e:
        logger.error(f"Error fetching people analytics: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        try:
            session.close()
        except:
            pass


@app.route('/api/sync-status', methods=['GET'])
def get_sync_status():
    """Get status of recent sync operations"""
    try:
        session = get_db_session()
        
        limit = int(request.args.get('limit', 10))
        
        sync_logs = session.query(SyncLog)\
            .order_by(SyncLog.sync_started_at.desc())\
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
                'uiddsProcessed': log.uidds_processed
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


@app.route('/api/waste-reasons', methods=['OPTIONS'])
@app.route('/waste-reasons', methods=['OPTIONS'])
def waste_reasons_options():
    """CORS preflight for waste-reasons."""
    return '', 204


@app.route('/api/waste-reasons', methods=['GET'])
@app.route('/waste-reasons', methods=['GET'])
def get_waste_reasons():
    """
    Get saved reasons for waste analysis by date and optional machine IDs.
    Query params: date (YYYY-MM-DD), machine_ids (optional comma-separated).
    """
    try:
        session = get_db_session()
        date_str = request.args.get('date')
        machine_ids_param = request.args.get('machine_ids')
        if not date_str:
            return jsonify({'success': False, 'error': 'date is required (YYYY-MM-DD)'}), 400
        try:
            req_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        query = session.query(WasteAnalysisReason).filter(WasteAnalysisReason.date == req_date)
        if machine_ids_param:
            machine_ids = [m.strip() for m in machine_ids_param.split(',') if m.strip()]
            if machine_ids:
                query = query.filter(WasteAnalysisReason.machine_id.in_(machine_ids))
        rows = query.all()
        reasons = [{'machine_id': r.machine_id, 'date': r.date.isoformat(), 'reason': r.reason or '', 'updated_at': r.updated_at.isoformat() if r.updated_at else None} for r in rows]
        return jsonify({'success': True, 'reasons': reasons})
    except Exception as e:
        logger.error(f"Error fetching waste reasons: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


@app.route('/api/waste-reasons', methods=['POST', 'PUT'])
@app.route('/waste-reasons', methods=['POST', 'PUT'])
def upsert_waste_reason():
    """
    Create or update reason for one machine/date.
    Body: { "machine_id": "...", "date": "YYYY-MM-DD", "reason": "..." }
    """
    try:
        session = get_db_session()
        data = request.get_json() or {}
        machine_id = data.get('machine_id')
        date_str = data.get('date')
        reason = data.get('reason', '')
        if not machine_id or not date_str:
            return jsonify({'success': False, 'error': 'machine_id and date are required'}), 400
        try:
            req_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        existing = session.query(WasteAnalysisReason).filter(
            WasteAnalysisReason.machine_id == machine_id,
            WasteAnalysisReason.date == req_date
        ).first()
        if existing:
            existing.reason = reason
            existing.updated_at = datetime.utcnow()
            session.commit()
            return jsonify({'success': True, 'id': existing.id, 'machine_id': existing.machine_id, 'date': existing.date.isoformat(), 'reason': existing.reason})
        rec = WasteAnalysisReason(machine_id=machine_id, date=req_date, reason=reason)
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return jsonify({'success': True, 'id': rec.id, 'machine_id': rec.machine_id, 'date': rec.date.isoformat(), 'reason': rec.reason})
    except Exception as e:
        logger.error(f"Error upserting waste reason: {str(e)}", exc_info=True)
        session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


@app.route('/api/remote-credit-reasons', methods=['OPTIONS'])
@app.route('/remote-credit-reasons', methods=['OPTIONS'])
def remote_credit_reasons_options():
    """CORS preflight for remote-credit-reasons."""
    return '', 204


@app.route('/api/remote-credit-reasons', methods=['GET'])
@app.route('/remote-credit-reasons', methods=['GET'])
def get_remote_credit_reasons():
    """
    Get saved reasons for Refund Tests.
    Batch: machine_id, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD).
    Single: log_id, machine_id, timestamp (Unix seconds).
    Returns list of { log_id, machine_id, timestamp, reason }.
    """
    try:
        session = get_db_session()
        log_id_param = request.args.get('log_id')
        machine_id = request.args.get('machine_id')
        timestamp_param = request.args.get('timestamp')
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')

        if log_id_param is not None and timestamp_param is not None:
            try:
                ts_val = int(timestamp_param)
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Invalid timestamp'}), 400
            query = session.query(RemoteCreditReason).filter(
                RemoteCreditReason.log_id == log_id_param,
                RemoteCreditReason.timestamp_val == ts_val
            )
            if machine_id:
                query = query.filter(RemoteCreditReason.machine_id == machine_id)
            row = query.first()
            reasons = [{
                'log_id': row.log_id,
                'machine_id': row.machine_id,
                'timestamp': row.timestamp_val,
                'reason': row.reason or '',
                'updated_at': row.updated_at.isoformat() if row.updated_at else None
            }] if row else []
            return jsonify({'success': True, 'reasons': reasons})
        if not start_date_str or not end_date_str:
            return jsonify({'success': False, 'error': 'start_date and end_date required, or log_id and timestamp'}), 400
        try:
            start_dt = datetime.strptime(start_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            end_dt = datetime.strptime(end_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
            # Widen range by 1 day each side so timezone edge cases don't exclude rows
            from_ts = int(start_dt.timestamp()) - 86400
            to_ts = int(end_dt.timestamp()) + 86400 * 2
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        query = session.query(RemoteCreditReason).filter(
            RemoteCreditReason.timestamp_val >= from_ts,
            RemoteCreditReason.timestamp_val <= to_ts
        )
        if machine_id:
            query = query.filter(RemoteCreditReason.machine_id == machine_id)
        rows = query.all()
        reasons = [{
            'log_id': r.log_id,
            'machine_id': r.machine_id,
            'timestamp': r.timestamp_val,
            'reason': r.reason or '',
            'updated_at': r.updated_at.isoformat() if r.updated_at else None
        } for r in rows]
        return jsonify({'success': True, 'reasons': reasons})
    except Exception as e:
        logger.error(f"Error fetching remote credit reasons: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


@app.route('/api/remote-credit-reasons', methods=['POST', 'PUT'])
@app.route('/remote-credit-reasons', methods=['POST', 'PUT'])
def upsert_remote_credit_reason():
    """
    Create or update reason for one Refund Test log.
    Body: { "log_id": "...", "machine_id": "...", "timestamp": <number>, "reason": "..." }
    """
    try:
        session = get_db_session()
        data = request.get_json() or {}
        log_id = data.get('log_id')
        machine_id = data.get('machine_id')
        ts = data.get('timestamp')
        reason = data.get('reason', '')
        if not log_id:
            return jsonify({'success': False, 'error': 'log_id is required'}), 400
        ts_val = None
        if ts is not None:
            try:
                ts_val = int(ts)
            except (TypeError, ValueError):
                pass
        if ts_val is None:
            ts_val = 0
        # Normalize to Unix seconds (client may send milliseconds)
        if ts_val > 1e12:
            ts_val = ts_val // 1000
        machine_id = (machine_id is not None and str(machine_id).strip()) and str(machine_id).strip() or '_'
        existing = session.query(RemoteCreditReason).filter(
            RemoteCreditReason.log_id == log_id,
            RemoteCreditReason.machine_id == machine_id,
            RemoteCreditReason.timestamp_val == ts_val
        ).first()
        if existing:
            existing.reason = (reason or '').strip()
            existing.updated_at = datetime.utcnow()
            session.commit()
            return jsonify({
                'success': True,
                'id': existing.id,
                'log_id': existing.log_id,
                'machine_id': existing.machine_id,
                'timestamp': existing.timestamp_val,
                'reason': existing.reason or ''
            })
        rec = RemoteCreditReason(log_id=log_id, machine_id=machine_id, timestamp_val=ts_val, reason=(reason or '').strip())
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return jsonify({
            'success': True,
            'id': rec.id,
            'log_id': rec.log_id,
            'machine_id': rec.machine_id,
            'timestamp': rec.timestamp_val,
            'reason': rec.reason or ''
        })
    except Exception as e:
        logger.error(f"Error upserting remote credit reason: {str(e)}", exc_info=True)
        session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


# ---------- Intra-Day Checkup (control staff: midday operator readiness) ----------
@app.route('/api/intra-day-checkups', methods=['OPTIONS'])
@app.route('/intra-day-checkups', methods=['OPTIONS'])
def intra_day_checkups_options():
    return '', 204


@app.route('/api/intra-day-checkups', methods=['GET'])
@app.route('/intra-day-checkups', methods=['GET'])
def get_intra_day_checkups():
    """
    Get intra-day checkups. Query: machine_id (optional), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD).
    Returns list of { id, machine_id, operator_id, operator_name, check_date, status, recorded_at, recorded_by }.
    """
    try:
        session = get_db_session()
        machine_id = request.args.get('machine_id')
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        if not start_date_str or not end_date_str:
            return jsonify({'success': False, 'error': 'start_date and end_date required (YYYY-MM-DD)'}), 400
        try:
            start_dt = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            end_dt = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid date format. Use YYYY-MM-DD'}), 400
        query = session.query(IntraDayCheckup).filter(
            IntraDayCheckup.check_date >= start_dt,
            IntraDayCheckup.check_date <= end_dt
        )
        if machine_id:
            query = query.filter(IntraDayCheckup.machine_id == str(machine_id).strip())
        rows = query.order_by(IntraDayCheckup.check_date.desc(), IntraDayCheckup.recorded_at.desc()).all()
        items = [{
            'id': r.id,
            'machine_id': r.machine_id,
            'operator_id': r.operator_id,
            'operator_name': r.operator_name or '',
            'check_date': r.check_date.isoformat(),
            'status': r.status,
            'recorded_at': r.recorded_at.isoformat() if r.recorded_at else None,
            'recorded_by': r.recorded_by or ''
        } for r in rows]
        return jsonify({'success': True, 'checkups': items})
    except Exception as e:
        logger.error(f"Error fetching intra-day checkups: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


@app.route('/api/intra-day-checkups', methods=['POST', 'PUT'])
@app.route('/intra-day-checkups', methods=['POST', 'PUT'])
def upsert_intra_day_checkup():
    """
    Create or update one intra-day checkup.
    Body: { "machine_id": "...", "operator_id": "...", "operator_name": "...", "check_date": "YYYY-MM-DD", "status": "ready"|"not_ready", "recorded_by": "..." }
    """
    try:
        session = get_db_session()
        data = request.get_json() or {}
        machine_id = (data.get('machine_id') or '').strip()
        operator_id = (data.get('operator_id') or '').strip()
        operator_name = (data.get('operator_name') or '').strip()
        check_date_str = (data.get('check_date') or '').strip()
        status = (data.get('status') or 'ready').strip().lower()
        recorded_by = (data.get('recorded_by') or '').strip()
        if not machine_id or not operator_id:
            return jsonify({'success': False, 'error': 'machine_id and operator_id are required'}), 400
        if status not in ('ready', 'not_ready'):
            return jsonify({'success': False, 'error': 'status must be ready or not_ready'}), 400
        if not check_date_str:
            return jsonify({'success': False, 'error': 'check_date is required (YYYY-MM-DD)'}), 400
        try:
            check_date = datetime.strptime(check_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'success': False, 'error': 'Invalid check_date. Use YYYY-MM-DD'}), 400
        existing = session.query(IntraDayCheckup).filter(
            IntraDayCheckup.machine_id == machine_id,
            IntraDayCheckup.operator_id == operator_id,
            IntraDayCheckup.check_date == check_date
        ).first()
        if existing:
            existing.status = status
            existing.operator_name = operator_name or existing.operator_name
            existing.recorded_at = datetime.utcnow()
            existing.recorded_by = recorded_by or existing.recorded_by
            session.commit()
            session.refresh(existing)
            rec = existing
        else:
            rec = IntraDayCheckup(
                machine_id=machine_id,
                operator_id=operator_id,
                operator_name=operator_name,
                check_date=check_date,
                status=status,
                recorded_by=recorded_by or None
            )
            session.add(rec)
            session.commit()
            session.refresh(rec)
        return jsonify({
            'success': True,
            'id': rec.id,
            'machine_id': rec.machine_id,
            'operator_id': rec.operator_id,
            'operator_name': rec.operator_name or '',
            'check_date': rec.check_date.isoformat(),
            'status': rec.status,
            'recorded_at': rec.recorded_at.isoformat() if rec.recorded_at else None,
            'recorded_by': rec.recorded_by or ''
        })
    except Exception as e:
        logger.error(f"Error upserting intra-day checkup: {str(e)}", exc_info=True)
        session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        try:
            session.close()
        except Exception:
            pass


@app.route('/api/cameras', methods=['GET'])
def get_cameras():
    """Get list of unique cameras/devices in the database"""
    try:
        session = get_db_session()
        
        # Get distinct uidds
        distinct_uidds = session.query(PeopleAnalyticsRecord.uidd)\
            .distinct()\
            .all()
        
        cameras = [{'id': uidd[0], 'name': uidd[0]} for uidd in distinct_uidds]
        
        return jsonify({
            'success': True,
            'cameras': cameras
        })
        
    except Exception as e:
        logger.error(f"Error fetching cameras: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        session.close()


if __name__ == '__main__':
    port = int(os.getenv('API_PORT', '5000'))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    logger.info(f"Starting API service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)


