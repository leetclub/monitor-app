"""
Shared Vendon /machine row helpers for Alert + Red Alert routes.

Vendon payloads vary by tenant — we merge structured fields with ``tags`` (when present).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# Legacy parity with monitoring-app-v2 ``EXCLUDED_NAME_MARKERS`` (substring on name or id).
EXCLUDED_MACHINE_MARKERS: tuple[str, ...] = ("869951037923178", "869951037920851")

def _looks_like_machine_owner_tag(s: str) -> bool:
    """
    Heuristic for operator-facing machine tags like: O2, MOH, KU, KDD, etc.
    Avoids long site names/addresses.
    """
    x = (s or "").strip()
    if not x:
        return False
    if len(x) > 10:
        return False
    # mostly uppercase letters/digits, allow '_' '-' and spaces
    good = sum(1 for c in x if (c.isupper() or c.isdigit()))
    bad = sum(1 for c in x if (c.islower()))
    if bad > 0:
        return False
    return good >= max(2, len(x.replace(" ", "")) // 2)


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
    for key in (
        "machine_tag",
        "machineTag",
        "asset_tag",
        "assetTag",
        "unit_tag",
        "unitTag",
        # Common vendor integrations:
        "tag",
        "tags_display",
        "location_tag",
        "machineTagId",
    ):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            vs = v.strip()
            # Numeric IDs are not operator-facing tags (e.g. MOH / O2).
            if key == "machineTagId" and vs.isdigit():
                continue
            return vs
    tags = m.get("tags")
    if isinstance(tags, dict):
        # Some tenants return tags as a map id -> label or key -> value.
        for _k, t in tags.items():
            if isinstance(t, str) and t.strip() and _looks_like_machine_owner_tag(t.strip()):
                return t.strip()
            if isinstance(t, dict):
                name = str(t.get("name") or t.get("key") or t.get("type") or "").lower()
                val = t.get("value") or t.get("label") or t.get("title")
                if isinstance(val, str) and val.strip():
                    vs = val.strip()
                    if _looks_like_machine_owner_tag(vs):
                        return vs
                    if any(x in name for x in ("machine", "asset", "device", "unit", "vend", "imei")):
                        return vs
    if isinstance(tags, list):
        for t in tags:
            if isinstance(t, str) and t.strip():
                # Some tenants store the machine tag as a plain string in the tag list.
                if _looks_like_machine_owner_tag(t.strip()):
                    return t.strip()
            if isinstance(t, dict):
                name = str(t.get("name") or t.get("key") or t.get("type") or "").lower()
                val = t.get("value") or t.get("label") or t.get("title")
                if not isinstance(val, str) or not val.strip():
                    continue
                if _looks_like_machine_owner_tag(val.strip()):
                    return val.strip()
                if any(x in name for x in ("machine", "asset", "device", "unit", "vend", "imei")):
                    return val.strip()
    return None


def _short_fleet_or_operator_label(s: str) -> Optional[str]:
    """Short labels used as fleet / operator grouping (e.g. O2, MOH), not full addresses."""
    x = (s or "").strip()
    if not x or len(x) > 48:
        return None
    if _looks_like_machine_owner_tag(x):
        return x
    # All-caps short tokens often denote operator groups on Vendon.
    compact = x.replace(" ", "")
    if 2 <= len(compact) <= 16 and compact.isalnum() and x.upper() == x and not any(c.islower() for c in x):
        return x
    return None


def _label_from_group_like(obj: Any) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    for key in ("name", "title", "label", "tag", "code", "short_name"):
        v = obj.get(key)
        if isinstance(v, str):
            t = _short_fleet_or_operator_label(v)
            if t:
                return t
    return None


def vendon_fleet_group_tag(m: Dict[str, Any]) -> Optional[str]:
    """
    Operator/fleet tag often carried on ``group`` / ``groups`` / ``labels`` (e.g. all O2 machines share group \"O2\").
    Must run before generic ``tags`` location heuristics so we do not pick a site name instead.
    """
    if not isinstance(m, dict):
        return None
    for key in ("group", "machine_group", "fleet", "brand", "operator_group"):
        t = _label_from_group_like(m.get(key))
        if t:
            return t
    for key in ("groups", "machine_groups", "labels", "categories", "clusters"):
        val = m.get(key)
        if isinstance(val, list):
            for item in val:
                t = _label_from_group_like(item)
                if t:
                    return t
    return None


_TAG_NAME_LOCATION_HINT = ("loc", "site", "branch", "area", "zone", "customer", "address", "city", "country")
_TAG_NAME_MACHINE_HINT = (
    "machine",
    "asset",
    "device",
    "unit",
    "vend",
    "imei",
    "group",
    "fleet",
    "brand",
    "category",
    "cluster",
    "operator",
    "machine_tag",
    "asset_tag",
)


def _tags_scan_for_machine_owner(tags: Any) -> Optional[str]:
    """Pick machine/fleet-like tag values; skip tag rows that are clearly location/site metadata."""
    if tags is None:
        return None
    prioritized: List[str] = []
    fallback_short: List[str] = []

    def consider(val: str, label: str) -> None:
        vs = val.strip()
        if not vs:
            return
        low = label.lower()
        if any(h in low for h in _TAG_NAME_LOCATION_HINT):
            return
        if any(h in low for h in _TAG_NAME_MACHINE_HINT):
            prioritized.append(vs)
            return
        if _looks_like_machine_owner_tag(vs):
            fallback_short.append(vs)

    if isinstance(tags, dict):
        for k, t in tags.items():
            label = str(k)
            if isinstance(t, str):
                consider(t, label)
            elif isinstance(t, dict):
                nm = str(t.get("name") or t.get("key") or t.get("type") or label)
                v = t.get("value") or t.get("label") or t.get("title")
                if isinstance(v, str):
                    consider(v, nm)
    elif isinstance(tags, list):
        for t in tags:
            if isinstance(t, str):
                consider(t, "")
            elif isinstance(t, dict):
                nm = str(t.get("name") or t.get("key") or t.get("type") or "")
                v = t.get("value") or t.get("label") or t.get("title")
                if isinstance(v, str):
                    consider(v, nm)

    if prioritized:
        return prioritized[0]
    if fallback_short:
        return min(fallback_short, key=len)
    return None


def _tag_from_machine_name_owner_hint(name: Any) -> Optional[str]:
    """Last resort: leading fleet code in naming conventions like ``[O2] Site …`` or ``O2 - Snack``."""
    if not isinstance(name, str):
        return None
    s = name.strip()
    if not s:
        return None
    m = re.match(r"^\s*\[([A-Za-z0-9]{1,10})\]\s*", s)
    if m:
        cand = m.group(1).strip()
        if _looks_like_machine_owner_tag(cand):
            return cand
        if 2 <= len(cand) <= 10 and cand.isalnum():
            return cand.upper()
    m = re.match(r"^\s*([A-Z0-9]{2,10})\s*[-–—:|]\s*", s)
    if m:
        cand = m.group(1).strip()
        if _looks_like_machine_owner_tag(cand):
            return cand
    return None


def vendon_machine_tag_for_alert_admin(m: Dict[str, Any]) -> Optional[str]:
    """
    Machine/fleet tag for Alert Admin \"Location owner\" — never falls back to customer/site address strings.
    Order: explicit fields → Vendon group/fleet → machine-oriented tag rows → name prefix heuristic.
    """
    if not isinstance(m, dict):
        return None
    t = vendon_machine_tag_explicit(m)
    if t:
        return t
    t = vendon_fleet_group_tag(m)
    if t:
        return t
    t = _tags_scan_for_machine_owner(m.get("tags"))
    if t:
        return t
    return _tag_from_machine_name_owner_hint(m.get("name"))


def vendon_location_owner_tag(m: Dict[str, Any]) -> Optional[str]:
    """Best-effort location / site tag from a Vendon ``/machine`` row (schema varies by tenant)."""
    if not isinstance(m, dict):
        return None
    machine_tag = vendon_machine_tag_explicit(m)
    if machine_tag:
        return machine_tag
    grp_tag = vendon_fleet_group_tag(m)
    if grp_tag:
        return grp_tag
    # Prefer structured tags (and tag-shaped fields) before the generic top-level ``location`` string,
    # which is often a coarse site name rather than the machine / asset tag operators expect.
    tag = _tags_location_candidate(m.get("tags"))
    if tag:
        return tag
    for key in ("tag", "tags_display", "location_tag"):
        v = m.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
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
