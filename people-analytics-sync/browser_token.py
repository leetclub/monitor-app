"""Verify HMAC browser tokens minted by GAS (dashboard-access-api.js getBrowserApiToken_)."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Set


def _b64url_decode(s: str) -> bytes:
    t = s.replace("-", "+").replace("_", "/")
    pad = (-len(t)) % 4
    if pad:
        t += "=" * pad
    return base64.b64decode(t.encode("ascii"))


def verify_browser_token(token: str, api_key: str, allowed_purposes: Optional[Set[str]] = None) -> Optional[Dict[str, Any]]:
    if not token or not api_key or "." not in token:
        return None
    parts = token.split(".", 1)
    if len(parts) != 2:
        return None
    b64_payload, sig_hex = parts[0], parts[1]
    try:
        raw = _b64url_decode(b64_payload)
        payload_json = raw.decode("utf-8")
    except (ValueError, UnicodeDecodeError, binascii.Error):
        return None
    try:
        want = hmac.new(api_key.encode("utf-8"), payload_json.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(want, sig_hex.lower()):
            return None
        payload = json.loads(payload_json)
    except (json.JSONDecodeError, TypeError):
        return None
    if allowed_purposes is not None:
        p = str(payload.get("purpose") or "").strip()
        if p not in allowed_purposes:
            return None
    now = int(time.time())
    exp = int(payload.get("exp") or 0)
    if exp and now > exp + 30:
        return None
    email = str(payload.get("email") or "").strip().lower()
    if not email:
        return None
    return {"email": email, "purpose": str(payload.get("purpose") or ""), "payload": payload}
