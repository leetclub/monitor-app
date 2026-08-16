"""
Postgres persistence for commercial footfall report payloads.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _parse_day(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def save_report_cache(session: Session, cache_key: str, params: Dict[str, Any], payload: Dict[str, Any]) -> None:
    primary = params.get("primary_days") or []
    fallback = params.get("fallback_days") or []
    compare = params.get("compare_days") or []
    if not primary:
        return
    row = {
        "cache_key": cache_key,
        "primary_start": primary[0],
        "primary_end": primary[-1],
        "fallback_start": fallback[0] if fallback else None,
        "fallback_end": fallback[-1] if fallback else None,
        "compare_start": compare[0] if compare else None,
        "compare_end": compare[-1] if compare else None,
        "location_count": int(payload.get("locationCount") or 0),
        "payload_json": json.dumps(payload),
    }
    session.execute(
        text(
            """
            INSERT INTO commercial_footfall_report_cache (
              cache_key, primary_start, primary_end,
              fallback_start, fallback_end, compare_start, compare_end,
              location_count, payload_json, built_at
            ) VALUES (
              :cache_key, :primary_start, :primary_end,
              :fallback_start, :fallback_end, :compare_start, :compare_end,
              :location_count, CAST(:payload_json AS jsonb), NOW()
            )
            ON CONFLICT (cache_key) DO UPDATE SET
              location_count = EXCLUDED.location_count,
              payload_json = EXCLUDED.payload_json,
              built_at = NOW()
            """
        ),
        row,
    )
    session.commit()


def delete_report_cache(session: Session, cache_key: str) -> None:
    session.execute(
        text("DELETE FROM commercial_footfall_report_cache WHERE cache_key = :cache_key"),
        {"cache_key": cache_key},
    )
    session.commit()


def load_report_cache(
    session: Session, cache_key: str, max_age_sec: int, allow_stale: bool = False
) -> Optional[Tuple[Dict[str, Any], float]]:
    age_clause = (
        "TRUE" if allow_stale else "built_at >= NOW() - (:max_age_sec || ' seconds')::interval"
    )
    row = session.execute(
        text(
            """
            SELECT payload_json, built_at
            FROM commercial_footfall_report_cache
            WHERE cache_key = :cache_key
              AND {age_clause}
            """.format(age_clause=age_clause)
        ),
        {"cache_key": cache_key, "max_age_sec": int(max_age_sec)},
    ).fetchone()
    if not row:
        return None
    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    else:
        payload = dict(payload)
    built_at = row[1]
    if isinstance(built_at, datetime):
        built_ts = built_at.timestamp()
    else:
        built_ts = time.time()
    return payload, float(built_ts)


def weekly_sun_thu_windows(
    anchor_start: date,
    anchor_end: date,
    window_len: int = 5,
) -> List[List[str]]:
    """5-day Sun–Thu windows stepping weekly from anchor_start through anchor_end."""
    out: List[List[str]] = []
    cur = anchor_start
    while cur <= anchor_end:
        window = [(cur + timedelta(days=i)).isoformat() for i in range(window_len)]
        if (cur + timedelta(days=window_len - 1)) <= anchor_end:
            out.append(window)
        cur += timedelta(days=7)
    return out


def warm_window_params(
    primary_days: List[str],
    fallback_days: List[str],
    compare_days: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "primary_days": list(primary_days),
        "fallback_days": list(fallback_days),
        "compare_days": list(compare_days or []),
    }
