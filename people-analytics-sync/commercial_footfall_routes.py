"""
HTTP routes for Commercial Footfall Performance Report.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from typing import Any, Dict, Optional, Set, Tuple

from flask import Blueprint, jsonify, request, send_file
import io

from datetime import datetime
from zoneinfo import ZoneInfo

from commercial_footfall_report import (
    FALLBACK_BUSINESS_DAYS,
    JUL_06_BUSINESS_DAYS,
    JUN_15_BUSINESS_DAYS,
    PRIMARY_BUSINESS_DAYS,
    build_commercial_footfall_report,
    fetch_machines_day_sales,
    fetch_machines_period_sales,
    finalize_commercial_report_payload,
    parse_report_days,
)

try:
    from commercial_footfall_cache_store import (
        delete_report_cache,
        load_report_cache,
        save_report_cache,
    )
except ImportError:
    delete_report_cache = None  # type: ignore
    load_report_cache = None  # type: ignore
    save_report_cache = None  # type: ignore

logger = logging.getLogger(__name__)

bp = Blueprint("commercial_footfall", __name__)

_CACHE_LOCK = threading.Lock()
_BUILD_LOCK = threading.Lock()
_ACTIVE_BUILDS: Set[str] = set()
_CACHES: Dict[str, Dict[str, Any]] = {}
_CACHE_TTL_SEC = int(os.environ.get("COMMERCIAL_FOOTFALL_CACHE_TTL_SEC", str(6 * 3600)))

# Presentation compare window (matches SPA preset)
_COMPARE_SAMPLE_DAYS = ["2025-05-04", "2025-05-05", "2025-05-06", "2025-05-07", "2025-05-08"]


def _truthy_arg(name: str) -> bool:
    raw = (request.args.get(name) or "").strip().lower()
    return raw in ("1", "true", "yes", "y", "on")


def _params_from_request() -> Dict[str, Any]:
    calendar_days = _truthy_arg("calendar_days")
    # Alert / arbitrary windows: skip the fixed May fallback week so each range
    # does not rebuild an unrelated 5-day fleet slice (pool exhaustion + hangs).
    skip_fallback = calendar_days or _truthy_arg("no_fallback")
    primary = parse_report_days(
        request.args.get("start_date"),
        request.args.get("end_date"),
        request.args.get("dates"),
        PRIMARY_BUSINESS_DAYS,
        calendar_days=calendar_days,
    )
    compare_raw = request.args.get("compare_dates") or ""
    compare_start = request.args.get("compare_start_date")
    compare_end = request.args.get("compare_end_date")
    compare: list = []
    if compare_raw or (compare_start and compare_end):
        compare = parse_report_days(
            compare_start,
            compare_end,
            compare_raw,
            [],
            calendar_days=calendar_days,
        )
    if skip_fallback:
        fallback = parse_report_days(
            request.args.get("fallback_start_date"),
            request.args.get("fallback_end_date"),
            request.args.get("fallback_dates"),
            [],
            calendar_days=calendar_days,
        )
    else:
        fallback = parse_report_days(
            request.args.get("fallback_start_date"),
            request.args.get("fallback_end_date"),
            request.args.get("fallback_dates"),
            FALLBACK_BUSINESS_DAYS,
            calendar_days=calendar_days,
        )
    return {
        "primary_days": primary,
        "fallback_days": fallback,
        "compare_days": compare,
        "calendar_days": calendar_days,
        # Alert calendar Periods must not reuse Target warm payloads that embed proxy cups.
        "allow_sales_proxy": (not calendar_days) and (not _truthy_arg("no_sales_proxy")),
    }


def _cache_key(params: Dict[str, Any]) -> str:
    normalized = {
        "primary_days": list(params.get("primary_days") or []),
        "fallback_days": list(params.get("fallback_days") or []),
        "compare_days": list(params.get("compare_days") or []),
        "allow_sales_proxy": bool(params.get("allow_sales_proxy", True)),
    }
    raw = json.dumps(normalized, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _purge_cache_key(get_db_session, key: str) -> None:
    """Drop in-memory and Postgres cache for this report key."""
    with _CACHE_LOCK:
        _CACHES.pop(key, None)
    with _BUILD_LOCK:
        _ACTIVE_BUILDS.discard(key)
    if delete_report_cache:
        session = get_db_session()
        try:
            delete_report_cache(session, key)
            logger.info("commercial footfall purged key=%s from DB", key)
        except Exception as ex:
            logger.warning("commercial footfall DB purge failed key=%s: %s", key, ex)
            try:
                session.rollback()
            except Exception:
                pass
        finally:
            try:
                session.close()
            except Exception:
                pass


def _hydrate_memory_from_db(
    get_db_session,
    key: str,
    report_params: Dict[str, Any],
    *,
    allow_stale: bool = False,
) -> Optional[Dict[str, Any]]:
    if not load_report_cache:
        return None
    session = get_db_session()
    try:
        payload = load_report_cache(
            session, key, _CACHE_TTL_SEC, allow_stale=allow_stale
        )
        if not payload:
            return None
        with _CACHE_LOCK:
            _CACHES[key] = {
                "payload": payload,
                "built_at": time.time(),
                "building": False,
                "params": report_params,
                "error": None,
            }
        logger.info("commercial footfall hydrated key=%s from DB", key)
        return payload
    except Exception as ex:
        logger.warning("commercial footfall DB hydrate failed key=%s: %s", key, ex)
        try:
            session.rollback()
        except Exception:
            pass
        return None
    finally:
        try:
            session.close()
        except Exception:
            pass


def _is_fresh(entry: Dict[str, Any], now: float) -> bool:
    return bool(entry.get("payload")) and (now - float(entry.get("built_at") or 0)) < _CACHE_TTL_SEC


def _is_building(key: str, entry: Dict[str, Any]) -> bool:
    if entry.get("building"):
        built_at = float(entry.get("building_started_at") or entry.get("built_at") or 0)
        if built_at and (time.time() - built_at) > 2400:
            entry["building"] = False
            return False
        return True
    with _BUILD_LOCK:
        return key in _ACTIVE_BUILDS


def _make_resolve_uidds(session):
    from alert_routes import _get_videoloft_cameras_cached, _load_alert_people_camera_map
    from commercial_footfall_resolve import load_commercial_name_camera_map, resolve_commercial_uidds

    cmap = _load_alert_people_camera_map()
    cams = _get_videoloft_cameras_cached()
    name_map = load_commercial_name_camera_map()

    def fn(machine_id: str, machine_name: str, days: Optional[list] = None):
        return resolve_commercial_uidds(
            session,
            str(machine_id),
            str(machine_name),
            cmap,
            cams,
            name_map,
            list(days or []),
        )

    return fn


def _run_report_build(
    app,
    get_db_session,
    get_vendon_machines_fn,
    fetch_vends_fn,
    key: str,
    report_params: Dict[str, Any],
) -> Dict[str, Any]:
    with app.app_context():
        session = get_db_session()
        try:
            machines = get_vendon_machines_fn()
            if not machines:
                raise RuntimeError("No Vendon machines available")
            resolve_uidds_fn = _make_resolve_uidds(session)
            from alert_routes import _get_videoloft_cameras_cached, _load_alert_people_camera_map

            cameras = _get_videoloft_cameras_cached()
            cmap = _load_alert_people_camera_map()
            return build_commercial_footfall_report(
                session,
                machines,
                resolve_uidds_fn,
                fetch_vends_fn,
                videoloft_cameras=cameras,
                primary_days=report_params["primary_days"],
                fallback_days=report_params["fallback_days"],
                compare_days=report_params["compare_days"] or None,
                alert_camera_map=cmap,
                allow_sales_proxy=bool(report_params.get("allow_sales_proxy", True)),
            )
        finally:
            try:
                session.close()
            except Exception:
                pass


def _schedule_build(
    app,
    get_db_session,
    get_vendon_machines_fn,
    fetch_vends_fn,
    key: str,
    report_params: Dict[str, Any],
) -> None:
    with _BUILD_LOCK:
        if key in _ACTIVE_BUILDS:
            return
        _ACTIVE_BUILDS.add(key)

    now = time.time()
    with _CACHE_LOCK:
        prev = _CACHES.get(key) or {}
        _CACHES[key] = {
            **prev,
            "building": True,
            "building_started_at": now,
            "error": None,
            "params": report_params,
        }

    def worker():
        try:
            payload = _run_report_build(
                app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, report_params
            )
            with _CACHE_LOCK:
                _CACHES[key] = {
                    "payload": payload,
                    "built_at": time.time(),
                    "building": False,
                    "params": report_params,
                    "error": None,
                }
            if save_report_cache:
                try:
                    sess = get_db_session()
                    save_report_cache(sess, key, report_params, payload)
                except Exception as ex:
                    logger.warning("commercial footfall DB save failed key=%s: %s", key, ex)
            logger.info("commercial footfall cache built key=%s locations=%s", key, payload.get("locationCount"))
        except Exception as ex:
            logger.exception("commercial footfall cache build failed key=%s", key)
            with _CACHE_LOCK:
                prev = _CACHES.get(key) or {}
                prev["building"] = False
                prev["error"] = str(ex)
                _CACHES[key] = prev
        finally:
            with _BUILD_LOCK:
                _ACTIVE_BUILDS.discard(key)

    threading.Thread(target=worker, daemon=True, name=f"cf-build-{key[:8]}").start()


def _wait_for_cache(key: str, timeout_sec: float) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        with _CACHE_LOCK:
            entry = _CACHES.get(key) or {}
        if entry.get("error") and not entry.get("building") and not _is_building(key, entry):
            return None, str(entry["error"])
        if entry.get("payload") and not _is_building(key, entry):
            return entry["payload"], None
        time.sleep(2)
    return None, "Report build timed out"


def _get_cached_report(
    app,
    get_db_session,
    get_vendon_machines_fn,
    fetch_vends_fn,
    report_params: Dict[str, Any],
    refresh: bool,
    *,
    purge: bool = False,
    wait_sec: float = 0,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], Dict[str, Any]]:
    """
    Returns (payload, error_message, cache_meta).
    Schedules background builds; optionally waits up to wait_sec on cold start.
    refresh=True schedules a rebuild but keeps serving the last payload (no DB wipe).
    """
    key = _cache_key(report_params)
    now = time.time()

    if purge:
        _purge_cache_key(get_db_session, key)

    with _CACHE_LOCK:
        entry = dict(_CACHES.get(key) or {})

    payload = entry.get("payload")
    if not payload:
        payload = _hydrate_memory_from_db(
            get_db_session, key, report_params, allow_stale=True
        )
        if payload:
            entry = dict(_CACHES.get(key) or {})

    fresh = _is_fresh(entry, now)
    payload = entry.get("payload") or payload
    if payload:
        before_v = int(payload.get("reportPayloadVersion") or 0)
        payload = finalize_commercial_report_payload(payload)
        if int(payload.get("reportPayloadVersion") or 0) > before_v:
            with _CACHE_LOCK:
                prev = dict(_CACHES.get(key) or {})
                if prev.get("payload"):
                    prev["payload"] = payload
                    _CACHES[key] = prev
    building = _is_building(key, entry)
    cache_meta: Dict[str, Any] = {"cacheKey": key, "fromCache": False, "building": building}

    if refresh and payload:
        _schedule_build(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, report_params)
        cache_meta.update({"stale": True, "refreshing": True, "building": True})
        return payload, None, cache_meta

    if not refresh and fresh and payload:
        cache_meta["fromCache"] = True
        cache_meta["ageSec"] = int(now - float(entry.get("built_at") or 0))
        return payload, None, cache_meta

    if building:
        if payload:
            cache_meta.update({"stale": True, "building": True})
            return payload, None, cache_meta
        if wait_sec > 0:
            waited, err = _wait_for_cache(key, wait_sec)
            if waited:
                waited = finalize_commercial_report_payload(waited)
                cache_meta["waitedSec"] = int(wait_sec)
                return waited, None, cache_meta
            if err:
                return None, err, cache_meta
        return None, "Report is building; retry in 15–30 seconds.", cache_meta

    if payload and not refresh:
        # Expired TTL but still useful while rebuilding
        _schedule_build(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, report_params)
        cache_meta.update({"stale": True, "refreshing": True})
        return payload, None, cache_meta

    # Cold miss — schedule build; optional short wait for first paint
    _schedule_build(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, report_params)
    if wait_sec > 0:
        waited, err = _wait_for_cache(key, wait_sec)
        if waited:
            waited = finalize_commercial_report_payload(waited)
            with _CACHE_LOCK:
                _CACHES[key] = {
                    "payload": waited,
                    "built_at": time.time(),
                    "building": False,
                    "params": report_params,
                    "error": None,
                }
            cache_meta["waitedSec"] = int(wait_sec)
            return waited, None, cache_meta
        if err:
            return None, err, cache_meta
    if payload:
        cache_meta.update({"stale": True, "refreshing": True})
        return payload, None, cache_meta
    return None, "Report is building; retry in 15–30 seconds.", cache_meta


def _warm_presets(
    app,
    get_db_session,
    get_vendon_machines_fn,
    fetch_vends_fn,
    *,
    full_historical: bool = False,
) -> Dict[str, Any]:
    """Pre-build presentation caches: fixed presets + weekly Sun–Thu from Jun 2025 → today."""
    from datetime import date

    from commercial_footfall_cache_store import warm_window_params, weekly_sun_thu_windows

    presets = [
        {
            "label": "primary_jun2025",
            "primary_days": list(PRIMARY_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": [],
        },
        {
            "label": "primary_jul06_2025",
            "primary_days": list(JUL_06_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": [],
        },
        {
            "label": "fallback_may2026",
            "primary_days": list(FALLBACK_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": [],
        },
        {
            "label": "primary_jun2025_compare",
            "primary_days": list(PRIMARY_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": list(_COMPARE_SAMPLE_DAYS),
        },
        {
            "label": "primary_jun15_2025",
            "primary_days": list(JUN_15_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": [],
        },
        {
            "label": "primary_jun15_2025_compare",
            "primary_days": list(JUN_15_BUSINESS_DAYS),
            "fallback_days": list(FALLBACK_BUSINESS_DAYS),
            "compare_days": list(PRIMARY_BUSINESS_DAYS),
        },
    ]
    historical = weekly_sun_thu_windows(date(2025, 6, 8), date.today())
    if not full_historical:
        warm_max = int(os.environ.get("COMMERCIAL_FOOTFALL_HISTORICAL_WARM_MAX", "16"))
        historical = historical[-warm_max:] if warm_max > 0 else []
    seen = {tuple(p["primary_days"]) for p in presets}
    for window in historical:
        key_days = tuple(window)
        if key_days in seen:
            continue
        seen.add(key_days)
        presets.append(
            {
                "label": f"week_{window[0]}",
                "primary_days": window,
                "fallback_days": list(FALLBACK_BUSINESS_DAYS),
                "compare_days": [],
            }
        )
    for p in presets:
        p.setdefault("allow_sales_proxy", True)
        p.setdefault("calendar_days", False)
    wait_labels = {
        "primary_jun2025",
        "primary_jul06_2025",
        "primary_jun15_2025",
        "fallback_may2026",
        "primary_jun2025_compare",
        "primary_jun15_2025_compare",
    }
    results = []
    for p in presets:
        key = _cache_key(p)
        _schedule_build(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, p)
        if p["label"] in wait_labels:
            payload, err = _wait_for_cache(key, 2100)
            results.append(
                {
                    "preset": p["label"],
                    "ok": payload is not None and not err,
                    "error": err,
                    "locationCount": (payload or {}).get("locationCount"),
                    "cacheKey": key,
                    "waited": True,
                }
            )
        else:
            results.append(
                {
                    "preset": p["label"],
                    "ok": True,
                    "error": None,
                    "locationCount": None,
                    "cacheKey": key,
                    "waited": False,
                    "scheduled": True,
                }
            )
    with _CACHE_LOCK:
        entries = len(_CACHES)
    return {"success": True, "cacheEntries": entries, "ttlSec": _CACHE_TTL_SEC, "presets": results}


def register_commercial_footfall_routes(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn):
    """Register routes on the Flask app."""

    @bp.route("/api/commercial-footfall/health", methods=["GET"])
    def health():
        with _CACHE_LOCK:
            building = sum(1 for e in _CACHES.values() if e.get("building"))
            return jsonify(
                {
                    "success": True,
                    "cacheEntries": len(_CACHES),
                    "building": building > 0 or len(_ACTIVE_BUILDS) > 0,
                    "activeBuilds": len(_ACTIVE_BUILDS),
                    "ttlSec": _CACHE_TTL_SEC,
                }
            )

    @bp.route("/api/commercial-footfall/cache-status", methods=["GET"])
    def cache_status():
        """Lightweight poll — does not block on report build."""
        try:
            params = _params_from_request()
            key = _cache_key(params)
            now = time.time()
            kick = request.args.get("schedule", "1").lower() not in ("0", "false", "no")
            refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
            purge = request.args.get("purge", "").lower() in ("1", "true", "yes")

            if purge:
                _purge_cache_key(get_db_session, key)

            with _CACHE_LOCK:
                entry = dict(_CACHES.get(key) or {})

            if not entry.get("payload"):
                _hydrate_memory_from_db(
                    get_db_session, key, params, allow_stale=True
                )
                with _CACHE_LOCK:
                    entry = dict(_CACHES.get(key) or {})

            fresh = _is_fresh(entry, now)
            building = _is_building(key, entry)
            has_payload = bool(entry.get("payload"))

            if kick and (refresh or (not has_payload and not building)):
                _schedule_build(app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, key, params)
                building = True

            return jsonify(
                {
                    "success": True,
                    "cacheKey": key,
                    "ready": has_payload and not building,
                    "building": building,
                    "hasPayload": has_payload,
                    "fresh": fresh,
                    "ageSec": int(now - float(entry["built_at"])) if entry.get("built_at") else None,
                    "error": entry.get("error"),
                }
            )
        except Exception as ex:
            logger.exception("commercial footfall cache-status failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    @bp.route("/api/commercial-footfall/internal/warm", methods=["POST"])
    def internal_warm():
        """Cluster cron: rebuild default report caches (long-running)."""
        secret = (os.environ.get("DASHBOARD_ACCESS_API_KEY") or "").strip()
        if secret:
            got = (request.headers.get("X-Dashboard-Access-Secret") or "").strip()
            if got != secret:
                return jsonify({"success": False, "error": "Unauthorized"}), 401
        try:
            full_historical = os.environ.get("COMMERCIAL_FOOTFALL_WARM_FULL", "").lower() in (
                "1",
                "true",
                "yes",
            ) or request.args.get("full", "").lower() in ("1", "true", "yes")
            out = _warm_presets(
                app,
                get_db_session,
                get_vendon_machines_fn,
                fetch_vends_fn,
                full_historical=full_historical,
            )
            out["fullHistorical"] = full_historical
            return jsonify(out)
        except Exception as ex:
            logger.exception("commercial footfall internal warm failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    def _report_response(params: Dict[str, Any], refresh: bool, wait_sec: float = 0):
        payload, err, cache_meta = _get_cached_report(
            app,
            get_db_session,
            get_vendon_machines_fn,
            fetch_vends_fn,
            params,
            refresh,
            wait_sec=wait_sec,
        )
        if payload:
            meta = _meta(payload, params)
            meta["cache"] = cache_meta
            return jsonify({"success": True, "report": payload, "meta": meta})
        # 200 while building — client polls cache-status; avoids 503 console spam
        return jsonify(
            {
                "success": True,
                "report": None,
                "building": True,
                "error": err or "Report is building",
                "meta": {"cache": cache_meta},
            }
        )

    @bp.route("/api/commercial-footfall/report", methods=["GET"])
    def get_report():
        try:
            refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
            wait_sec = min(float(request.args.get("wait", 0) or 0), 300.0)
            params = _params_from_request()
            machine_id = request.args.get("machine_id")
            if machine_id:
                payload, err, cache_meta = _get_cached_report(
                    app,
                    get_db_session,
                    get_vendon_machines_fn,
                    fetch_vends_fn,
                    params,
                    refresh,
                    wait_sec=wait_sec,
                )
                if not payload:
                    return jsonify(
                        {
                            "success": True,
                            "location": None,
                            "building": True,
                            "error": err or "Report is building",
                            "meta": {"cache": cache_meta},
                        }
                    )
                loc = next((l for l in payload["locations"] if l["machineId"] == str(machine_id)), None)
                if not loc:
                    return jsonify({"success": False, "error": "Location not found"}), 404
                meta = _meta(payload, params)
                meta["cache"] = cache_meta
                return jsonify({"success": True, "location": loc, "meta": meta})
            return _report_response(params, refresh, wait_sec)
        except Exception as ex:
            logger.exception("commercial footfall report failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    @bp.route("/api/commercial-footfall/period-sales", methods=["GET"])
    def period_sales():
        """Vendon cups/revenue summed for an inclusive date range (week-to-date, etc.)."""
        try:
            start_day = (request.args.get("start_date") or "").strip()
            end_day = (request.args.get("end_date") or "").strip()
            if not start_day or not end_day:
                return jsonify({"success": False, "error": "start_date and end_date required"}), 400
            raw_ids = (request.args.get("machine_ids") or "").strip()
            machine_ids = (
                {x.strip() for x in raw_ids.split(",") if x.strip()} if raw_ids else None
            )
            machines = get_vendon_machines_fn()
            by_machine = fetch_machines_period_sales(
                machines,
                start_day,
                end_day,
                fetch_vends_fn,
                machine_ids,
            )
            return jsonify(
                {
                    "success": True,
                    "startDate": start_day,
                    "endDate": end_day,
                    "byMachineId": by_machine,
                    "machineCount": len(by_machine),
                }
            )
        except Exception as ex:
            logger.exception("commercial footfall period-sales failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    @bp.route("/api/commercial-footfall/today-sales", methods=["GET"])
    def today_sales():
        """
        Fast per-machine Vendon cups for one day (targets achievement · today).
        Optional machine_ids=comma,separated limits the fetch to visible locations.
        """
        try:
            day = (request.args.get("date") or "").strip()
            if not day:
                day = datetime.now(ZoneInfo("Asia/Kuwait")).date().isoformat()
            raw_ids = (request.args.get("machine_ids") or "").strip()
            machine_ids = (
                {x.strip() for x in raw_ids.split(",") if x.strip()} if raw_ids else None
            )
            machines = get_vendon_machines_fn()
            by_machine = fetch_machines_day_sales(
                machines,
                day,
                fetch_vends_fn,
                machine_ids,
            )
            return jsonify(
                {
                    "success": True,
                    "date": day,
                    "byMachineId": by_machine,
                    "machineCount": len(by_machine),
                }
            )
        except Exception as ex:
            logger.exception("commercial footfall today-sales failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    @bp.route("/api/commercial-footfall/locations", methods=["GET"])
    def list_locations():
        try:
            refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
            params = _params_from_request()
            payload, err, cache_meta = _get_cached_report(
                app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, params, refresh
            )
            if not payload:
                return jsonify(
                    {
                        "success": True,
                        "locations": [],
                        "building": True,
                        "error": err or "Report is building",
                        "meta": {"cache": cache_meta},
                    }
                )
            items = [
                {
                    "machineId": l["machineId"],
                    "locationName": l["locationName"],
                    "locationOwner": l["locationOwner"],
                    "hasPeopleFootfall": l["hasPeopleFootfall"],
                    "mirrorDisplay": l.get("mirrorDisplay"),
                    "periodKey": l["periodKey"],
                    "totalFootfall": l["daily"]["totalFootfall"],
                    "totalRevenueKd": l["daily"]["totalRevenueKd"],
                    "conversionPct": l["daily"]["conversionPct"],
                    "footfallSource": (l.get("footfallDiagnostics") or {}).get("source"),
                    "summary": l["insights"].get("summary"),
                }
                for l in payload["locations"]
            ]
            meta = _meta(payload, params)
            meta["cache"] = cache_meta
            return jsonify({"success": True, "locations": items, "meta": meta})
        except Exception as ex:
            logger.exception("commercial footfall locations failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    @bp.route("/api/commercial-footfall/export.csv", methods=["GET"])
    def export_csv():
        try:
            refresh = request.args.get("refresh", "").lower() in ("1", "true", "yes")
            params = _params_from_request()
            payload, err, cache_meta = _get_cached_report(
                app, get_db_session, get_vendon_machines_fn, fetch_vends_fn, params, refresh
            )
            if not payload:
                return jsonify(
                    {
                        "success": False,
                        "error": err or "Report is building — retry shortly",
                        "building": True,
                        "meta": {"cache": cache_meta},
                    }
                ), 409
            machine_id = request.args.get("machine_id")
            lines = [
                "location,hour,footfall,people_in,people_out,net_traffic,cups,conversion_ratio,conversion_pct,revenue_kd,revenue_per_visitor_kd,uplift_cups,uplift_kd,period_footfall_total,period_cups_total,period_net_traffic"
            ]
            locs = payload["locations"]
            if machine_id:
                locs = [l for l in locs if l["machineId"] == str(machine_id)]
            for loc in locs:
                daily = loc.get("daily") or {}
                pf = daily.get("projectedFootfall") or daily.get("totalFootfall") or 0
                for h in loc["hours"]:
                    lines.append(
                        ",".join(
                            [
                                _csv(loc["locationName"]),
                                h["label"],
                                str(h["footfall"]),
                                str(h.get("peopleIn") or ""),
                                str(h.get("peopleOut") or ""),
                                str(h.get("netTraffic") if h.get("netTraffic") is not None else ""),
                                str(h["cups"]),
                                h["conversionRatio"],
                                str(h["conversionPct"]),
                                str(h["revenueKd"]),
                                str(h["revenuePerVisitorKd"]),
                                str(h["upliftCups"]),
                                str(h["upliftKd"]),
                                str(pf),
                                str(daily.get("totalCups") or 0),
                                str(daily.get("totalNet") if daily.get("totalNet") is not None else ""),
                            ]
                        )
                    )
            buf = io.BytesIO("\n".join(lines).encode("utf-8-sig"))
            buf.seek(0)
            return send_file(
                buf,
                mimetype="text/csv",
                as_attachment=True,
                download_name="commercial-footfall-hourly.csv",
            )
        except Exception as ex:
            logger.exception("commercial footfall csv export failed")
            return jsonify({"success": False, "error": str(ex)}), 500

    app.register_blueprint(bp)


def _meta(payload: Dict[str, Any], params: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "generatedAt": payload.get("generatedAt"),
        "benchmarkConversionPct": payload.get("benchmarkConversionPct"),
        "primaryPeriod": payload.get("primaryPeriod"),
        "fallbackPeriod": payload.get("fallbackPeriod"),
        "comparePeriod": payload.get("comparePeriod"),
        "currency": payload.get("currency"),
        "locationCount": payload.get("locationCount"),
        "query": params,
    }


def _csv(s: str) -> str:
    if "," in s or '"' in s:
        return '"' + s.replace('"', '""') + '"'
    return s
