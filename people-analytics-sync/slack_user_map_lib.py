"""Email → Slack user id (cached users.list)."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

_SLACK_BOT_TOKEN = (os.environ.get("SLACK_BOT_TOKEN") or os.environ.get("SLACK_USER_TOKEN") or "").strip()
_SLACK_TEAM_ID = (os.environ.get("SLACK_TEAM_ID") or os.environ.get("SLACK_WORKSPACE_ID") or "").strip()
_CACHE: Dict[str, Tuple[float, Dict[str, str]]] = {}
_CACHE_SEC = int(os.environ.get("SLACK_USER_MAP_CACHE_SEC", "3600"))


def _load_email_map(force: bool = False) -> Dict[str, str]:
    key = "map"
    if not force:
        hit = _CACHE.get(key)
        if hit and (time.time() - hit[0]) < _CACHE_SEC:
            return hit[1]
    out: Dict[str, str] = {}
    if not _SLACK_BOT_TOKEN:
        _CACHE[key] = (time.time(), out)
        return out
    cursor: Optional[str] = None
    try:
        for _ in range(20):
            payload: Dict[str, Any] = {"limit": 200}
            if cursor:
                payload["cursor"] = cursor
            res = requests.post(
                "https://slack.com/api/users.list",
                headers={"Authorization": f"Bearer {_SLACK_BOT_TOKEN}"},
                data=payload,
                timeout=30,
            )
            data = res.json() if res.ok else {}
            if not data.get("ok"):
                logger.warning("slack users.list: %s", data.get("error"))
                break
            for m in data.get("members") or []:
                if not isinstance(m, dict) or m.get("deleted") or m.get("is_bot"):
                    continue
                uid = str(m.get("id") or "").strip()
                prof = m.get("profile") if isinstance(m.get("profile"), dict) else {}
                email = str(prof.get("email") or "").strip().lower()
                if uid.startswith("U") and email:
                    out[email] = uid
            cursor = (data.get("response_metadata") or {}).get("next_cursor") or ""
            if not cursor:
                break
    except Exception:
        logger.exception("slack_user_map_lib users.list")
    _CACHE[key] = (time.time(), out)
    return out


def get_slack_user_map_payload(force: bool = False) -> Dict[str, Any]:
    env_map_raw = (os.environ.get("SLACK_OP_EMAIL_MAP_JSON") or "").strip()
    env_map: Dict[str, str] = {}
    if env_map_raw:
        try:
            import json

            parsed = json.loads(env_map_raw)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    em = str(k or "").strip().lower()
                    uid = str(v or "").strip()
                    if em and uid.startswith("U"):
                        env_map[em] = uid
        except Exception:
            logger.exception("SLACK_OP_EMAIL_MAP_JSON parse")
    api_map = _load_email_map(force=force)
    merged = {**api_map, **env_map}
    return {"teamId": _SLACK_TEAM_ID or None, "map": merged, "count": len(merged)}


def slack_user_id_for_email(email: str) -> Optional[str]:
    em = (email or "").strip().lower()
    if not em:
        return None
    m = get_slack_user_map_payload().get("map") or {}
    uid = m.get(em)
    return uid if uid else None
