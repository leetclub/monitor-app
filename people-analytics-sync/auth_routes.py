"""
Session + Google Sign-In for browser clients (monitoring-app-v2).
Requires env GOOGLE_CLIENT_ID (same Web client ID as the SPA).
"""
import os
import logging

from flask import jsonify, request, session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = (os.environ.get('GOOGLE_CLIENT_ID') or '').strip()


def register_auth_routes(app) -> None:
    @app.route('/api/auth/google', methods=['POST', 'OPTIONS'])
    def auth_google():
        if request.method == 'OPTIONS':
            return '', 204
        if not GOOGLE_CLIENT_ID:
            return jsonify({'error': 'GOOGLE_CLIENT_ID not configured on server'}), 503
        body = request.get_json(silent=True) or {}
        token = body.get('token') or body.get('credential')
        if not token:
            return jsonify({'error': 'token required'}), 400
        try:
            idinfo = id_token.verify_oauth2_token(
                token, google_requests.Request(), GOOGLE_CLIENT_ID
            )
            if idinfo.get('email_verified') is False:
                return jsonify({'error': 'email not verified'}), 403
            email = idinfo['email'].strip().lower()
            session['email'] = email
            session.permanent = True
            return jsonify({'ok': True, 'email': email})
        except Exception as ex:
            logger.warning('auth_google: %s', ex)
            return jsonify({'error': 'invalid token'}), 401

    @app.route('/api/auth/logout', methods=['POST', 'OPTIONS'])
    def auth_logout():
        if request.method == 'OPTIONS':
            return '', 204
        session.clear()
        return jsonify({'ok': True})

    @app.route('/api/me', methods=['GET', 'OPTIONS'])
    def me():
        if request.method == 'OPTIONS':
            return '', 204
        e = session.get('email')
        return jsonify({'email': e})
