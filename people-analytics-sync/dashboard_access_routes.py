"""
REST API for Motion dashboard tab permissions (PostgreSQL).
Secured with header X-Dashboard-Access-Secret matching env DASHBOARD_ACCESS_API_KEY.
Called from Google Apps Script (UrlFetchApp) — email is supplied by GAS from Session.getActiveUser().
"""
import os
import re
import logging
from typing import Any, Dict, List, Optional, Tuple

from flask import jsonify, request, session as flask_session
from dashboard_access_models import (
    DashboardAccessDefault,
    DashboardAccessUser,
    create_dashboard_engine_and_session,
)

logger = logging.getLogger(__name__)

_dash_session_local = None


def _load_super_admin_emails() -> frozenset:
    """
    Comma-separated list from env DASHBOARD_SUPER_ADMIN_EMAILS (set in K8s Secret/ConfigMap).
    No hardcoded accounts — empty env means no super-admins (only DB rules apply).
    """
    raw = (os.environ.get('DASHBOARD_SUPER_ADMIN_EMAILS') or '').strip()
    if not raw:
        return frozenset()
    return frozenset(x.strip().lower() for x in raw.split(',') if x.strip())


SUPER_ADMIN_EMAILS: frozenset = _load_super_admin_emails()


def _parse_allowed_email_domains_from_env() -> List[str]:
    """
    Optional multi-domain Workspace allowlist (same semantics as Monitor v2 ACCESS_ALLOWED_DOMAIN).
    Env: ACCESS_ALLOWED_EMAIL_DOMAINS or DASHBOARD_ACCESS_EMAIL_DOMAINS — comma or semicolon separated.
    """
    raw = (
        os.environ.get("ACCESS_ALLOWED_EMAIL_DOMAINS")
        or os.environ.get("DASHBOARD_ACCESS_EMAIL_DOMAINS")
        or ""
    ).strip()
    if not raw:
        return []
    out: List[str] = []
    for part in re.split(r"[;,]\s*", raw):
        p = part.strip().lower().lstrip("@")
        if p:
            out.append(p)
    return out


def allowed_email_domains_for_editor(editor_email: str) -> List[str]:
    """Domains allowed when editing dashboard access via session (org + optional env list)."""
    from_env = _parse_allowed_email_domains_from_env()
    if from_env:
        return from_env
    em = str(editor_email or "").strip().lower()
    at = em.rfind("@")
    if at > 0:
        d = em[at + 1 :].strip()
        if d:
            return [d]
    return []


def _email_domain_allowed(addr: str, allowed_domains: List[str]) -> bool:
    if not allowed_domains:
        return True
    a = str(addr).strip().lower()
    if "@" not in a:
        return False
    dom = a.rsplit("@", 1)[-1]
    return dom in allowed_domains


def get_dashboard_session():
    """Session for DASHBOARD_DB_NAME (default monitoring_dashboard), not people_analytics."""
    global _dash_session_local
    if _dash_session_local is None:
        _, _dash_session_local = create_dashboard_engine_and_session()
    return _dash_session_local()

ALL_DASHBOARD_TAB_IDS: List[str] = [
    'events', 'maintenance', 'transactions', 'remoteCredits', 'refill', 'waste', 'attendance', 'operations', 'machineLogs', 'slackListsTemp',
    'liveDashboard', 'overall', 'redAlert',
    'people', 'analytics', 'targets', 'salesReport', 'comparison', 'historical',
    'visitTracking', 'qaFindings',
    'postsInsta',
    'hr', 'strategy',
    'customerFeedback',
    'machinesReview',
    'admin',
    # Standalone alert.theleetclub.com (session + same rules DB as Monitor v2)
    'leetAlert',
    'leetAlertAdmin',
]


def _get_secret() -> str:
    return (os.getenv('DASHBOARD_ACCESS_API_KEY') or '').strip()


