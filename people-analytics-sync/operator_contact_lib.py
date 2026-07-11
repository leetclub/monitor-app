"""Resolve operator / owner contact channels for Alert."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

_VENDON_DETAIL_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_VENDON_DETAIL_TTL_SEC = 600


def _contact_maps() -> Tuple[Dict[str, Dict[str, str]], Dict[str, Dict[str, str]]]:
    """Email-keyed and normalized-name-keyed entries from OPERATOR_CONTACT_MAP_JSON."""
    raw = (os.environ.get("OPERATOR_CONTACT_MAP_JSON") or "").strip()
    by_email: Dict[str, Dict[str, str]] = {}
    by_name: Dict[str, Dict[str, str]] = {}
    if not raw:
        return by_email, by_name
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return by_email, by_name
        for k, v in parsed.items():
            key = str(k or "").strip()
            if not key:
                continue
            entry: Dict[str, str] = {}
            if isinstance(v, dict):
                entry = {str(pk): str(pv) for pk, pv in v.items() if pv}
            elif isinstance(v, str) and v.strip():
                entry = {"phone": v.strip()}
            if not entry:
                continue
            if "@" in key:
                by_email[key.lower()] = entry
            norm = _norm_name(key)
            if norm:
                by_name[norm] = entry
            for candidate in _operator_name_candidates(key):
                norm_c = _norm_name(candidate)
                if norm_c:
                    by_name.setdefault(norm_c, entry)
        return by_email, by_name
    except Exception:
        logger.exception("OPERATOR_CONTACT_MAP_JSON")
        return by_email, by_name


def _contact_map() -> Dict[str, Dict[str, str]]:
    return _contact_maps()[0]


def _digits_phone(s: str) -> str:
    return re.sub(r"\D+", "", s or "")


def _whatsapp_url(phone: str) -> Optional[str]:
    d = _digits_phone(phone)
    if not d:
        return None
    if d.startswith("965"):
        return f"https://wa.me/{d}"
    if len(d) == 8:
        return f"https://wa.me/965{d}"
    return f"https://wa.me/{d}"


def _is_placeholder_phone(raw: str) -> bool:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return True
    if len(set(digits)) == 1:
        return True
    # Vendon sometimes stores Kenyan placeholders instead of Kuwait numbers.
    if digits.startswith("254"):
        return True
    return False


def _vendon_phone(user: Dict[str, Any]) -> Optional[str]:
    for pk in ("phone", "mobile", "cell", "telephone", "phone_number"):
        pv = str(user.get(pk) or "").strip()
        if pv and not _is_placeholder_phone(pv):
            return pv
    return None


def _fetch_vendon_user_detail(user_id: str) -> Optional[Dict[str, Any]]:
    """Phone/mobile live on Vendon user detail, not the /user list."""
    uid = str(user_id or "").strip()
    if not uid:
        return None
    now = time.time()
    cached = _VENDON_DETAIL_CACHE.get(uid)
    if cached and now - cached[0] < _VENDON_DETAIL_TTL_SEC:
        return cached[1] or None
    result: Optional[Dict[str, Any]] = None
    try:
        from vendon_proxy_routes import _vendon_get

        data, err = _vendon_get(f"/user/{uid}", None)
        if not err and isinstance(data, dict):
            r = data.get("result")
            if isinstance(r, dict):
                result = r
    except Exception:
        logger.exception("_fetch_vendon_user_detail")
    _VENDON_DETAIL_CACHE[uid] = (now, result or {})
    return result


def _vendon_phone_for_user(list_user: Dict[str, Any]) -> Optional[str]:
    phone = _vendon_phone(list_user)
    if phone:
        return phone
    uid = str(list_user.get("id") or "").strip()
    if not uid:
        return None
    detail = _fetch_vendon_user_detail(uid)
    if detail:
        return _vendon_phone(detail)
    return None


_MACHINE_OPERATOR_CACHE: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
_MACHINE_OPERATOR_TTL_SEC = 600
_VENDON_MACHINE_INDEX: Dict[str, Dict[str, Any]] = {}
_VENDON_MACHINE_INDEX_TS = 0.0


def _build_vendon_machine_operator_index() -> Dict[str, Dict[str, Any]]:
    global _VENDON_MACHINE_INDEX, _VENDON_MACHINE_INDEX_TS
    now = time.time()
    if _VENDON_MACHINE_INDEX and now - _VENDON_MACHINE_INDEX_TS < _MACHINE_OPERATOR_TTL_SEC:
        return _VENDON_MACHINE_INDEX
    index: Dict[str, Dict[str, Any]] = {}
    try:
        from vendon_proxy_routes import _fetch_vendon_users_list

        for u in _fetch_vendon_users_list():
            if not isinstance(u, dict):
                continue
            utype = str(u.get("type") or u.get("type_title") or "").lower()
            if "operator" not in utype:
                continue
            uid = str(u.get("id") or "").strip()
            if not uid:
                continue
            detail = _fetch_vendon_user_detail(uid) or {}
            if detail.get("can_access_all_machines") is True:
                continue
            machines = detail.get("access_machines") or u.get("access_machines") or []
            if not isinstance(machines, list):
                continue
            merged = dict(u)
            merged.update({k: v for k, v in detail.items() if v is not None})
            for m in machines:
                mid = ""
                if isinstance(m, dict):
                    for key in ("id", "machine_id", "vendon_id"):
                        mid = str(m.get(key) or "").strip()
                        if mid:
                            break
                else:
                    mid = str(m).strip()
                if mid and mid not in index:
                    index[mid] = merged
    except Exception:
        logger.exception("_build_vendon_machine_operator_index")
    _VENDON_MACHINE_INDEX = index
    _VENDON_MACHINE_INDEX_TS = now
    return index


def resolve_vendon_user_for_machine(machine_id: str) -> Optional[Dict[str, Any]]:
    """Operator Vendon user assigned to this machine (access_machines on user detail)."""
    mid = str(machine_id or "").strip()
    if not mid:
        return None
    now = time.time()
    cached = _MACHINE_OPERATOR_CACHE.get(mid)
    if cached and now - cached[0] < _MACHINE_OPERATOR_TTL_SEC:
        return cached[1]
    result = _build_vendon_machine_operator_index().get(mid)
    _MACHINE_OPERATOR_CACHE[mid] = (now, result)
    return result


def _vendon_display_name(user: Dict[str, Any]) -> str:
    fn = str(user.get("first_name") or "").strip()
    ln = str(user.get("last_name") or "").strip()
    full = f"{fn} {ln}".strip()
    if full:
        return full
    for key in ("name", "username"):
        val = str(user.get(key) or "").strip()
        if val and "@" not in val:
            return val
    em = str(user.get("email") or "").strip()
    if em and "@" in em:
        local = em.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
        if local:
            return local.title()
    return ""


def resolve_vendon_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    em = (email or "").strip().lower()
    if not em or "@" not in em:
        return None
    try:
        from vendon_proxy_routes import _fetch_vendon_users_list

        for u in _fetch_vendon_users_list():
            if not isinstance(u, dict):
                continue
            uem = str(u.get("email") or "").strip().lower()
            if uem == em:
                return u
    except Exception:
        logger.exception("resolve_vendon_user_by_email")
    return None


def _norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _operator_name_candidates(operator_name: str) -> list[str]:
    """Dashboard labels often append site suffix: 'Ogemo Angela - Akumu'."""
    raw = (operator_name or "").strip()
    if not raw or raw == "—":
        return []
    out: list[str] = []
    seen: set[str] = set()

    def add(n: str) -> None:
        key = _norm_name(n)
        if key and key not in seen:
            seen.add(key)
            out.append(n.strip())

    add(raw)
    if " - " in raw:
        add(raw.split(" - ", 1)[0].strip())
    if " – " in raw:
        add(raw.split(" – ", 1)[0].strip())
    if "(" in raw:
        add(raw.split("(", 1)[0].strip())
    return out


def _name_match_score(target: str, fn: str, ln: str) -> int:
    t = _norm_name(target)
    if not t or t == "—":
        return 0
    full = _norm_name(f"{fn} {ln}")
    first = _norm_name(fn)
    last = _norm_name(ln)
    if full == t or first == t:
        return 100
    if last and last == t:
        return 85
    if t in full.split() and len(t) >= 3:
        return 75
    if full.startswith(t + " ") or full.endswith(" " + t):
        return 70
    t_parts = [p for p in t.split() if len(p) >= 2]
    full_parts = set(full.split())
    if t_parts and all(p in full_parts for p in t_parts):
        return 65
    if t in full and len(t) >= 4:
        return 60
    return 0


def resolve_vendon_user_for_operator_name(operator_name: str) -> Optional[Dict[str, Any]]:
    candidates = _operator_name_candidates(operator_name)
    if not candidates:
        return None
    try:
        from vendon_proxy_routes import _fetch_vendon_users_list

        users = _fetch_vendon_users_list()
        best: Optional[Dict[str, Any]] = None
        best_score = 0
        for candidate in candidates:
            for u in users:
                if not isinstance(u, dict):
                    continue
                fn = str(u.get("first_name") or "").strip()
                ln = str(u.get("last_name") or "").strip()
                score = _name_match_score(candidate, fn, ln)
                if score > best_score:
                    best_score = score
                    best = u
        if best_score >= 60:
            return best
        # Dashboard often shows "Joyce" while Vendon first_name is "Joy" — match email local-part.
        for candidate in candidates:
            t = _norm_name(candidate).replace(" ", "")
            if len(t) < 3:
                continue
            for u in users:
                if not isinstance(u, dict):
                    continue
                em = str(u.get("email") or "").strip().lower()
                if "@" not in em:
                    continue
                local = em.split("@", 1)[0]
                if local == t or local.startswith(t) or t.startswith(local):
                    return u
    except Exception:
        logger.exception("resolve_vendon_user_for_operator_name")
    return None


def resolve_vendon_email_for_operator_name(operator_name: str) -> Optional[str]:
    u = resolve_vendon_user_for_operator_name(operator_name)
    if not u:
        return None
    em = str(u.get("email") or "").strip()
    return em if em and "@" in em else None


def resolve_operator_contact(
    *,
    email: Optional[str] = None,
    operator_name: Optional[str] = None,
    machine_id: Optional[str] = None,
) -> Dict[str, Any]:
    em = (email or "").strip().lower()
    op_name = (operator_name or "").strip()
    mid = (machine_id or "").strip()
    vendon_by_machine: Optional[Dict[str, Any]] = None
    if mid:
        try:
            vendon_by_machine = resolve_vendon_user_for_machine(mid)
        except Exception:
            logger.exception("resolve_operator_contact vendon machine lookup")
    if vendon_by_machine:
        if not em:
            em = str(vendon_by_machine.get("email") or "").strip().lower()
        if not op_name or op_name == "—":
            vn = _vendon_display_name(vendon_by_machine)
            if vn:
                op_name = vn
    if mid and (not em or not op_name or op_name == "—"):
        try:
            from dashboard_access_models import LiveMachineConfig, get_dashboard_db

            db = get_dashboard_db()
            try:
                cfg = db.query(LiveMachineConfig).filter(LiveMachineConfig.machine_id == mid).first()
                if cfg:
                    if not em and cfg.strike_operator_email:
                        em = str(cfg.strike_operator_email).strip().lower()
                    if (not op_name or op_name == "—") and cfg.red_alert_operator_name:
                        op_name = str(cfg.red_alert_operator_name).strip()
            finally:
                db.close()
        except Exception:
            logger.exception("resolve_operator_contact machine_id lookup")
    if not em and op_name and op_name != "—":
        em = (resolve_vendon_email_for_operator_name(op_name) or "").lower()
    phone: Optional[str] = None
    whatsapp: Optional[str] = None
    phone_source: Optional[str] = None
    lookup_name = op_name if op_name and op_name != "—" else (operator_name or "").strip()
    by_email, by_name = _contact_maps()

    def _extra_for_name(name: str) -> Dict[str, str]:
        for candidate in _operator_name_candidates(name):
            hit = by_name.get(_norm_name(candidate))
            if hit:
                return hit
        return {}

    if em:
        extra = by_email.get(em) or {}
        phone = extra.get("phone") or extra.get("tel") or None
        whatsapp = extra.get("whatsapp") or phone
        if phone:
            phone_source = "contact_map"
        vendon_user = vendon_by_machine if vendon_by_machine and str(vendon_by_machine.get("email") or "").lower() == em else resolve_vendon_user_by_email(em)
        if not vendon_user and vendon_by_machine:
            vendon_user = vendon_by_machine
        if vendon_user:
            vendon_phone = _vendon_phone_for_user(vendon_user)
            if vendon_phone:
                phone = phone or vendon_phone
                whatsapp = whatsapp or vendon_phone
                phone_source = phone_source or "vendon"
    if not em and lookup_name and lookup_name != "—":
        vendon_user = vendon_by_machine or resolve_vendon_user_for_operator_name(lookup_name)
        if vendon_user:
            em = str(vendon_user.get("email") or "").strip().lower() or em
            vendon_phone = _vendon_phone_for_user(vendon_user)
            if vendon_phone:
                phone = phone or vendon_phone
                whatsapp = whatsapp or vendon_phone
                phone_source = phone_source or "vendon"
    if lookup_name and lookup_name != "—":
        extra_name = _extra_for_name(lookup_name)
        if extra_name.get("email") and not em:
            em = str(extra_name["email"]).strip().lower()
        if not phone:
            phone = extra_name.get("phone") or extra_name.get("tel") or None
            if phone:
                phone_source = phone_source or "contact_map"
        if not whatsapp:
            whatsapp = extra_name.get("whatsapp") or phone
    if not phone and vendon_by_machine:
        vendon_phone = _vendon_phone_for_user(vendon_by_machine)
        if vendon_phone:
            phone = vendon_phone
            whatsapp = whatsapp or vendon_phone
            phone_source = phone_source or "vendon_machine"
    from slack_user_map_lib import get_slack_user_map_payload

    slack_map = get_slack_user_map_payload().get("map") or {}
    team = get_slack_user_map_payload().get("teamId") or ""
    slack_uid = slack_map.get(em) if em else None
    slack_dm = ""
    slack_app = ""
    if team and slack_uid:
        slack_dm = f"slack://user?team={team}&id={slack_uid}"
        slack_app = f"https://slack.com/app_redirect?team={team}&user={slack_uid}"
    return {
        "email": em or None,
        "operatorName": lookup_name if lookup_name and lookup_name != "—" else ((operator_name or "").strip() or None),
        "machineId": (machine_id or "").strip() or None,
        "phone": phone,
        "whatsapp": whatsapp,
        "whatsappUrl": _whatsapp_url(whatsapp or phone or ""),
        "slackUserId": slack_uid,
        "slackTeamId": team or None,
        "slackDmUrl": slack_dm or None,
        "slackAppUrl": slack_app or None,
        "phoneSource": phone_source,
        "emailSource": (
            "vendon_machine"
            if vendon_by_machine and em
            else ("strike" if email else ("vendon" if em and not email else None))
        ),
        "resolvedFromVendonName": bool(not email and operator_name and em),
        "resolvedFromVendonMachine": bool(vendon_by_machine and mid),
    }
