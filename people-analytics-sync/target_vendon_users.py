"""
Vendon user display names for target site (Areas / Owners).
Prefer first_name + last_name; never use email as the visible name when avoidable.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_VENDON_USERS_TTL_SEC = 300
_vendon_users_cache: Dict[str, Any] = {"at": 0.0, "rows": []}


def _looks_like_email(value: str) -> bool:
    s = (value or "").strip()
    return "@" in s and "." in s.split("@")[-1]


def _name_from_email_local(email: str) -> str:
    local = (email or "").split("@", 1)[0].strip()
    if not local:
        return ""
    return local.replace(".", " ").replace("_", " ").strip().title()


def vendon_display_name_from_raw(user: Dict[str, Any]) -> str:
    if not isinstance(user, dict):
        return ""
    fn = str(user.get("first_name") or "").strip()
    ln = str(user.get("last_name") or "").strip()
    full = f"{fn} {ln}".strip()
    if full:
        return full
    for key in ("name", "username"):
        val = str(user.get(key) or "").strip()
        if val and not _looks_like_email(val):
            return val
    uid = str(user.get("id") or "").strip()
    email = str(user.get("email") or "").strip()
    if email and _looks_like_email(email):
        from_local = _name_from_email_local(email)
        if from_local:
            return from_local
    raw = str(user.get("name") or user.get("username") or "").strip()
    if raw and not _looks_like_email(raw):
        return raw
    return uid or raw or ""


def fetch_vendon_users_for_target() -> List[Dict[str, Any]]:
    now = time.time()
    if _vendon_users_cache["rows"] and now - float(_vendon_users_cache["at"]) < _VENDON_USERS_TTL_SEC:
        return list(_vendon_users_cache["rows"])
    try:
        from vendon_proxy_routes import _fetch_vendon_users_list

        rows = _fetch_vendon_users_list()
        out: List[Dict[str, Any]] = []
        for u in rows:
            if not isinstance(u, dict):
                continue
            uid = str(u.get("id") or "").strip()
            if not uid:
                continue
            out.append(
                {
                    "id": uid,
                    "name": vendon_display_name_from_raw(u),
                    "type": str(u.get("type") or u.get("type_title") or "").strip(),
                    "email": str(u.get("email") or "").strip() or None,
                }
            )
        out.sort(key=lambda x: (x.get("name") or "").lower())
        _vendon_users_cache["at"] = now
        _vendon_users_cache["rows"] = out
        return out
    except Exception as ex:
        logger.warning("vendon users list failed: %s", ex)
        if _vendon_users_cache["rows"]:
            return list(_vendon_users_cache["rows"])
        return []


def resolve_vendon_display_name(user_id: str, stored_name: str = "") -> str:
    """Best display name for an area owner — refresh from Vendon when stored value is an email."""
    stored = (stored_name or "").strip()
    if stored and not _looks_like_email(stored):
        return stored
    uid = str(user_id or "").strip()
    if uid:
        for vu in fetch_vendon_users_for_target():
            if str(vu.get("id") or "").strip() == uid:
                name = str(vu.get("name") or "").strip()
                if name and not _looks_like_email(name):
                    return name
    if stored:
        if _looks_like_email(stored):
            from_local = _name_from_email_local(stored)
            if from_local:
                return from_local
        return stored
    return "Area owner"


def vendon_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    for vu in fetch_vendon_users_for_target():
        if str(vu.get("id") or "").strip() == uid:
            return vu
    return None
