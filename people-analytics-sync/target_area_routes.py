"""
Area owner assignments for target.theleetclub.com (Owners / Areas tabs).
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable, Dict, List, Tuple

from flask import jsonify, request
from sqlalchemy import text

from target_site_routes import (
    ADMIN_USER,
    area_owner_session_id,
    hash_area_password,
    is_target_site_admin,
    require_target_site,
    require_target_site_admin,
)

logger = logging.getLogger(__name__)

_LOGIN_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MACHINE_CATALOG_TTL_SEC = 300
_machine_catalog_cache: Dict[str, Any] = {"at": 0.0, "rows": []}


def _cached_machines_catalog(
    get_vendon_machines_fn: Callable[[], List[Dict[str, Any]]],
) -> List[Dict[str, str]]:
    now = time.time()
    if _machine_catalog_cache["rows"] and now - float(_machine_catalog_cache["at"]) < _MACHINE_CATALOG_TTL_SEC:
        return list(_machine_catalog_cache["rows"])
    catalog = _machines_catalog(get_vendon_machines_fn)
    _machine_catalog_cache["at"] = now
    _machine_catalog_cache["rows"] = catalog
    return catalog


def _vendon_users_list() -> List[Dict[str, Any]]:
    from target_vendon_users import fetch_vendon_users_for_target

    return fetch_vendon_users_for_target()


def _machines_catalog(
    get_vendon_machines_fn: Callable[[], List[Dict[str, Any]]],
) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for m in get_vendon_machines_fn() or []:
        mid = str(m.get("id") or m.get("machineId") or "").strip()
        if not mid:
            continue
        out.append({"id": mid, "name": str(m.get("name") or mid).strip()})
    out.sort(key=lambda x: x["name"].lower())
    return out


def _row_to_area(
    r,
    machine_catalog: Dict[str, str] | None = None,
) -> Dict[str, Any]:
    mids = r.machine_ids
    if isinstance(mids, str):
        try:
            mids = json.loads(mids)
        except Exception:
            mids = []
    if not isinstance(mids, list):
        mids = []
    machine_ids = [str(x) for x in mids]
    machines = []
    if machine_catalog is not None:
        for mid in machine_ids:
            machines.append(
                {"id": mid, "name": machine_catalog.get(mid) or mid},
            )
    from target_vendon_users import resolve_vendon_display_name

    return {
        "vendonUserId": r.vendon_user_id,
        "vendonUserName": resolve_vendon_display_name(r.vendon_user_id, r.vendon_user_name),
        "machineIds": machine_ids,
        "machines": machines,
        "loginUsername": r.login_username or None,
        "hasLogin": bool(r.login_username and r.password_hash),
        "updatedBy": r.updated_by,
        "updatedAt": r.updated_at.isoformat() if r.updated_at else None,
    }


def _load_area_owners(session, vendon_user_id: str | None = None) -> List[Dict[str, Any]]:
    if vendon_user_id:
        rows = session.execute(
            text(
                """
                SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                       password_hash, updated_by, updated_at
                FROM target_area_owner
                WHERE vendon_user_id = :id
                """
            ),
            {"id": vendon_user_id},
        ).fetchall()
    else:
        rows = session.execute(
            text(
                """
                SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                       password_hash, updated_by, updated_at
                FROM target_area_owner
                ORDER BY vendon_user_name ASC
                """
            )
        ).fetchall()
    return [_row_to_area(r) for r in rows]


def _normalize_login(email: str) -> str:
    return email.strip().lower()


def register_target_area_routes(app, get_db_session, get_vendon_machines_fn) -> None:
    @app.route("/api/target-site/vendon-users", methods=["GET", "OPTIONS"])
    @require_target_site_admin
    def vendon_users():
        if request.method == "OPTIONS":
            return "", 204
        return jsonify({"success": True, "users": _vendon_users_list()})

    @app.route("/api/target-site/machines", methods=["GET", "OPTIONS"])
    @require_target_site
    def target_machines():
        if request.method == "OPTIONS":
            return "", 204
        try:
            catalog = _cached_machines_catalog(get_vendon_machines_fn)
            if is_target_site_admin():
                return jsonify({"success": True, "machines": catalog})

            uid = area_owner_session_id()
            if not uid:
                return jsonify({"error": "unauthorized"}), 401

            session = get_db_session()
            try:
                areas = _load_area_owners(session, uid)
                allowed = set(areas[0]["machineIds"]) if areas else set()
                filtered = [m for m in catalog if m["id"] in allowed]
                return jsonify({"success": True, "machines": filtered})
            finally:
                session.close()
        except Exception as ex:
            logger.exception("target_machines")
            return jsonify({"success": False, "error": str(ex)}), 500

    @app.route("/api/target-site/area-owners", methods=["GET", "OPTIONS"])
    @require_target_site
    def list_area_owners():
        if request.method == "OPTIONS":
            return "", 204
        session = get_db_session()
        try:
            catalog = {
                m["id"]: m["name"] for m in _cached_machines_catalog(get_vendon_machines_fn)
            }
            if is_target_site_admin():
                rows = session.execute(
                    text(
                        """
                        SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                               password_hash, updated_by, updated_at
                        FROM target_area_owner
                        ORDER BY vendon_user_name ASC
                        """
                    )
                ).fetchall()
                areas = [_row_to_area(r, catalog) for r in rows]
            else:
                uid = area_owner_session_id()
                if not uid:
                    return jsonify({"error": "unauthorized"}), 401
                rows = session.execute(
                    text(
                        """
                        SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                               password_hash, updated_by, updated_at
                        FROM target_area_owner
                        WHERE vendon_user_id = :id
                        """
                    ),
                    {"id": uid},
                ).fetchall()
                areas = [_row_to_area(r, catalog) for r in rows]
            return jsonify({"success": True, "areas": areas})
        except Exception as ex:
            logger.exception("list_area_owners")
            return jsonify({"success": False, "error": str(ex)}), 500
        finally:
            session.close()

    @app.route("/api/target-site/area-owners/<vendon_user_id>", methods=["PUT", "DELETE", "OPTIONS"])
    @require_target_site_admin
    def upsert_area_owner(vendon_user_id: str):
        if request.method == "OPTIONS":
            return "", 204
        uid = (vendon_user_id or "").strip()
        if not uid:
            return jsonify({"success": False, "error": "vendon_user_id required"}), 400

        session = get_db_session()
        try:
            if request.method == "DELETE":
                session.execute(
                    text("DELETE FROM target_area_owner WHERE vendon_user_id = :id"),
                    {"id": uid},
                )
                session.commit()
                return jsonify({"success": True})

            body = request.get_json(silent=True) or {}
            from target_vendon_users import resolve_vendon_display_name

            name = resolve_vendon_display_name(
                uid,
                str(body.get("vendonUserName") or body.get("name") or "").strip(),
            )
            raw_ids = body.get("machineIds") or []
            if not isinstance(raw_ids, list):
                return jsonify({"success": False, "error": "machineIds must be a list"}), 400
            machine_ids = [str(x).strip() for x in raw_ids if str(x).strip()]

            password = body.get("password") or body.get("newPassword")

            # Login id is always the Vendon user's email (stored lowercased).
            vendon_email = None
            for vu in _vendon_users_list():
                if str(vu.get("id") or "").strip() == uid:
                    vendon_email = _normalize_login(str(vu.get("email") or ""))
                    vu_name = str(vu.get("name") or "").strip()
                    if vu_name:
                        name = vu_name
                    break
            login_username = vendon_email if vendon_email and _LOGIN_RE.match(vendon_email) else None
            if not login_username and machine_ids:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "Vendon user has no email — cannot create Areas login",
                        }
                    ),
                    400,
                )

            params: Dict[str, Any] = {
                "id": uid,
                "name": name,
                "mids": json.dumps(machine_ids),
                "by": ADMIN_USER,
            }

            cred_params: Dict[str, Any] = {"id": uid}
            cred_sets: List[str] = []

            if login_username:
                if login_username.lower() == ADMIN_USER.lower():
                    return jsonify({"success": False, "error": "Email reserved"}), 400
                cred_params["login"] = login_username
                cred_sets.append("login_username = :login")

            if password:
                if len(str(password)) < 6:
                    return (
                        jsonify({"success": False, "error": "Password must be at least 6 characters"}),
                        400,
                    )
                cred_params["phash"] = hash_area_password(str(password))
                cred_sets.append("password_hash = :phash")

            session.execute(
                text(
                    """
                    INSERT INTO target_area_owner (vendon_user_id, vendon_user_name, machine_ids, updated_by, updated_at)
                    VALUES (:id, :name, CAST(:mids AS jsonb), :by, NOW())
                    ON CONFLICT (vendon_user_id) DO UPDATE SET
                      vendon_user_name = EXCLUDED.vendon_user_name,
                      machine_ids = EXCLUDED.machine_ids,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = NOW()
                    """
                ),
                params,
            )

            if cred_sets:
                session.execute(
                    text(
                        f"UPDATE target_area_owner SET {', '.join(cred_sets)} WHERE vendon_user_id = :id"
                    ),
                    cred_params,
                )

            session.commit()

            catalog = {
                m["id"]: m["name"] for m in _cached_machines_catalog(get_vendon_machines_fn)
            }
            row = session.execute(
                text(
                    """
                    SELECT vendon_user_id, vendon_user_name, machine_ids, login_username,
                           password_hash, updated_by, updated_at
                    FROM target_area_owner WHERE vendon_user_id = :id
                    """
                ),
                {"id": uid},
            ).fetchone()
            area = _row_to_area(row, catalog) if row else None
            return jsonify({"success": True, "area": area})
        except Exception as ex:
            session.rollback()
            err = str(ex)
            if "idx_target_area_owner_login_username" in err or "unique" in err.lower():
                return jsonify({"success": False, "error": "Login username already in use"}), 409
            logger.exception("area owner save failed")
            return jsonify({"success": False, "error": err}), 500
        finally:
            session.close()
