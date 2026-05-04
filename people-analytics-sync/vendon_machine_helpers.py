"""
Shared Vendon /machine row helpers for Alert + Red Alert routes.

Vendon payloads vary by tenant — we merge structured fields with ``tags`` (when present).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Legacy parity with monitoring-app-v2 ``EXCLUDED_NAME_MARKERS`` (substring on name or id).
EXCLUDED_MACHINE_MARKERS: tuple[str, ...] = ("869951037923178", "869951037920851")


def machine_row_excluded(name: object, machine_id: object) -> bool:
    blob = f"{name or ''} {machine_id or ''}"
    return any(m in blob for m in EXCLUDED_MACHINE_MARKERS)


def _tags_location_candidate(tags: Any) -> Optional[str]:
    """Pick a human-readable location/site string from Vendon ``tags`` when structured fields are empty."""
    if tags is None:
        return None
    if isinstance(tags, str) and tags.strip():
        return tags.strip()
    if not isinstance(tags, list):
        return None
    candidates: List[str] = []
    for t in tags:
        if isinstance(t, str) and t.strip():
            candidates.append(t.strip())
        elif isinstance(t, dict):
            label = str(t.get("name") or t.get("key") or t.get("type") or "").strip().lower()
            val = t.get("value") or t.get("label") or t.get("title")
            if isinstance(val, str) and val.strip():
                v = val.strip()
                if any(x in label for x in ("loc", "site", "branch", "area", "zone", "customer", "owner")):
                    return v
                candidates.append(v)
    if not candidates:
        return None
    candidates.sort(key=len, reverse=True)
    return candidates[0]


def vendon_machine_tag_explicit(m: Dict[str, Any]) -> Optional[str]:
    """Machine-level tag from Vendon (preferred over site/location names for Location owner)."""
    if not isinstance(m, dict):
        return None
    for key in ("machine_tag", "machineTag", "asset_tag", "assetTag", "unit_tag", "unitTag"):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    tags = m.get("tags")
    if isinstance(tags, list):
        for t in tags:
            if isinstance(t, dict):
                name = str(t.get("name") or t.get("key") or t.get("type") or "").lower()
                val = t.get("value") or t.get("label") or t.get("title")
                if not isinstance(val, str) or not val.strip():
                    continue
                if any(x in name for x in ("machine", "asset", "device", "unit", "vend", "imei")):
                    return val.strip()
    return None


def vendon_location_owner_tag(m: Dict[str, Any]) -> Optional[str]:
    """Best-effort location / site tag from a Vendon ``/machine`` row (schema varies by tenant)."""
    if not isinstance(m, dict):
        return None
    machine_tag = vendon_machine_tag_explicit(m)
    if machine_tag:
        return machine_tag
    loc = m.get("location")
    if isinstance(loc, str) and loc.strip():
        return loc.strip()
    if isinstance(loc, dict):
        for key in ("name", "title", "label", "location_name"):
            v = loc.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    for key in ("location_name", "site_name", "customer_name", "branch_name"):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    site = m.get("site")
    if isinstance(site, dict):
        for key in ("name", "title", "label"):
            v = site.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    customer = m.get("customer")
    if isinstance(customer, dict):
        for key in ("name", "title", "label"):
            v = customer.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    grp = m.get("group")
    if isinstance(grp, dict):
        v = grp.get("name") or grp.get("title")
        if isinstance(v, str) and v.strip():
            return v.strip()
    tag = _tags_location_candidate(m.get("tags"))
    if tag:
        return tag
    # Some integrations stash labels on the machine record.
    for key in ("tag", "tags_display", "location_tag"):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def machine_location_for_red_alert(m: Dict[str, Any]) -> str:
    """String location for Red Alert rows (never None — empty if unknown)."""
    t = vendon_location_owner_tag(m)
    if t:
        return t
    raw = (
        m.get("location_name")
        or m.get("location")
        or m.get("site")
        or m.get("address")
        or ""
    )
    if isinstance(raw, dict):
        for key in ("name", "title", "label"):
            v = raw.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""
    if isinstance(raw, str):
        return raw.strip()
    return ""
