"""QA Findings from Slack issues-actions list (port of operations-tab.js fetchQaFindingsFromSlack)."""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

_LIST_ID = (os.environ.get("SLACK_ISSUES_ACTIONS_LIST_ID") or "").strip()
_TOKEN = (os.environ.get("SLACK_BOT_TOKEN") or os.environ.get("SLACK_USER_TOKEN") or "").strip()
_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_SEC = int(os.environ.get("QA_FINDINGS_CACHE_SEC", "600"))


def _field_text(field: Any) -> str:
    if not isinstance(field, dict):
        return ""
    for key in ("text", "value", "plain_text"):
        v = field.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            t = v.get("text") or v.get("plain_text")
            if isinstance(t, str) and t.strip():
                return t.strip()
    sel = field.get("selected_options") or field.get("selected")
    if isinstance(sel, list) and sel:
        parts = []
        for o in sel:
            if isinstance(o, dict):
                parts.append(str(o.get("text") or o.get("label") or o.get("value") or "").strip())
        return ", ".join(p for p in parts if p)
    return ""


def _fetch_list_items() -> List[Dict[str, Any]]:
    if not _LIST_ID or not _TOKEN:
        return []
    try:
        res = requests.post(
            "https://slack.com/api/slackLists.items.list",
            headers={"Authorization": f"Bearer {_TOKEN}"},
            data={"list_id": _LIST_ID},
            timeout=45,
        )
        data = res.json() if res.ok else {}
        if not data.get("ok"):
            logger.warning("slackLists.items.list: %s", data.get("error"))
            return []
        items = data.get("items") or []
        return [x for x in items if isinstance(x, dict)]
    except Exception:
        logger.exception("qa_findings slack list")
        return []


def _normalize_finding(row: Dict[str, Any]) -> Optional[Dict[str, str]]:
    fields = row.get("fields")
    vals: List[str] = []
    if isinstance(fields, list):
        for f in fields:
            vals.append(_field_text(f))
    elif isinstance(fields, dict):
        for f in fields.values():
            vals.append(_field_text(f))
    # Fixed order fallback: VM, Request, Status, To, From, Assigned by, Needed by, Response, Manager Check
    def at(i: int) -> str:
        return vals[i].strip() if i < len(vals) else ""

    location = at(0)
    qa_finding = at(1) or str(row.get("title") or row.get("text") or "").strip()
    resolved = at(2)
    operator = at(3)
    response = at(7) if len(vals) > 7 else at(6)
    am_verified = at(8) if len(vals) > 8 else ""
    if not location and not qa_finding:
        return None
    return {
        "location": location,
        "qaFinding": qa_finding,
        "resolved": resolved,
        "amVerified": am_verified,
        "operator": operator,
        "response": response,
    }


def qa_findings_payload() -> Dict[str, Any]:
    cache_key = "findings"
    hit = _CACHE.get(cache_key)
    if hit and (time.time() - hit[0]) < _CACHE_SEC:
        return hit[1]
    if not _LIST_ID:
        payload = {
            "findings": [],
            "total": 0,
            "error": "list_id_not_configured",
            "source": "slack",
        }
        return payload
    if not _TOKEN:
        payload = {"findings": [], "total": 0, "error": "slack_token_missing", "source": "slack"}
        return payload
    raw_items = _fetch_list_items()
    findings: List[Dict[str, str]] = []
    for row in raw_items:
        if row.get("archived"):
            continue
        if row.get("parent_record_id"):
            continue
        norm = _normalize_finding(row)
        if norm:
            findings.append(norm)
    payload = {"findings": findings, "total": len(findings), "source": "slack"}
    _CACHE[cache_key] = (time.time(), payload)
    return payload
