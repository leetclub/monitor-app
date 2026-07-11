"""Promo tab routes for target.theleetclub.com."""

from __future__ import annotations

import logging
from typing import Any, Callable, List, Optional

from flask import jsonify, request
from sqlalchemy import text

from promo_lib import (
    DEFAULT_PRODUCT,
    fetch_promo_performance,
    kuwait_today,
    product_cups_partial_day_compare,
)
from target_site_routes import (
    area_owner_session_id,
    is_target_site_admin,
    require_target_site,
    require_target_site_admin,
)

logger = logging.getLogger(__name__)


def register_target_promo_routes(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn) -> None:
    @app.route("/api/target-site/promo/assignments", methods=["GET", "OPTIONS"])
    @require_target_site_admin
    def promo_assignments_list():
        if request.method == "OPTIONS":
            return "", 204
        db = get_db_session()
        try:
            rows = db.execute(
                text(
                    """
                    SELECT id, scope_type, machine_id, vendon_user_id, product_name, updated_by, updated_at
                    FROM target_promo_assignment
                    ORDER BY updated_at DESC
                    """
                )
            ).mappings().all()
            return jsonify({"ok": True, "assignments": [dict(r) for r in rows]})
        finally:
            db.close()

    @app.route("/api/target-site/promo/assignments", methods=["POST", "OPTIONS"])
    @require_target_site_admin
    def promo_assignments_save():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        scope_type = str(body.get("scopeType") or body.get("scope_type") or "").strip().lower()
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip() or None
        vendon_user_id = str(body.get("vendonUserId") or body.get("vendon_user_id") or "").strip() or None
        product_name = str(body.get("productName") or body.get("product_name") or DEFAULT_PRODUCT).strip()
        updated_by = str(body.get("updatedBy") or "admin").strip()
        if scope_type not in ("machine", "owner"):
            return jsonify({"ok": False, "error": "scopeType must be machine or owner"}), 400
        if scope_type == "machine" and not machine_id:
            return jsonify({"ok": False, "error": "machineId required for machine scope"}), 400
        if scope_type == "owner" and not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required for owner scope"}), 400

        db = get_db_session()
        try:
            if scope_type == "machine":
                db.execute(
                    text("DELETE FROM target_promo_assignment WHERE scope_type = 'machine' AND machine_id = :mid"),
                    {"mid": machine_id},
                )
            else:
                db.execute(
                    text(
                        "DELETE FROM target_promo_assignment WHERE scope_type = 'owner' AND vendon_user_id = :uid"
                    ),
                    {"uid": vendon_user_id},
                )
            db.execute(
                text(
                    """
                    INSERT INTO target_promo_assignment
                      (scope_type, machine_id, vendon_user_id, product_name, updated_by, updated_at)
                    VALUES (:scope_type, :machine_id, :vendon_user_id, :product_name, :updated_by, NOW())
                    """
                ),
                {
                    "scope_type": scope_type,
                    "machine_id": machine_id,
                    "vendon_user_id": vendon_user_id,
                    "product_name": product_name or DEFAULT_PRODUCT,
                    "updated_by": updated_by,
                },
            )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            db.rollback()
            logger.exception("promo assignment save")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/day-targets", methods=["GET", "OPTIONS"])
    @require_target_site_admin
    def promo_day_targets_list():
        if request.method == "OPTIONS":
            return "", 204
        start = (request.args.get("start_date") or request.args.get("startDate") or "").strip()
        end = (request.args.get("end_date") or request.args.get("endDate") or "").strip()
        machine_id = (request.args.get("machine_id") or request.args.get("machineId") or "").strip()
        db = get_db_session()
        try:
            q = """
                SELECT id, machine_id, target_date::text AS target_date, target_cups, updated_by, updated_at
                FROM target_promo_day_target
                WHERE 1=1
            """
            params: dict = {}
            if start:
                q += " AND target_date >= CAST(:start AS date)"
                params["start"] = start
            if end:
                q += " AND target_date <= CAST(:end AS date)"
                params["end"] = end
            if machine_id:
                q += " AND machine_id = :mid"
                params["mid"] = machine_id
            q += " ORDER BY target_date, machine_id"
            rows = db.execute(text(q), params).mappings().all()
            return jsonify({"ok": True, "dayTargets": [dict(r) for r in rows]})
        finally:
            db.close()

    @app.route("/api/target-site/promo/day-targets", methods=["POST", "OPTIONS"])
    @require_target_site_admin
    def promo_day_targets_save():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
        target_date = str(body.get("targetDate") or body.get("target_date") or "").strip()
        try:
            target_cups = int(body.get("targetCups") or body.get("target_cups") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "targetCups must be an integer"}), 400
        updated_by = str(body.get("updatedBy") or "admin").strip()
        if not machine_id or not target_date:
            return jsonify({"ok": False, "error": "machineId and targetDate required"}), 400
        db = get_db_session()
        try:
            db.execute(
                text(
                    """
                    INSERT INTO target_promo_day_target (machine_id, target_date, target_cups, updated_by, updated_at)
                    VALUES (:mid, CAST(:d AS date), :cups, :by, NOW())
                    ON CONFLICT (machine_id, target_date)
                    DO UPDATE SET target_cups = EXCLUDED.target_cups, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                    """
                ),
                {"mid": machine_id, "d": target_date, "cups": max(0, target_cups), "by": updated_by},
            )
            db.commit()
            return jsonify({"ok": True})
        except Exception as ex:
            db.rollback()
            logger.exception("promo day target save")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/day-targets/bulk", methods=["POST", "OPTIONS"])
    @require_target_site_admin
    def promo_day_targets_bulk():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        machine_ids: List[str] = [
            str(x).strip() for x in (body.get("machineIds") or body.get("machine_ids") or []) if str(x).strip()
        ]
        dates: List[str] = [str(x).strip() for x in (body.get("dates") or []) if str(x).strip()]
        try:
            target_cups = int(body.get("targetCups") or body.get("target_cups") or 0)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "targetCups must be an integer"}), 400
        updated_by = str(body.get("updatedBy") or "admin").strip()
        if not machine_ids or not dates:
            return jsonify({"ok": False, "error": "machineIds and dates required"}), 400
        db = get_db_session()
        try:
            for mid in machine_ids:
                for d in dates:
                    db.execute(
                        text(
                            """
                            INSERT INTO target_promo_day_target (machine_id, target_date, target_cups, updated_by, updated_at)
                            VALUES (:mid, CAST(:d AS date), :cups, :by, NOW())
                            ON CONFLICT (machine_id, target_date)
                            DO UPDATE SET target_cups = EXCLUDED.target_cups, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                            """
                        ),
                        {"mid": mid, "d": d, "cups": max(0, target_cups), "by": updated_by},
                    )
            db.commit()
            return jsonify({"ok": True, "saved": len(machine_ids) * len(dates)})
        except Exception as ex:
            db.rollback()
            logger.exception("promo day targets bulk")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/performance", methods=["GET", "OPTIONS"])
    @require_target_site
    def promo_performance():
        if request.method == "OPTIONS":
            return "", 204
        start = (request.args.get("start_date") or request.args.get("startDate") or "").strip()
        end = (request.args.get("end_date") or request.args.get("endDate") or "").strip()
        if not start or not end:
            today = kuwait_today().isoformat()
            start = start or today
            end = end or today
        raw_ids = (request.args.get("machine_ids") or request.args.get("machineIds") or "").strip()
        machine_ids = {x.strip() for x in raw_ids.split(",") if x.strip()} if raw_ids else None

        if not is_target_site_admin():
            owner_id = area_owner_session_id()
            if not owner_id:
                return jsonify({"ok": False, "error": "Forbidden"}), 403
            db = get_db_session()
            try:
                row = db.execute(
                    text("SELECT machine_ids FROM target_area_owner WHERE vendon_user_id = :id"),
                    {"id": owner_id},
                ).mappings().first()
                allowed = set(str(x) for x in (row or {}).get("machine_ids") or [])
                machine_ids = allowed if machine_ids is None else machine_ids & allowed
            finally:
                db.close()

        db = get_db_session()
        try:
            payload = fetch_promo_performance(
                db,
                get_vendon_machines_fn(),
                start,
                end,
                fetch_vends_fn,
                machine_ids=machine_ids,
            )
            return jsonify({"ok": True, **payload})
        except Exception as ex:
            logger.exception("promo performance")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/instruments", methods=["GET", "OPTIONS"])
    @require_target_site
    def promo_instruments_list():
        if request.method == "OPTIONS":
            return "", 204
        vendon_user_id = (request.args.get("vendon_user_id") or request.args.get("vendonUserId") or "").strip()
        if not is_target_site_admin():
            vendon_user_id = area_owner_session_id() or vendon_user_id
        db = get_db_session()
        try:
            q = """
                SELECT id, vendon_user_id, name, sort_order, active, updated_at
                FROM target_promo_instrument
                WHERE active = TRUE
            """
            params = {}
            if vendon_user_id:
                q += " AND vendon_user_id = :uid"
                params["uid"] = vendon_user_id
            q += " ORDER BY sort_order, id"
            rows = db.execute(text(q), params).mappings().all()
            return jsonify({"ok": True, "instruments": [dict(r) for r in rows]})
        finally:
            db.close()

    @app.route("/api/target-site/promo/instruments", methods=["POST", "OPTIONS"])
    @require_target_site_admin
    def promo_instruments_save():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        vendon_user_id = str(body.get("vendonUserId") or body.get("vendon_user_id") or "").strip()
        names = body.get("names") or body.get("instruments") or []
        if not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required"}), 400
        clean_names = [str(n).strip() for n in names if str(n).strip()]
        if not clean_names:
            return jsonify({"ok": False, "error": "names required"}), 400
        db = get_db_session()
        try:
            db.execute(
                text("UPDATE target_promo_instrument SET active = FALSE WHERE vendon_user_id = :uid"),
                {"uid": vendon_user_id},
            )
            for i, name in enumerate(clean_names):
                db.execute(
                    text(
                        """
                        INSERT INTO target_promo_instrument (vendon_user_id, name, sort_order, active, updated_at)
                        VALUES (:uid, :name, :ord, TRUE, NOW())
                        """
                    ),
                    {"uid": vendon_user_id, "name": name, "ord": i},
                )
            db.commit()
            return jsonify({"ok": True, "count": len(clean_names)})
        except Exception as ex:
            db.rollback()
            logger.exception("promo instruments save")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/swipe", methods=["POST", "OPTIONS"])
    @require_target_site
    def promo_swipe_log():
        if request.method == "OPTIONS":
            return "", 204
        body = request.get_json(silent=True) or {}
        instrument_id = body.get("instrumentId") or body.get("instrument_id")
        machine_id = str(body.get("machineId") or body.get("machine_id") or "").strip()
        product_name = str(body.get("productName") or body.get("product_name") or DEFAULT_PRODUCT).strip()
        try:
            instrument_id = int(instrument_id)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "instrumentId required"}), 400
        if not machine_id:
            return jsonify({"ok": False, "error": "machineId required"}), 400

        vendon_user_id = area_owner_session_id() if not is_target_site_admin() else str(
            body.get("vendonUserId") or body.get("vendon_user_id") or ""
        ).strip()
        if not vendon_user_id and is_target_site_admin():
            vendon_user_id = str(body.get("vendonUserId") or "").strip() or "admin"
        if not vendon_user_id:
            return jsonify({"ok": False, "error": "vendonUserId required"}), 400

        if not is_target_site_admin():
            db = get_db_session()
            try:
                row = db.execute(
                    text("SELECT machine_ids FROM target_area_owner WHERE vendon_user_id = :id"),
                    {"id": vendon_user_id},
                ).mappings().first()
                allowed = set(str(x) for x in (row or {}).get("machine_ids") or [])
                if machine_id not in allowed:
                    return jsonify({"ok": False, "error": "Machine not in your area"}), 403
            finally:
                db.close()

        today_cups, yesterday_cups = product_cups_partial_day_compare(
            machine_id, product_name, fetch_vends_fn
        )
        delta = today_cups - yesterday_cups
        db = get_db_session()
        try:
            ins = db.execute(
                text(
                    """
                    INSERT INTO target_promo_swipe_event
                      (instrument_id, machine_id, vendon_user_id, swiped_at,
                       product_cups_now, product_cups_yesterday_same_time, delta_cups, note)
                    VALUES (:iid, :mid, :uid, NOW(), :now_c, :y_c, :delta, :note)
                    RETURNING id, swiped_at
                    """
                ),
                {
                    "iid": instrument_id,
                    "mid": machine_id,
                    "uid": vendon_user_id,
                    "now_c": today_cups,
                    "y_c": yesterday_cups,
                    "delta": delta,
                    "note": str(body.get("note") or "").strip() or None,
                },
            ).mappings().first()
            db.commit()
            return jsonify(
                {
                    "ok": True,
                    "eventId": ins.get("id") if ins else None,
                    "productCupsNow": today_cups,
                    "productCupsYesterdaySameTime": yesterday_cups,
                    "deltaCups": delta,
                    "swipedAt": str(ins.get("swiped_at")) if ins else None,
                }
            )
        except Exception as ex:
            db.rollback()
            logger.exception("promo swipe")
            return jsonify({"ok": False, "error": str(ex)}), 500
        finally:
            db.close()

    @app.route("/api/target-site/promo/swipe-events", methods=["GET", "OPTIONS"])
    @require_target_site
    def promo_swipe_events():
        if request.method == "OPTIONS":
            return "", 204
        vendon_user_id = (request.args.get("vendon_user_id") or request.args.get("vendonUserId") or "").strip()
        if not is_target_site_admin():
            vendon_user_id = area_owner_session_id() or ""
        db = get_db_session()
        try:
            q = """
                SELECT e.id, e.instrument_id, i.name AS instrument_name, e.machine_id, e.vendon_user_id,
                       e.swiped_at, e.product_cups_now, e.product_cups_yesterday_same_time, e.delta_cups, e.note
                FROM target_promo_swipe_event e
                JOIN target_promo_instrument i ON i.id = e.instrument_id
                WHERE 1=1
            """
            params = {}
            if vendon_user_id:
                q += " AND e.vendon_user_id = :uid"
                params["uid"] = vendon_user_id
            q += " ORDER BY e.swiped_at DESC LIMIT 200"
            rows = db.execute(text(q), params).mappings().all()
            return jsonify({"ok": True, "events": [dict(r) for r in rows]})
        finally:
            db.close()
