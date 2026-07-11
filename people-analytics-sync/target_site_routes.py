"""
Shared-secret session auth for target.theleetclub.com.

- Admin: full Owners / Analytics / all Areas.
- Area owner: Areas tab only — their assigned machines.
"""
from __future__ import annotations

import logging
import os
from functools import wraps
from typing import Any, Callable, Optional

from flask import jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

logger = logging.getLogger(__name__)

ADMIN_USER = (os.environ.get("TARGET_SITE_ADMIN_USER") or "admin").strip()
ADMIN_PASSWORD = (os.environ.get("TARGET_SITE_ADMIN_PASSWORD") or "").strip()

ROLE_ADMIN = "admin"
ROLE_AREA_OWNER = "area_owner"


def target_site_authenticated() -> bool:
    return session.get("target_site_auth") is True


def target_site_role() -> Optional[str]:
    if not target_site_authenticated():
        return None
    return session.get("target_site_role") or ROLE_ADMIN


def is_target_site_admin() -> bool:
    return target_site_role() == ROLE_ADMIN


def area_owner_session_id() -> Optional[str]:
    if target_site_role() != ROLE_AREA_OWNER:
        return None
    uid = (session.get("target_site_vendon_user_id") or "").strip()
    return uid or None


def hash_area_password(password: str) -> str:
    return generate_password_hash(password.strip(), method="scrypt")


def verify_area_password(password_hash: str, password: str) -> bool:
    if not password_hash or not password:
        return False
    try:
        return check_password_hash(password_hash, password)
    except Exception:
        return False


def _session_payload() -> dict:
    role = target_site_role()
    user = session.get("target_site_user") or ADMIN_USER
    out: dict = {"ok": True, "role": role, "user": user}
    if role == ROLE_AREA_OWNER:
        uid = session.get("target_site_vendon_user_id")
        stored = session.get("target_site_vendon_user_name") or ""
        from target_vendon_users import resolve_vendon_display_name

        display_name = resolve_vendon_display_name(str(uid or ""), str(stored))
        if display_name != str(stored).strip():
            session["target_site_vendon_user_name"] = display_name
        out["vendonUserId"] = uid
        out["vendonUserName"] = display_name
    return out


def _set_admin_session(admin_user: Optional[str] = None) -> None:
    session["target_site_auth"] = True
    session["target_site_role"] = ROLE_ADMIN
    session["target_site_user"] = (admin_user or ADMIN_USER).strip() or ADMIN_USER
    session.pop("target_site_vendon_user_id", None)
    session.pop("target_site_vendon_user_name", None)
    session.permanent = True


def _normalize_login_user(user: str) -> str:
    u = (user or "").strip()
    if "@" in u and not u.lower().startswith(ADMIN_USER.lower()):
        return u.lower()
    return u


def _try_area_owner_login(user: str, password: str, get_db_session) -> bool:
    if get_db_session is None:
        return False
    from sqlalchemy import text

    db = get_db_session()
    try:
        row = db.execute(
            text(
                """
                SELECT vendon_user_id, vendon_user_name, login_username, password_hash
                FROM target_area_owner
                WHERE LOWER(login_username) = LOWER(:user)
                LIMIT 1
                """
            ),
            {"user": user},
        ).fetchone()
    finally:
        db.close()

    if not row or not row.password_hash:
        return False
    if not verify_area_password(row.password_hash, password):
        return False

    from target_vendon_users import resolve_vendon_display_name

    display_name = resolve_vendon_display_name(row.vendon_user_id, row.vendon_user_name)
    if display_name != (row.vendon_user_name or "").strip():
        try:
            db = get_db_session()
            db.execute(
                text(
                    """
                    UPDATE target_area_owner
                    SET vendon_user_name = :name, updated_at = NOW()
                    WHERE vendon_user_id = :id
                    """
                ),
                {"name": display_name, "id": row.vendon_user_id},
            )
            db.commit()
            db.close()
        except Exception as ex:
            logger.warning("area owner name refresh failed: %s", ex)

    _set_area_owner_session(row.login_username or user, row.vendon_user_id, display_name)
    return True


def _try_email_admin_login(user: str, password: str, get_db_session) -> bool:
    """Return True if email admin credentials matched and session was set."""
    if get_db_session is None or "@" not in user:
        return False
    from sqlalchemy import text

    db = get_db_session()
    try:
        row = db.execute(
            text(
                """
                SELECT email, password_hash, display_name
                FROM target_site_admin
                WHERE LOWER(email) = LOWER(:email) AND active = TRUE
                LIMIT 1
                """
            ),
            {"email": user},
        ).fetchone()
    finally:
        db.close()
    if not row or not row.password_hash:
        return False
    if not verify_area_password(row.password_hash, password):
        return False
    _set_admin_session(str(row.email).strip().lower())
    return True


def _set_area_owner_session(
    login_username: str,
    vendon_user_id: str,
    vendon_user_name: str,
) -> None:
    session["target_site_auth"] = True
    session["target_site_role"] = ROLE_AREA_OWNER
    session["target_site_user"] = login_username
    session["target_site_vendon_user_id"] = vendon_user_id
    session["target_site_vendon_user_name"] = vendon_user_name
    session.permanent = True


def _clear_target_site_session() -> None:
    session.pop("target_site_auth", None)
    session.pop("target_site_role", None)
    session.pop("target_site_user", None)
    session.pop("target_site_vendon_user_id", None)
    session.pop("target_site_vendon_user_name", None)


