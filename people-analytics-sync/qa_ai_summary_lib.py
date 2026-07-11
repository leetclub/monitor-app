"""AI bullet summaries for SafetyCulture QA inspection reports."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

_OPENAI_API_KEY = (os.environ.get("OPENAI_API_KEY") or "").strip()
_OPENAI_MODEL = (os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip()
_OPENAI_BASE = (os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1").strip().rstrip("/")
_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_CACHE_SEC = int(os.environ.get("QA_AI_SUMMARY_CACHE_SEC", "21600"))


def _parse_bullets_from_model(text: str, *, limit: int = 5) -> List[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    out: List[str] = []
    for ln in lines:
        s = re.sub(r"^[\s\-•*]+", "", ln)
        s = re.sub(r"^\d+[\).\]]\s*", "", s).strip()
        if len(s) < 10:
            continue
        if s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    if not out and raw:
        out = [raw[:280]]
    return out[:limit]


def _openai_chat(prompt: str) -> Tuple[Optional[str], Optional[str]]:
    if not _OPENAI_API_KEY:
        return None, "OPENAI_API_KEY not configured"
    try:
        res = requests.post(
            f"{_OPENAI_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {_OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": _OPENAI_MODEL,
                "temperature": 0.2,
                "max_tokens": 450,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You summarize vending-machine QA inspections for busy operators. "
                            "Return exactly 3 to 5 bullet points. One bullet per line. "
                            "No numbering, no markdown headers. Be specific and actionable."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=60,
        )
        if res.status_code != 200:
            return None, f"OpenAI HTTP {res.status_code}: {(res.text or '')[:200]}"
        data = res.json()
        choices = data.get("choices") if isinstance(data, dict) else None
        if not isinstance(choices, list) or not choices:
            return None, "OpenAI returned no choices"
        msg = choices[0].get("message") if isinstance(choices[0], dict) else None
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, str) or not content.strip():
            return None, "OpenAI returned empty content"
        return content.strip(), None
    except Exception as ex:
        logger.exception("openai chat")
        return None, str(ex)


def _heuristic_bullets_from_text(text: str, limit: int = 5) -> List[str]:
    raw = str(text or "").strip()
    if not raw:
        return []
    parts = re.split(r"[·\n;]+|\.\s+", raw)
    out: List[str] = []
    for p in parts:
        s = re.sub(r"\s+", " ", p).strip(" -•")
        if len(s) < 8:
            continue
        if s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    if not out and raw:
        out = [raw[:240]]
    return out[:limit]


def qa_ai_bullets_for_audit(audit_id: str) -> Dict[str, Any]:
    aid = (audit_id or "").strip()
    if not aid:
        return {"bullets": [], "error": "audit_id required", "aiConfigured": bool(_OPENAI_API_KEY)}

    hit = _CACHE.get(aid)
    if hit and (time.time() - hit[0]) < _CACHE_SEC:
        return hit[1]

    from safetyculture_qa_lib import (
        _extract_location,
        _extract_score,
        _extract_user,
        _get_audit,
        _summary_text,
        audit_report_plaintext,
    )

    detail = _get_audit(aid)
    if not detail:
        payload = {
            "bullets": [],
            "error": "SafetyCulture audit not found",
            "aiConfigured": bool(_OPENAI_API_KEY),
            "source": "none",
        }
        return payload

    score = _extract_score(detail)
    location = _extract_location(detail)
    officer, _ = _extract_user(detail)
    summary = _summary_text(detail, score)
    report_text = audit_report_plaintext(detail)

    prompt_parts = [
        f"Location: {location}",
        f"Inspector: {officer}",
    ]
    if score is not None:
        prompt_parts.append(f"Score: {round(score)}%")
    if summary:
        prompt_parts.append(f"Title: {summary}")
    prompt_parts.append("")
    prompt_parts.append("Inspection responses:")
    prompt_parts.append(report_text or summary or "No detailed responses available.")
    prompt = "\n".join(prompt_parts)

    bullets: List[str] = []
    source = "none"
    ai_error: Optional[str] = None

    if _OPENAI_API_KEY and report_text:
        content, ai_error = _openai_chat(prompt)
        if content:
            bullets = _parse_bullets_from_model(content)
            if bullets:
                source = "openai"

    if not bullets:
        bullets = _heuristic_bullets_from_text(report_text or summary)
        if bullets:
            source = "heuristic_report"
        else:
            bullets = _heuristic_bullets_from_text(summary)
            if bullets:
                source = "heuristic_summary"

    payload: Dict[str, Any] = {
        "bullets": bullets[:5],
        "summary": summary or None,
        "score": score,
        "aiConfigured": bool(_OPENAI_API_KEY),
        "source": source,
    }
    if ai_error and source != "openai":
        payload["aiError"] = ai_error

    _CACHE[aid] = (time.time(), payload)
    return payload