def _check_secret() -> bool:
    expected = _get_secret()
    if not expected:
        return False
    got = (
        request.headers.get('X-Dashboard-Access-Secret')
        or request.headers.get('X-Dashboard-Access-Key')
        or ''
    ).strip()
    return got == expected


def _coerce_json_list(val: Any) -> Any:
    """JSONB may come back as list, or as a JSON string if driver/DB differs."""
    if val is None:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        import json
        try:
            parsed = json.loads(val)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _normalize_tab_list(arr: Any) -> List[str]:
    arr = _coerce_json_list(arr) if not isinstance(arr, list) else arr
    if not arr or not isinstance(arr, list):
        return []
    out: List[str] = []
    for x in arr:
        t = str(x).strip()
        if t:
            out.append(t)
    if '*' in out:
        return list(ALL_DASHBOARD_TAB_IDS)
    return out


def _load_rules_raw(session) -> Tuple[List[str], Dict[str, List[str]]]:
    default_row = session.query(DashboardAccessDefault).filter(DashboardAccessDefault.id == 1).first()
    if not default_row or default_row.default_tabs is None:
        default_tabs: List[str] = ['*']
    else:
        dt = _coerce_json_list(default_row.default_tabs)
        default_tabs = dt if isinstance(dt, list) else ['*']
        # Empty [] in DB is almost always a mis-save; otherwise every user without a named row gets zero tabs.
        if not default_tabs:
            logger.warning(
                'dashboard_access: default_tabs is empty for id=1; treating as ["*"] (full default). '
                'To deny-by-default, assign each user explicit rows or use named defaults only.'
            )
            default_tabs = ['*']

    users: Dict[str, List[str]] = {}
    for row in session.query(DashboardAccessUser).all():
        em = row.email.strip().lower()
        raw_u = _coerce_json_list(row.allowed_tabs)
        users[em] = raw_u if isinstance(raw_u, list) else []

    return default_tabs, users


def _load_rules_normalized(session) -> Tuple[List[str], Dict[str, List[str]]]:
    default_tabs, users_raw = _load_rules_raw(session)
    dt = _normalize_tab_list(default_tabs)
    users: Dict[str, List[str]] = {}
    for em, tabs in users_raw.items():
        users[em] = _normalize_tab_list(tabs)
    return dt, users


def _alias_live_dashboard_to_red_alert(tabs: List[str]) -> List[str]:
    """Legacy tab id liveDashboard was merged into redAlert for the GAS board."""
    if not tabs:
        return tabs
    if '*' in tabs or 'redAlert' in tabs:
        return tabs
    if 'liveDashboard' in tabs:
        return list(tabs) + ['redAlert']
    return tabs


def _allowed_for_email(email: str, default_tabs: List[str], users: Dict[str, List[str]]) -> Tuple[List[str], str]:
    e = (email or '').strip().lower()
    if not e:
        return [], 'default'
    if e in SUPER_ADMIN_EMAILS:
        return _alias_live_dashboard_to_red_alert(list(ALL_DASHBOARD_TAB_IDS)), 'super_admin'
    if e in users:
        return _alias_live_dashboard_to_red_alert(_normalize_tab_list(users[e])), 'named_user'
    return _alias_live_dashboard_to_red_alert(_normalize_tab_list(default_tabs)), 'default'


def resolve_session_allowed_tabs() -> Tuple[str, List[str], str]:
    """
    Resolve tab ids for the current Flask session user.

    Returns (email_lower, allowed_tab_ids, matched_by) where matched_by is one of:
    super_admin | named_user | default. email is '' if unauthenticated.
    """
    email = (flask_session.get('email') or '').strip().lower()
    if not email:
        return '', [], ''
    db_session = get_dashboard_session()
    try:
        default_tabs, users = _load_rules_normalized(db_session)
        allowed, matched_by = _allowed_for_email(email, default_tabs, users)
        return email, allowed, matched_by
    finally:
        db_session.close()


