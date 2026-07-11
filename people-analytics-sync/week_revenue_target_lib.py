"""Week revenue targets (targets-theleetclub-com sheet export)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ALIASES: Dict[str, str] = {
    "jaber gate 2": "Jaber Hospital - Gate 2",
    "jaber hospital gate 2": "Jaber Hospital - Gate 2",
    "jaber gate 6": "Jaber Hospital - Gate 6",
    "jaber hospital gate 6": "Jaber Hospital - Gate 6",
    "jahra hospital main gate": "Jahra Hospital - Main Gate",
    "jahra hospital parking": "Jahra Hospital - Parking",
    "jahra women center": "Jahra Women center",
    "ku engineering": "KU Enginnering",
    "ku engineering j": "KU Enginnering",
    "adan main gate": "Adan Main Gate",
    "adan maternity": "Adan maternity",
    "maternity hospital main": "Maternity Hospital Main",
    "moh main building": "MOH main",
    "farwaniya main gate": "Farwaniya Main gate",
    "amiri hospital new": "Amiri New",
    "amiri old 2": "Amiri old 2",
    "sultan hamra": "Sultan Hamra",
    "sultan hamra hospital": "Sultan Hamra",
}

_TARGETS: Optional[List[Dict[str, Any]]] = None
_BY_NORM: Optional[Dict[str, Dict[str, Any]]] = None


def _norm_key(s: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _load_targets() -> List[Dict[str, Any]]:
    global _TARGETS, _BY_NORM
    if _TARGETS is not None:
        return _TARGETS
    path = Path(__file__).resolve().parent / "data" / "week_revenue_targets.json"
    if not path.is_file():
        logger.warning("week_revenue_targets.json missing at %s", path)
        _TARGETS = []
        _BY_NORM = {}
        return _TARGETS
    try:
        _TARGETS = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("week_revenue_targets.json load")
        _TARGETS = []
    _BY_NORM = {}
    for row in _TARGETS:
        name = str(row.get("name") or "").strip()
        if name:
            _BY_NORM[_norm_key(name)] = row
    return _TARGETS


def week_revenue_target_kd(location_name: str) -> Optional[float]:
    _load_targets()
    key = _norm_key(location_name)
    alias = _ALIASES.get(key)
    if alias and _BY_NORM:
        hit = _BY_NORM.get(_norm_key(alias))
        if hit:
            return float(hit.get("weekTargetKd") or 0) or None
    if _BY_NORM and key in _BY_NORM:
        return float(_BY_NORM[key].get("weekTargetKd") or 0) or None
    best = None
    best_len = 0
    for nk, row in (_BY_NORM or {}).items():
        if key in nk or nk in key:
            ln = min(len(key), len(nk))
            if ln > best_len:
                best_len = ln
                best = row
    if best:
        return float(best.get("weekTargetKd") or 0) or None
    return None


def week_revenue_target_kd_rounded(location_name: str) -> Optional[float]:
    raw = week_revenue_target_kd(location_name)
    return round(raw) if raw is not None else None


def infer_owner_segment(machine_name: str, location_owner: Optional[str] = None) -> str:
    owner = (location_owner or "").strip().upper()
    n = (machine_name or "").lower()
    if owner == "KU" or " ku " in f" {n} " or "kuwait university" in n:
        return "KU"
    if owner == "MOH" or any(x in n for x in ("adan", "amiri", "farwaniya", "jaber", "jahra", "maternity", "razi", "zain", "moh")):
        return "MOH"
    if owner in ("O2", "OXYGEN") or "oxygen" in n or " o2 " in f" {n} ":
        return "O2"
    return "OTHER"


def target_business_days(segment: str) -> int:
    return 5 if segment == "KU" else 7


def daily_target_kd_from_week(machine_name: str, location_owner: Optional[str] = None) -> Optional[float]:
    week = week_revenue_target_kd_rounded(machine_name)
    if week is None:
        return None
    seg = infer_owner_segment(machine_name, location_owner)
    days = target_business_days(seg)
    return round(week / days) if days > 0 else None
