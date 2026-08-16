"""
Resolve Videoloft camera uidds for a Vendon machine (ID map + name map + fuzzy + DB footfall).
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from alert_routes import (
    _fuzzy_machine_name_uidds,
    _resolve_machine_people_uidds,
    _uidds_from_mapping_entry,
)
from models import PeopleAnalyticsRecord

TZ = ZoneInfo("Asia/Kuwait")


def _norm_name(s: str) -> str:
    raw = " ".join("".join(c.lower() if c.isalnum() else " " for c in (s or "")).split())
    return raw.replace("enginnering", "engineering")


def load_commercial_name_camera_map() -> Dict[str, List[str]]:
    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "config",
        "commercial_people_camera_names.json",
    )
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            return {}
        out: Dict[str, List[str]] = {}
        for k, v in raw.items():
            if str(k).startswith("_"):
                continue
            if isinstance(v, list):
                out[_norm_name(k)] = [str(x) for x in v if x]
        return out
    except Exception:
        return {}


def _day_bounds_utc(day_iso: str) -> Tuple[datetime, datetime]:
    start_local = datetime.strptime(day_iso, "%Y-%m-%d").replace(tzinfo=TZ)
    end_local = start_local.replace(hour=23, minute=59, second=59, microsecond=0)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _name_fragments(machine_name: str, name_camera_map: Dict[str, List[str]], cmap: Dict[str, Any], machine_id: str) -> List[str]:
    frags: List[str] = []
    raw = cmap.get(str(machine_id))
    if isinstance(raw, dict):
        for n in raw.get("cameraNames") or []:
            if n:
                frags.append(str(n))
        cid = raw.get("cameraId")
        if cid:
            frags.append(str(cid))
    mn = _norm_name(machine_name)
    if name_camera_map.get(mn):
        frags.extend(name_camera_map[mn])
    else:
        for key, names in name_camera_map.items():
            if key in mn or mn in key:
                frags.extend(names)
                break
    if machine_name.strip():
        frags.append(machine_name.strip())
    # dedupe preserve order
    seen = set()
    out: List[str] = []
    for f in frags:
        k = f.lower()
        if k not in seen:
            seen.add(k)
            out.append(f)
    return out


def _resolve_uidds_from_db_footfall(
    session: Session, frags: List[str], days: List[str]
) -> Tuple[List[str], str]:
    """Match cameras by footfall in period when Videoloft device list is empty."""
    if not frags or not days:
        return [], "none"
    start_utc, _ = _day_bounds_utc(days[0])
    _, end_utc = _day_bounds_utc(days[-1])
    best_uidds: List[str] = []
    best_total = 0.0
    for frag in frags:
        fl = frag.lower().strip()
        if len(fl) < 4:
            continue
        q = (
            session.query(
                PeopleAnalyticsRecord.uidd,
                func.sum(PeopleAnalyticsRecord.people_in).label("total_in"),
            )
            .filter(PeopleAnalyticsRecord.first_timestamp >= start_utc)
            .filter(PeopleAnalyticsRecord.first_timestamp <= end_utc)
            .filter(
                or_(
                    func.lower(PeopleAnalyticsRecord.uidd).contains(fl.replace(" ", "")),
                    func.lower(PeopleAnalyticsRecord.raw_data).contains(fl),
                    func.lower(PeopleAnalyticsRecord.device_id).contains(fl),
                )
            )
            .group_by(PeopleAnalyticsRecord.uidd)
        )
        for uidd, total_in in q.all():
            ti = float(total_in or 0)
            if ti > best_total:
                best_total = ti
                best_uidds = [str(uidd)]
            elif ti == best_total and ti > 0 and str(uidd) not in best_uidds:
                best_uidds.append(str(uidd))
    if best_uidds:
        return best_uidds, "db_footfall_match"

    # Period may be empty in DB (e.g. Jun 2025); still resolve camera uidd from any historical row.
    for frag in frags:
        fl = frag.lower().strip()
        if len(fl) < 4:
            continue
        rows = (
            session.query(PeopleAnalyticsRecord.uidd)
            .filter(
                or_(
                    func.lower(PeopleAnalyticsRecord.raw_data).contains(fl),
                    func.lower(PeopleAnalyticsRecord.device_id).contains(fl),
                )
            )
            .distinct()
            .limit(5)
            .all()
        )
        uids = [str(r[0]) for r in rows if r and r[0]]
        if uids:
            return uids, "db_camera_name_match"
    return [], "none"


def resolve_commercial_uidds(
    session: Session,
    machine_id: str,
    machine_name: str,
    cmap: Dict[str, Any],
    cameras: List[Dict[str, Any]],
    name_camera_map: Dict[str, List[str]],
    days: List[str],
) -> Tuple[List[str], str]:
    uids, src = _resolve_machine_people_uidds(str(machine_id), str(machine_name), cmap, cameras)
    if uids:
        return uids, src

    frags = _name_fragments(machine_name, name_camera_map, cmap, machine_id)
    if frags:
        uids = _uidds_from_mapping_entry(cameras, {"cameraNames": frags})
        if uids:
            return uids, "commercial_name_map"

    uids_f = _fuzzy_machine_name_uidds(str(machine_name), cameras)
    if uids_f:
        return uids_f, "fuzzy"

    uids_db, src_db = _resolve_uidds_from_db_footfall(session, frags, days)
    if uids_db:
        return uids_db, src_db
    return [], "none"