def register_dashboard_access_routes(app) -> None:
    """Register routes on the given Flask app."""
    logger.info(
        'dashboard_access: %s super-admin email(s) from DASHBOARD_SUPER_ADMIN_EMAILS',
        len(SUPER_ADMIN_EMAILS),
    )

    @app.route('/api/dashboard-access/resolve', methods=['POST', 'OPTIONS'])
    def dashboard_access_resolve():
        if request.method == 'OPTIONS':
            return '', 204
        if not _check_secret():
            return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
        if not _get_secret():
            return jsonify({'ok': False, 'error': 'DASHBOARD_ACCESS_API_KEY not configured on server'}), 503

        body = request.get_json(silent=True) or {}
        email = (body.get('email') or '').strip().lower()
        if not email:
            return jsonify({'ok': False, 'error': 'email required'}), 400

        session = get_dashboard_session()
        try:
            default_tabs, users = _load_rules_normalized(session)
            allowed, matched_by = _allowed_for_email(email, default_tabs, users)
            has_saved = session.query(DashboardAccessUser).count() > 0
            matched_label = matched_by if matched_by in ('named_user', 'super_admin') else 'default'
            return jsonify({
                'ok': True,
                'email': body.get('email') or email,
                'allowedTabs': allowed,
                'allTabIds': ALL_DASHBOARD_TAB_IDS,
                'matchedBy': matched_label,
                'hasSavedRules': has_saved,
                'rulesSource': 'database',
            })
        except Exception as ex:
            logger.exception('dashboard_access_resolve')
            return jsonify({'ok': False, 'error': str(ex)}), 500
        finally:
            session.close()

    @app.route('/api/dashboard-access/rules', methods=['GET', 'PUT', 'OPTIONS'])
    def dashboard_access_rules():
        if request.method == 'OPTIONS':
            return '', 204
        if not _check_secret():
            return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
        if not _get_secret():
            return jsonify({'ok': False, 'error': 'DASHBOARD_ACCESS_API_KEY not configured on server'}), 503

        session = get_dashboard_session()
        try:
            if request.method == 'GET':
                default_tabs, users = _load_rules_raw(session)
                return jsonify({
                    'ok': True,
                    'defaultTabs': default_tabs,
                    'users': users,
                    'allTabIds': ALL_DASHBOARD_TAB_IDS,
                    'fromSheetActive': False,
                    'source': 'database',
                })

            # PUT
            body = request.get_json(silent=True) or {}
            default_tabs_in = body.get('defaultTabs')
            users_in = body.get('users') or {}
            if not isinstance(default_tabs_in, list):
                return jsonify({'success': False, 'error': 'defaultTabs must be an array'}), 400
            if not isinstance(users_in, dict):
                return jsonify({'success': False, 'error': 'users must be an object'}), 400

            session.query(DashboardAccessUser).delete(synchronize_session=False)

            row = session.query(DashboardAccessDefault).filter(DashboardAccessDefault.id == 1).first()
            if not row:
                row = DashboardAccessDefault(id=1, default_tabs=default_tabs_in)
                session.add(row)
            else:
                row.default_tabs = default_tabs_in

            for em, tabs in users_in.items():
                key = str(em).strip().lower()
                if not key or key in ('default', '_default') or key in SUPER_ADMIN_EMAILS:
                    continue
                if not isinstance(tabs, list):
                    continue
                session.add(DashboardAccessUser(email=key, allowed_tabs=tabs))

            session.commit()
            return jsonify({'success': True, 'message': 'Saved to database.'})
        except Exception as ex:
            logger.exception('dashboard_access_rules')
            session.rollback()
            return jsonify({'success': False, 'error': str(ex)}), 500
        finally:
            session.close()

    @app.route('/api/me/dashboard-access', methods=['GET', 'OPTIONS'])
    def me_dashboard_access():
        """Session-backed tab list for signed-in Google users (no client-side API secret)."""
        if request.method == 'OPTIONS':
            return '', 204
        email, allowed, matched_by = resolve_session_allowed_tabs()
        if not email:
            return jsonify({'error': 'Unauthorized'}), 401

        try:
            full = matched_by == 'super_admin' or (
                allowed and '*' in allowed
            )
            return jsonify(
                {
                    'email': email,
                    'allowedTabs': allowed,
                    'fullAccess': full,
                    'allowedEmailDomains': allowed_email_domains_for_editor(email),
                }
            )
        except Exception as ex:
            logger.exception('me_dashboard_access')
            return jsonify({'error': str(ex)}), 500

    @app.route('/api/me/dashboard-access/rules', methods=['GET', 'PUT', 'OPTIONS'])
    def me_dashboard_access_rules():
        """
        Session-backed rules editor for Monitor v2 Admin tab (no DASHBOARD_ACCESS_API_KEY in browser).

        Who may read/write:
        - super_admin (DASHBOARD_SUPER_ADMIN_EMAILS), or
        - any user granted the `admin` tab (Monitor product admins), or
        - any user granted `leetAlertAdmin` (Leet Alert app Admin — access rules subset).
        """
        if request.method == 'OPTIONS':
            return '', 204
        email, allowed, matched_by = resolve_session_allowed_tabs()
        if not email:
            return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
        is_privileged = (
            matched_by == 'super_admin'
            or 'admin' in allowed
            or 'leetAlertAdmin' in allowed
        )
        if not is_privileged:
            return jsonify({'ok': False, 'error': 'Forbidden'}), 403

        session = get_dashboard_session()
        try:
            if request.method == 'GET':
                default_tabs, users = _load_rules_raw(session)
                return jsonify({
                    'ok': True,
                    'defaultTabs': default_tabs,
                    'users': users,
                    'allTabIds': ALL_DASHBOARD_TAB_IDS,
                    'fromSheetActive': False,
                    'source': 'database',
                    'allowedEmailDomains': allowed_email_domains_for_editor(email),
                })

            body = request.get_json(silent=True) or {}
            default_tabs_in = body.get('defaultTabs')
            users_in = body.get('users') or {}
            if not isinstance(default_tabs_in, list):
                return jsonify({'success': False, 'error': 'defaultTabs must be an array'}), 400
            if not isinstance(users_in, dict):
                return jsonify({'success': False, 'error': 'users must be an object'}), 400

            allowed_domains = allowed_email_domains_for_editor(email)
            for em, tabs in users_in.items():
                key = str(em).strip().lower()
                if not key or key in ('default', '_default') or key in SUPER_ADMIN_EMAILS:
                    continue
                if not isinstance(tabs, list):
                    continue
                if not _email_domain_allowed(key, allowed_domains):
                    doms = ", ".join(allowed_domains) if allowed_domains else "(none configured)"
                    return jsonify(
                        {
                            'success': False,
                            'error': (
                                f'Email "{key}" must be on an allowed Google Workspace domain '
                                f'({doms}). Set ACCESS_ALLOWED_EMAIL_DOMAINS for multiple domains.'
                            ),
                        }
                    ), 400

            session.query(DashboardAccessUser).delete(synchronize_session=False)

            row = session.query(DashboardAccessDefault).filter(DashboardAccessDefault.id == 1).first()
            if not row:
                row = DashboardAccessDefault(id=1, default_tabs=default_tabs_in)
                session.add(row)
            else:
                row.default_tabs = default_tabs_in

            for em, tabs in users_in.items():
                key = str(em).strip().lower()
                if not key or key in ('default', '_default') or key in SUPER_ADMIN_EMAILS:
                    continue
                if not isinstance(tabs, list):
                    continue
                session.add(DashboardAccessUser(email=key, allowed_tabs=tabs))

            session.commit()
            return jsonify({'success': True, 'message': 'Saved to database.'})
        except Exception as ex:
            logger.exception('me_dashboard_access_rules')
            session.rollback()
            return jsonify({'success': False, 'error': str(ex)}), 500
        finally:
            session.close()
