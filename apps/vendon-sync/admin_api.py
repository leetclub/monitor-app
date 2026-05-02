"""
Admin Panel API Service
Provides authentication and logs/alerts management
"""
import os
import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from flask import Flask, jsonify, request, session, send_from_directory
from flask.sessions import SecureCookieSessionInterface
from flask_cors import CORS
from functools import wraps
from models import create_engine_and_session
from admin_models import AdminUser, AlertLog, SyncVerificationResult, Base

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.getenv('ADMIN_SECRET_KEY', secrets.token_hex(32))
# Long-lived session so server-stored cookie (e.g. in Apps Script) survives refresh
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
CORS(app, supports_credentials=True)

engine, SessionLocal = create_engine_and_session()

# Initialize admin models
Base.metadata.create_all(bind=engine)


def get_db_session():
    """Get database session"""
    return SessionLocal()


def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        return f(*args, **kwargs)
    return decorated_function


@app.route('/')
def index():
    """Serve admin panel HTML"""
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), 'admin_panel.html')

@app.route('/api/admin/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'admin-panel-api',
        'timestamp': datetime.utcnow().isoformat()
    })


@app.route('/api/admin/login', methods=['POST'])
def login():
    """Admin login endpoint"""
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
            
            # Update last login
            user.last_login = datetime.utcnow()
            session_db.commit()
            
            # Set session (permanent so cookie stored in Apps Script survives refresh)
            session['user_id'] = user.id
            session['username'] = user.username
            session.permanent = True

            logger.info(f"Admin login successful: {username}")
            
            # Return session cookie in body so Apps Script / server-to-server callers can store it
            # (Set-Cookie may be stripped when GAS calls this API)
            session_cookie_value = ''
            try:
                session_serializer = SecureCookieSessionInterface().get_signing_serializer(app)
                session_cookie_value = session_serializer.dumps(dict(session))
                session_cookie_value = f'session={session_cookie_value}'
            except Exception as e:
                logger.warning(f"Could not serialize session for response body: {e}")
            
            return jsonify({
                'success': True,
                'username': user.username,
                'message': 'Login successful',
                'sessionCookie': session_cookie_value or None
            })
            
        finally:
            session_db.close()
            
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/admin/logout', methods=['POST'])
@require_auth
def logout():
    """Admin logout endpoint"""
    username = session.get('username', 'unknown')
    session.clear()
    logger.info(f"Admin logout: {username}")
    return jsonify({'success': True, 'message': 'Logged out'})


@app.route('/api/admin/me', methods=['GET'])
@require_auth
def get_current_user():
    """Get current user info"""
    return jsonify({
        'username': session.get('username'),
        'user_id': session.get('user_id')
    })


@app.route('/api/admin/alerts', methods=['GET'])
@require_auth
def get_alerts():
    """Get alerts/logs with filtering"""
    try:
        level = request.args.get('level')  # info, warning, error, critical
        source = request.args.get('source')
        resolved = request.args.get('resolved')  # true, false, or null for all
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
def resolve_alert(alert_id):
    """Mark alert as resolved"""
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
def get_verification_results():
    """Get sync verification results"""
    try:
        days = int(request.args.get('days', 7))
        status = request.args.get('status')  # passed, failed, warning
        
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
def receive_alert():
    """Receive alert from sync/verify jobs (no auth required, uses API key)"""
    try:
        # Check API key
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
def receive_verification():
    """Receive verification results from verify job (no auth required, uses API key)"""
    try:
        # Check API key
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
                    source='verification',
                    title=f"Sync Verification Failed: {data['sync_date']}",
                    message=data.get('summary', 'Verification failed'),
                    details=json.dumps({'verification_id': result.id, 'errors': data.get('errors')})
                )
                session_db.add(alert)
                session_db.commit()
            
            logger.info(f"Verification result received: {data.get('status')} for {data['sync_date']}")
            
            return jsonify({'success': True, 'verification_id': result.id})
            
        finally:
            session_db.close()
            
    except Exception as e:
        logger.error(f"Error receiving verification: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Create default admin user if doesn't exist
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
    
    port = int(os.getenv('ADMIN_API_PORT', '5002'))
    app.run(host='0.0.0.0', port=port, debug=False)