def require_target_site(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Admin or area owner."""

    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        if request.method == "OPTIONS":
            return fn(*args, **kwargs)
        if not target_site_authenticated():
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)

    return wrapper


def require_target_site_admin(fn: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any):
        if request.method == "OPTIONS":
            return fn(*args, **kwargs)
        if not target_site_authenticated():
            return jsonify({"error": "unauthorized"}), 401
        if not is_target_site_admin():
            return jsonify({"error": "admin required"}), 403
        return fn(*args, **kwargs)

    return wrapper


def register_target_site_routes(app, get_db_session=None) -> None:
    @app.route("/api/target-site/session", methods=["GET", "OPTIONS"])
    def target_site_session():
        if request.method == "OPTIONS":
            return "", 204
        if target_site_authenticated():
            return jsonify(_session_payload())
        return jsonify({"ok": False})

    @app.route("/api/target-site/login", methods=["POST", "OPTIONS"])
    def target_site_login():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        user = _normalize_login_user(body.get("user") or "")
        password = body.get("password") or ""

        if not user or not password:
            return jsonify({"error": "user and password required"}), 400

        intent = str(body.get("intent") or "admin").strip().lower()
        if intent not in ("admin", "area_owner"):
            intent = "admin"

        if intent == "area_owner":
            if _try_area_owner_login(user, password, get_db_session):
                return jsonify(_session_payload())
            return jsonify({"error": "invalid credentials"}), 401

        # Admin intent (Owners / Analytics / Promo admin sections)
        if ADMIN_PASSWORD and user == ADMIN_USER and password == ADMIN_PASSWORD:
            _set_admin_session()
            return jsonify(_session_payload())

        if "@" in user and get_db_session is not None:
            if _try_email_admin_login(user, password, get_db_session):
                return jsonify(_session_payload())

        if _try_area_owner_login(user, password, get_db_session):
            return jsonify(_session_payload())

        return jsonify({"error": "invalid credentials"}), 401

    @app.route("/api/target-site/login-area", methods=["POST", "OPTIONS"])
    def target_site_login_area():
        """Areas tab only — never grants admin session (dual-access emails safe)."""
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        user = _normalize_login_user(body.get("user") or "")
        password = body.get("password") or ""
        if not user or not password:
            return jsonify({"error": "user and password required"}), 400
        if _try_area_owner_login(user, password, get_db_session):
            return jsonify(_session_payload())
        return jsonify({"error": "invalid credentials"}), 401

    @app.route("/api/target-site/logout", methods=["POST", "OPTIONS"])
    def target_site_logout():
        if request.method == "OPTIONS":
            return "", 204
        _clear_target_site_session()
        return jsonify({"ok": True})

    @app.route("/api/target-site/admins", methods=["GET", "OPTIONS"])
    @require_target_site_admin
    def target_site_admins_list():
        if request.method == "OPTIONS":
            return "", 204
        if get_db_session is None:
            return jsonify({"ok": True, "admins": []})
        from sqlalchemy import text

        db = get_db_session()
        try:
            rows = db.execute(
                text(
                    """
                    SELECT id, email, display_name, active, created_by, created_at, updated_at
                    FROM target_site_admin
                    ORDER BY LOWER(email)
                    """
                )
            ).mappings().all()
            return jsonify({"ok": True, "admins": [dict(r) for r in rows]})
        finally:
            db.close()

    @app.route("/api/target-site/admins", methods=["POST", "OPTIONS"])
    @require_target_site_admin
    def target_site_admins_create():
        if request.method == "OPTIONS":
            return "", 204
        if get_db_session is None:
            return jsonify({"ok": False, "error": "database unavailable"}), 503
        body = request.get_json(silent=True) or {}
        email = _normalize_login_user(str(body.get("email") or body.get("user") or ""))
        password = str(body.get("password") or "").strip()
        display_name = str(body.get("displayName") or body.get("display_name") or "").strip() or None
        if not email or "@" not in email:
            return jsonify({"ok": False, "error": "valid email required"}), 400
        if len(password) < 8:
            return jsonify({"ok": False, "error": "password must be at least 8 characters"}), 400

        from sqlalchemy import text

        created_by = session.get("target_site_user") or ADMIN_USER
        db = get_db_session()
        try:
            existing = db.execute(
                text("SELECT id FROM target_site_admin WHERE LOWER(email) = LOWER(:email) LIMIT 1"),
                {"email": email},
            ).fetchone()
            pwd_hash = hash_area_password(password)
            if existing:
                db.execute(
                    text(
                        """
                        UPDATE target_site_admin
                        SET password_hash = :hash,
                            display_name = COALESCE(:name, display_name),
                            active = TRUE,
                            updated_at = NOW()
                        WHERE id = :id
                        """
                    ),
                    {"hash": pwd_hash, "name": display_name, "id": existing.id},
                )
            else:
                db.execute(
                    text(
                        """
                        INSERT INTO target_site_admin
                          (email, password_hash, display_name, active, created_by, updated_at)
                        VALUES (:email, :hash, :name, TRUE, :by, NOW())
                        """
                    ),
                    {
                        "email": email,
                        "hash": pwd_hash,
                        "name": display_name,
                        "by": created_by,
                    },
                )
            db.commit()
            return jsonify({"ok": True, "email": email})
        except Exception as ex:
            db.rollback()
            logger.exception("target_site_admins_create")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()
