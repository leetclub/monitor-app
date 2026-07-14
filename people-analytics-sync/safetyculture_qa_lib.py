"""SafetyCulture (iAuditor) QA visit data — port of monitoring-app visit-tracking-tab.js."""
from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

_KWT = ZoneInfo("Asia/Kuwait")

from urllib.parse import urlencode

import requests

logger = logging.getLogger(__name__)

_API_BASE = (os.environ.get("SAFETY_CULTURE_API_BASE") or "https://api.safetyculture.io").strip().rstrip("/")
_API_TOKEN = (os.environ.get("SAFETY_CULTURE_API_TOKEN") or "").strip()
_REPORT_BASE = (
    os.environ.get("SAFETY_CULTURE_REPORT_BASE") or "https://app.eu.safetyculture.com/inspections"
).strip().rstrip("/")
_GAS_WEB_APP_URL = (
    os.environ.get("MONITOR_GAS_WEB_APP_URL")
    or "https://script.google.com/macros/s/AKfycbyPRbFG9wRZ1cDoP2l-nlPpK3FIRiX-rxgQneWLOvv4L34DWUJaxv5Ukmzez7zcxQcnug/exec"
).strip()
_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_MACHINE_AUDITS_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
# Keep QA fresh — same-day inspections should appear within a couple of minutes.
_CACHE_SEC = int(os.environ.get("SAFETY_CULTURE_QA_CACHE_SEC", "120"))
_SEARCH_DAYS = int(os.environ.get("SAFETY_CULTURE_QA_SEARCH_DAYS", "180"))
_MAX_AUDITS = int(os.environ.get("SAFETY_CULTURE_QA_MAX_AUDITS", "1500"))
_MACHINE_AUDITS_CACHE_SEC = int(os.environ.get("SAFETY_CULTURE_QA_MACHINE_CACHE_SEC", "120"))
_MACHINE_AUDITS_MAX_PROCESS = int(os.environ.get("SAFETY_CULTURE_QA_MACHINE_MAX_PROCESS", "2000"))
_WORKERS = int(os.environ.get("SAFETY_CULTURE_QA_WORKERS", "6"))
# Always fully process audits modified in this recent window (no per-chunk truncate).
_RECENT_FULL_SCAN_DAYS = int(os.environ.get("SAFETY_CULTURE_QA_RECENT_FULL_DAYS", "14"))
_QC_USER_PATTERNS = [
    p.strip().lower()
    for p in (os.environ.get("SAFETY_CULTURE_QC_USER_PATTERNS") or "ismail").split(",")
    if p.strip()
]
_TECH_USER_PATTERNS = [
    p.strip().lower()
    for p in (os.environ.get("SAFETY_CULTURE_TECH_USER_PATTERNS") or "harout").split(",")
    if p.strip()
]


def _norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {_API_TOKEN}", "Content-Type": "application/json"}


def _search_audits(modified_after: str, modified_before: str) -> Tuple[List[str], Optional[str]]:
    ids, err = _search_audit_ids(modified_after, modified_before)
    return ids, err


def _search_audit_ids(modified_after: str, modified_before: str) -> Tuple[List[str], Optional[str]]:
    """Search SafetyCulture audits; follow next_page_token; return newest-first by modified_at."""
    if not _API_TOKEN:
        return [], "SAFETY_CULTURE_API_TOKEN not configured"
    pairs: List[Tuple[str, str]] = []  # (modified_at, audit_id)
    seen: set[str] = set()
    page_token: Optional[str] = None
    last_err: Optional[str] = None
    for _ in range(40):
        params = ["field=audit_id", "field=modified_at"]
        params.append("modified_after=" + requests.utils.quote(modified_after))
        params.append("modified_before=" + requests.utils.quote(modified_before))
        if page_token:
            params.append("next_page_token=" + requests.utils.quote(page_token))
        url = f"{_API_BASE}/audits/search?" + "&".join(params)
        try:
            res = requests.get(url, headers=_headers(), timeout=60)
            if res.status_code != 200:
                msg = f"SafetyCulture API {res.status_code}"
                body = (res.text or "").strip()
                if body:
                    msg = f"{msg}: {body[:200]}"
                logger.warning("SafetyCulture search %s: %s", res.status_code, res.text[:300])
                if not pairs:
                    return [], msg
                break
            data = res.json()
            audits = data.get("audits") if isinstance(data, dict) else None
            if not isinstance(audits, list):
                if not pairs:
                    return [], "SafetyCulture search returned unexpected payload"
                break
            for a in audits:
                if not isinstance(a, dict) or not a.get("audit_id"):
                    continue
                aid = str(a.get("audit_id"))
                if not aid or aid in seen:
                    continue
                seen.add(aid)
                pairs.append((str(a.get("modified_at") or ""), aid))
            page_token = None
            if isinstance(data, dict):
                page_token = (
                    data.get("next_page_token")
                    or (data.get("pagination") or {}).get("next_page_token")
                )
                if page_token:
                    page_token = str(page_token).strip() or None
            if not page_token:
                break
        except Exception as ex:
            logger.exception("SafetyCulture search")
            last_err = str(ex)
            if not pairs:
                return [], last_err
            break
    # Critical: paginated pages are not globally ordered — sort newest first before any [:cap].
    pairs.sort(key=lambda t: t[0], reverse=True)
    return [aid for _, aid in pairs], last_err


def _get_audit(audit_id: str) -> Optional[Dict[str, Any]]:
    if not _API_TOKEN or not audit_id:
        return None
    try:
        res = requests.get(f"{_API_BASE}/audits/{audit_id}", headers=_headers(), timeout=45)
        if res.status_code != 200:
            return None
        data = res.json()
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _extract_location(audit: Dict[str, Any]) -> str:
    candidates = _location_match_candidates(audit)
    return candidates[0] if candidates else "Unknown"


def _location_match_candidates(audit: Dict[str, Any]) -> List[str]:
    """Primary site/machine labels an audit may match against (order = preference)."""
    found: List[str] = []

    def add(raw: Any) -> None:
        name = str(raw or "").strip()
        if not name or name.lower() == "unknown":
            return
        if name not in found:
            found.append(name)

    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    site = ad.get("site") if isinstance(ad.get("site"), dict) else {}
    add(site.get("name"))
    add(ad.get("title"))
    add(audit.get("name"))
    add(ad.get("template_name"))

    for item in audit.get("header_items") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").lower()
        if not any(
            x in label
            for x in (
                "location",
                "site",
                "machine",
                "vending",
                "vm name",
                "asset",
                "place",
            )
        ):
            continue
        resp = item.get("responses") if isinstance(item.get("responses"), dict) else {}
        sel = resp.get("selected")
        if isinstance(sel, list) and sel:
            first = sel[0]
            if isinstance(first, dict):
                add(first.get("label") or first.get("name"))
            elif isinstance(first, str):
                add(first)
        add(resp.get("text"))
        add(resp.get("value"))
    return found


def _extract_user(audit: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    candidates: List[Tuple[str, Optional[str]]] = []

    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    auth = ad.get("authorship") if isinstance(ad.get("authorship"), dict) else {}
    if auth:
        for nk, ik in (("author", "author_id"), ("owner", "owner_id"), ("created_by", "created_by_id")):
            n = auth.get(nk)
            i = auth.get(ik)
            if n:
                candidates.append((str(n), str(i) if i else None))

    top_auth = audit.get("authorship") if isinstance(audit.get("authorship"), dict) else {}
    if top_auth:
        for nk, ik in (("author", "author_id"), ("owner", "owner_id"), ("created_by", "created_by_id")):
            n = top_auth.get(nk)
            i = top_auth.get(ik)
            if n:
                candidates.append((str(n), str(i) if i else None))

    for block in (ad, audit):
        if not isinstance(block, dict):
            continue
        for nk, ik in (("created_by", "created_by_id"), ("modified_by", "modified_by_id")):
            n = block.get(nk)
            i = block.get(ik)
            if n:
                candidates.append((str(n), str(i) if i else None))

    owner = audit.get("owner")
    if isinstance(owner, dict):
        candidates.append(
            (str(owner.get("name") or owner.get("email") or ""), str(owner.get("id") or owner.get("user_id") or "") or None)
        )
    elif isinstance(owner, str) and owner.strip():
        candidates.append((owner.strip(), None))

    for item in audit.get("header_items") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").lower()
        if not any(x in label for x in ("user", "inspector", "author")):
            continue
        resp = item.get("responses") if isinstance(item.get("responses"), dict) else {}
        sel = resp.get("selected")
        if isinstance(sel, list) and sel:
            first = sel[0]
            if isinstance(first, dict):
                name = str(first.get("label") or first.get("name") or "").strip()
                if name:
                    candidates.append((name, str(first.get("id") or "") or None))
        text = resp.get("text")
        if isinstance(text, str) and text.strip():
            candidates.append((text.strip(), None))

    for name, uid in candidates:
        if name and name.strip() and name.strip().lower() != "unknown":
            return name.strip(), uid
    return "Unknown", None


def _extract_role(audit: Dict[str, Any]) -> str:
    for item in audit.get("header_items") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").lower()
        if any(x in label for x in ("area manager", "operator", "technician", "qc", "quality")):
            return str(item.get("label") or "Unknown")
    user_name = _extract_user(audit)[0].lower()
    if "qc" in user_name or "quality" in user_name:
        return "QC"
    if "tech" in user_name:
        return "Technician"
    if "ops" in user_name or "operator" in user_name:
        return "Ops"
    if "area" in user_name or "manager" in user_name:
        return "Area"
    return "Unknown"


def _extract_score(audit: Dict[str, Any]) -> Optional[float]:
    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    for block in (ad, audit):
        for key in ("score_percentage", "score", "total_score"):
            val = block.get(key)
            if val is not None:
                try:
                    return float(val)
                except (TypeError, ValueError):
                    pass
    return None


def _visit_dt(audit: Dict[str, Any]) -> Optional[datetime]:
    """Prefer inspection conducted/completed time over last modified (edits shouldn't reorder visits)."""
    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    for block in (ad, audit):
        if not isinstance(block, dict):
            continue
        for key in (
            "date_completed",
            "conducted_at",
            "completed_at",
            "created_at",
            "date_modified",
            "modified_at",
        ):
            raw = block.get(key)
            if not raw:
                continue
            try:
                return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                continue
    return None


def _is_qc_role(role: str) -> bool:
    r = (role or "").lower()
    return "qc" in r or "quality" in r


def _is_tech_role(role: str) -> bool:
    r = (role or "").lower()
    return "tech" in r or "technician" in r


def _is_tech_audit(audit: Dict[str, Any], role: str) -> bool:
    if _is_tech_role(role):
        return True
    text = _audit_template_text(audit)
    return any(
        x in text
        for x in (
            "tech visit",
            "technician",
            "maintenance",
            "repair",
            "service visit",
            "machine service",
            "field service",
            "preventive maintenance",
            "pm visit",
            "equipment check",
        )
    )


def _visit_kind(officer_name: str, role: str, audit: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Classify SafetyCulture visit as qc or tech (Alert columns). Ops/area visits return None."""
    un = (officer_name or "").lower()
    for pat in _QC_USER_PATTERNS:
        if pat and pat in un:
            return "qc"
    for pat in _TECH_USER_PATTERNS:
        if pat and pat in un:
            return "tech"
    if _is_qc_role(role):
        return "qc"
    if audit and _is_qc_audit(audit, role):
        return "qc"
    if _is_tech_role(role):
        return "tech"
    if audit and _is_tech_audit(audit, role):
        return "tech"
    # Same-day QC visits by other officers: accept scored inspections that are not ops/tech.
    if audit:
        role_l = (role or "").lower()
        if any(x in role_l for x in ("ops", "operator", "area manager")):
            return None
        score = _extract_score(audit)
        text = _audit_template_text(audit)
        if score is not None and not _is_tech_audit(audit, role):
            if any(x in text for x in ("qc", "quality", "inspection", "audit", "leet", "checklist")):
                return "qc"
            # Location'd scored inspection with unknown role → still surface as QC.
            loc = _extract_location(audit)
            if loc and loc != "Unknown" and role_l in ("", "unknown"):
                return "qc"
    return None


def _audit_template_text(audit: Dict[str, Any]) -> str:
    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    parts = [
        str(ad.get("title") or ""),
        str(audit.get("name") or ""),
        str(ad.get("template_name") or ""),
    ]
    return " ".join(parts).lower()


def _is_qc_audit(audit: Dict[str, Any], role: str) -> bool:
    if _is_qc_role(role):
        return True
    text = _audit_template_text(audit)
    return any(x in text for x in ("qc", "quality control", "quality check", "quality audit"))


def _kuwait_year_month(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_KWT).strftime("%Y-%m")


def _visit_in_kuwait_month(visit_dt: datetime, now: datetime) -> bool:
    return _kuwait_year_month(visit_dt) == _kuwait_year_month(now)


def _mtd_for_norm_key(needle: str, visit_count_mtd: Dict[str, int]) -> int:
    """Exact or substring match — SC site names vs machine labels often differ slightly."""
    if not needle or not visit_count_mtd:
        return 0
    if needle in visit_count_mtd:
        return int(visit_count_mtd[needle])
    best = 0
    best_len = 0
    for mk, count in visit_count_mtd.items():
        if needle in mk or mk in needle:
            ln = min(len(needle), len(mk))
            if ln > best_len:
                best_len = ln
                best = int(count)
    return best


def _build_visit_count_mtd(audit_ids: List[str], now: datetime) -> Dict[str, int]:
    """QC inspections per location in the current Asia/Kuwait calendar month."""
    visit_count_mtd: Dict[str, int] = {}
    if not audit_ids or not _API_TOKEN:
        return visit_count_mtd
    cap = audit_ids if _MAX_AUDITS <= 0 else audit_ids[: max(1, _MAX_AUDITS)]
    with ThreadPoolExecutor(max_workers=max(1, _WORKERS)) as pool:
        futures = {pool.submit(_process_audit, aid, now): aid for aid in cap}
        for fut in as_completed(futures):
            try:
                row = fut.result()
            except Exception:
                continue
            if not row or row.get("visitKind") != "qc":
                continue
            visit_dt_raw = row.get("lastVisitAt")
            if not visit_dt_raw:
                continue
            try:
                vdt = datetime.fromisoformat(str(visit_dt_raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            if _visit_in_kuwait_month(vdt, now):
                nk = _norm_key(row["location"])
                visit_count_mtd[nk] = visit_count_mtd.get(nk, 0) + 1
    return visit_count_mtd


def _apply_visit_count_mtd_to_payload(
    payload: Dict[str, Any],
    visit_count_mtd: Dict[str, int],
) -> Dict[str, Any]:
    if not visit_count_mtd:
        return payload
    out = dict(payload)
    by_loc = dict(out.get("byLocationKey") or {})
    for nk, row in list(by_loc.items()):
        by_loc[nk] = {**row, "visitCountMtd": _mtd_for_norm_key(nk, visit_count_mtd)}
    out["byLocationKey"] = by_loc
    visits = []
    for row in out.get("visits") or []:
        if not isinstance(row, dict):
            continue
        nk = _norm_key(str(row.get("location") or ""))
        visits.append({**row, "visitCountMtd": _mtd_for_norm_key(nk, visit_count_mtd)})
    out["visits"] = visits
    return out


def _response_indicates_issue(item: Dict[str, Any]) -> bool:
    if not isinstance(item, dict):
        return False
    score = item.get("score")
    if score is not None:
        try:
            if float(score) == 0:
                return True
        except (TypeError, ValueError):
            pass
    label = str(item.get("label") or item.get("name") or "").lower()
    resp = item.get("responses") if isinstance(item.get("responses"), dict) else {}
    sel = resp.get("selected")
    if isinstance(sel, list):
        for s in sel:
            part = ""
            if isinstance(s, dict):
                part = str(s.get("label") or s.get("name") or s.get("value") or "").lower()
            elif isinstance(s, str):
                part = s.lower()
            if any(x in part for x in ("fail", "no", "non-compliant", "not ok", "issue", "major", "critical")):
                return True
    text = resp.get("text") or resp.get("note")
    if isinstance(text, str) and text.strip():
        if any(
            x in label
            for x in ("finding", "issue", "action", "observation", "non-conformance", "defect", "recommend")
        ):
            return True
    return False


def _extract_key_findings(audit: Dict[str, Any], limit: int = 5) -> List[str]:
    """Heuristic bullet list from SafetyCulture audit items (failed / issue fields)."""
    if not isinstance(audit, dict) or limit <= 0:
        return []
    findings: List[str] = []

    def walk(item: Dict[str, Any], depth: int = 0) -> None:
        if not isinstance(item, dict) or depth > 12 or len(findings) >= limit:
            return
        lines = _item_plaintext_lines(item)
        if _response_indicates_issue(item) and lines:
            for ln in lines:
                s = ln.strip()
                if len(s) < 8 or s in findings:
                    continue
                findings.append(s)
                if len(findings) >= limit:
                    return
        for child_key in ("children", "items"):
            children = item.get(child_key)
            if not isinstance(children, list):
                continue
            for child in children:
                if isinstance(child, dict):
                    walk(child, depth + 1)
                if len(findings) >= limit:
                    return

    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    for block in (audit.get("header_items"), audit.get("items"), ad.get("items")):
        if not isinstance(block, list):
            continue
        for item in block:
            if isinstance(item, dict):
                walk(item)
            if len(findings) >= limit:
                break
    return findings[:limit]


def _summary_text(audit: Dict[str, Any], score: Optional[float]) -> str:
    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    title = str(ad.get("title") or audit.get("name") or "").strip()
    parts = []
    if title:
        parts.append(title)
    if score is not None:
        parts.append(f"Score {round(score)}%")
    return " · ".join(parts) if parts else "QA inspection completed"


def _process_audit(audit_id: str, now: datetime) -> Optional[Dict[str, Any]]:
    detail = _get_audit(audit_id)
    if not detail:
        return None
    candidates = _location_match_candidates(detail)
    location = candidates[0] if candidates else ""
    if not location or location == "Unknown":
        return None
    role = _extract_role(detail)
    user_name, user_id = _extract_user(detail)
    kind = _visit_kind(user_name, role, detail)
    if not kind:
        return None
    visit_dt = _visit_dt(detail)
    if not visit_dt:
        return None
    if visit_dt.tzinfo is None:
        visit_dt = visit_dt.replace(tzinfo=timezone.utc)
    score = _extract_score(detail)
    days = max(0, int((now - visit_dt).total_seconds() // 86400))
    aid = str(detail.get("audit_id") or audit_id)
    return {
        "location": location,
        "locationKeys": candidates,
        "role": role,
        "officerName": user_name,
        "officerId": user_id,
        "lastVisitAt": visit_dt.isoformat(),
        "lastVisitDate": visit_dt.date().isoformat(),
        "daysSinceVisit": days,
        "isQc": kind == "qc",
        "visitKind": kind,
        "auditId": aid,
        "score": score,
        "reportUrl": f"{_REPORT_BASE}/{aid}",
        "summary": _summary_text(detail, score),
        "keyFindings": _extract_key_findings(detail),
    }


def _merge_visit_row(
    visits_by_loc: Dict[str, Dict[str, Any]],
    row: Dict[str, Any],
) -> None:
    labels = [str(row.get("location") or "")]
    keys = row.get("locationKeys")
    if isinstance(keys, list):
        labels.extend([str(x) for x in keys if x])
    for label in labels:
        nk = _norm_key(label)
        if not nk:
            continue
        prev = visits_by_loc.get(nk)
        if not prev or row["lastVisitAt"] > prev["lastVisitAt"]:
            visits_by_loc[nk] = row


def _empty_payload(source: str, error: Optional[str] = None) -> Dict[str, Any]:
    return {
        "visits": [],
        "visitsTech": [],
        "total": 0,
        "totalTech": 0,
        "auditsSearched": 0,
        "locationsWithQc": 0,
        "locationsWithTech": 0,
        "source": source,
        "byLocationKey": {},
        "byLocationKeyTech": {},
        "count": 0,
        "countTech": 0,
        **({"error": error} if error else {}),
    }


def _finalize_visit_payload(
    visits_by_loc_qc: Dict[str, Dict[str, Any]],
    visits_by_loc_tech: Dict[str, Dict[str, Any]],
    *,
    source: str,
    audits_searched: int,
    visit_count_mtd: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    mtd = visit_count_mtd or {}
    for nk, row in list(visits_by_loc_qc.items()):
        visits_by_loc_qc[nk] = {**row, "visitCountMtd": _mtd_for_norm_key(nk, mtd)}
    visits_qc = sorted(visits_by_loc_qc.values(), key=lambda v: v.get("location") or "")
    visits_tech = sorted(visits_by_loc_tech.values(), key=lambda v: v.get("location") or "")
    return {
        "visits": visits_qc,
        "visitsTech": visits_tech,
        "total": len(visits_qc),
        "totalTech": len(visits_tech),
        "auditsSearched": audits_searched,
        "locationsWithQc": len(visits_by_loc_qc),
        "locationsWithTech": len(visits_by_loc_tech),
        "source": source,
        "byLocationKey": dict(visits_by_loc_qc),
        "byLocationKeyTech": dict(visits_by_loc_tech),
        "count": len(visits_by_loc_qc),
        "countTech": len(visits_by_loc_tech),
    }


def _transform_gas_visits(
    raw: Dict[str, Any],
    *,
    visit_count_mtd: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Map Monitor GAS getLastVisitTracking() → Alert QA + tech summary shape."""
    if raw.get("error"):
        out = _empty_payload("monitor-gas", str(raw.get("error")))
        return out
    visits_in = raw.get("visits") if isinstance(raw.get("visits"), list) else []
    visits_by_loc_qc: Dict[str, Dict[str, Any]] = {}
    visits_by_loc_tech: Dict[str, Dict[str, Any]] = {}
    for v in visits_in:
        if not isinstance(v, dict):
            continue
        location = str(v.get("location") or "").strip()
        role = str(v.get("role") or "").strip()
        officer = str(v.get("user") or v.get("officerName") or "").strip()
        if not location or location == "Unknown":
            continue
        kind = _visit_kind(officer, role)
        if not kind:
            continue
        last_at = v.get("lastVisitDate") or v.get("lastVisitDateStr")
        if isinstance(last_at, str) and last_at and "T" not in last_at:
            last_at = f"{last_at}T12:00:00+00:00"
        if not last_at:
            continue
        audit_id = str(v.get("auditId") or v.get("audit_id") or "").strip()
        row = {
            "location": location,
            "role": role,
            "officerName": officer or None,
            "lastVisitAt": str(last_at),
            "lastVisitDate": str(v.get("lastVisitDateStr") or str(last_at)[:10]),
            "daysSinceVisit": v.get("daysSinceVisit"),
            "isQc": kind == "qc",
            "visitKind": kind,
            "auditId": audit_id or None,
            "score": v.get("score"),
            "reportUrl": f"{_REPORT_BASE}/{audit_id}" if audit_id else None,
            "summary": f"{'QA' if kind == 'qc' else 'Tech'} visit · {officer or role}",
        }
        target = visits_by_loc_qc if kind == "qc" else visits_by_loc_tech
        _merge_visit_row(target, row)
    return _finalize_visit_payload(
        visits_by_loc_qc,
        visits_by_loc_tech,
        source="monitor-gas",
        audits_searched=len(visits_in),
        visit_count_mtd=visit_count_mtd,
    )


def _fetch_from_monitor_gas(
    *,
    visit_count_mtd: Optional[Dict[str, int]] = None,
) -> Optional[Dict[str, Any]]:
    if not _GAS_WEB_APP_URL:
        return None
    url = f"{_GAS_WEB_APP_URL}?{urlencode({'action': 'qaSummary'})}"
    try:
        res = requests.get(url, timeout=180, allow_redirects=True)
        if res.status_code != 200:
            logger.warning("Monitor GAS qaSummary %s: %s", res.status_code, res.text[:300])
            return None
        data = res.json()
        if not isinstance(data, dict):
            return None
        return _transform_gas_visits(data, visit_count_mtd=visit_count_mtd)
    except Exception:
        logger.exception("_fetch_from_monitor_gas")
        return None


def get_last_visit_tracking() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    cache_key = "visits"
    hit = _CACHE.get(cache_key)
    if hit and (time.time() - hit[0]) < _CACHE_SEC:
        return hit[1]

    payload: Optional[Dict[str, Any]] = None
    search_err: Optional[str] = None
    visit_count_mtd: Dict[str, int] = {}

    if _API_TOKEN:
        start = now - timedelta(days=max(1, _SEARCH_DAYS))
        audit_ids, search_err = _search_audits(
            start.isoformat().replace("+00:00", "Z"), now.isoformat().replace("+00:00", "Z")
        )
        if audit_ids:
            visit_count_mtd = _build_visit_count_mtd(audit_ids, now)
            cap = audit_ids if _MAX_AUDITS <= 0 else audit_ids[: max(1, _MAX_AUDITS)]
            visits_by_loc_qc: Dict[str, Dict[str, Any]] = {}
            visits_by_loc_tech: Dict[str, Dict[str, Any]] = {}
            with ThreadPoolExecutor(max_workers=max(1, _WORKERS)) as pool:
                futures = {pool.submit(_process_audit, aid, now): aid for aid in cap}
                for fut in as_completed(futures):
                    try:
                        row = fut.result()
                    except Exception:
                        continue
                    if not row:
                        continue
                    target = visits_by_loc_qc if row.get("visitKind") == "qc" else visits_by_loc_tech
                    _merge_visit_row(target, row)
            payload = _finalize_visit_payload(
                visits_by_loc_qc,
                visits_by_loc_tech,
                source="safetyculture",
                audits_searched=len(audit_ids),
                visit_count_mtd=visit_count_mtd,
            )
        elif search_err:
            logger.warning("SafetyCulture direct failed (%s) — trying Monitor GAS", search_err)

    has_visits = bool(payload and (payload.get("count") or payload.get("countTech")))
    if not has_visits:
        gas_payload = _fetch_from_monitor_gas(visit_count_mtd=visit_count_mtd)
        if gas_payload and (gas_payload.get("count") or gas_payload.get("countTech")):
            payload = gas_payload
        elif not payload:
            err = search_err or "SafetyCulture search returned no audits and Monitor GAS qaSummary empty"
            payload = _empty_payload("safetyculture", err)
        elif not payload.get("error"):
            payload = dict(payload)
            payload["error"] = "No QC or tech visits matched inspector filters; Monitor GAS fallback empty"

    _CACHE[cache_key] = (time.time(), payload)
    return payload


def qa_visits_payload() -> Dict[str, Any]:
    return get_last_visit_tracking()


def qa_visit_for_machine_name(machine_name: str) -> Optional[Dict[str, Any]]:
    return _visit_for_machine_name(machine_name, "qc")


def tech_visit_for_machine_name(machine_name: str) -> Optional[Dict[str, Any]]:
    return _visit_for_machine_name(machine_name, "tech")


def _visit_for_machine_name(machine_name: str, kind: str) -> Optional[Dict[str, Any]]:
    data = get_last_visit_tracking()
    key = "byLocationKey" if kind == "qc" else "byLocationKeyTech"
    by_loc = data.get(key) or {}
    return _pick_visit_from_by_loc(machine_name, by_loc, kind)


def _pick_visit_from_by_loc(
    machine_name: str,
    by_loc: Dict[str, Dict[str, Any]],
    kind: str = "qc",
) -> Optional[Dict[str, Any]]:
    from qa_machine_alias_lib import machines_share_qa_alias, norm_keys_for_lookup

    needle = _norm_key(machine_name)
    if not needle or not by_loc:
        return None

    alias_keys = norm_keys_for_lookup(machine_name)
    candidates: List[Tuple[int, str, Dict[str, Any]]] = []

    def consider(row: Dict[str, Any], priority: int) -> None:
        if not isinstance(row, dict):
            return
        if kind == "qc" and not row.get("auditId"):
            return
        lat = str(row.get("lastVisitAt") or row.get("lastVisitDate") or "")
        if not lat:
            return
        candidates.append((priority, lat, row))

    if needle in by_loc:
        consider(by_loc[needle], 100)
    for ak in alias_keys:
        if ak in by_loc:
            consider(by_loc[ak], 90)

    for nk, row in by_loc.items():
        if not isinstance(row, dict):
            continue
        loc = str(row.get("location") or nk)
        loc_key = _norm_key(loc)
        if loc_key in alias_keys or nk in alias_keys:
            consider(row, 55)
            continue
        if machines_share_qa_alias(machine_name, loc):
            consider(row, 50)
            continue
        if needle == nk or needle in nk or nk in needle:
            consider(row, 40)

    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[1], item[0]), reverse=True)
    return candidates[0][2]


def _build_qc_rows_in_range(start: datetime, end: datetime) -> Tuple[List[Dict[str, Any]], int, int, Optional[str]]:
    """Chunked SC scan for a date window → all QC audit rows in range."""
    rows: List[Dict[str, Any]] = []
    seen_audit_ids: set[str] = set()
    audits_searched = 0
    audits_processed = 0
    search_err: Optional[str] = None
    now = datetime.now(timezone.utc)

    if not _API_TOKEN:
        return rows, 0, 0, "SAFETY_CULTURE_API_TOKEN not configured"

    chunks = _iter_date_chunks(start, end, chunk_days=28)
    per_chunk_cap = (
        max(120, int(_MACHINE_AUDITS_MAX_PROCESS // max(1, len(chunks))))
        if _MACHINE_AUDITS_MAX_PROCESS > 0
        else 0
    )
    recent_cut = datetime.now(timezone.utc) - timedelta(days=max(1, _RECENT_FULL_SCAN_DAYS))
    for chunk_start, chunk_end in chunks:
        audit_ids, chunk_err = _search_audits(
            chunk_start.isoformat().replace("+00:00", "Z"),
            chunk_end.isoformat().replace("+00:00", "Z"),
        )
        if chunk_err and not audit_ids:
            search_err = search_err or chunk_err
            continue
        audits_searched += len(audit_ids)
        # Never truncate audits that fall in the recent window (same-day / last N days).
        if chunk_end >= recent_cut or per_chunk_cap <= 0:
            cap = audit_ids
        else:
            cap = audit_ids[:per_chunk_cap]
        audits_processed += len(cap)
        with ThreadPoolExecutor(max_workers=max(1, _WORKERS)) as pool:
            futures = {pool.submit(_process_audit, aid, now): aid for aid in cap}
            for fut in as_completed(futures):
                try:
                    row = fut.result()
                except Exception:
                    continue
                if not row or row.get("visitKind") != "qc":
                    continue
                aid = str(row.get("auditId") or "")
                if aid and aid in seen_audit_ids:
                    continue
                visit_dt = _parse_iso_dt(str(row.get("lastVisitAt") or ""))
                if visit_dt and (visit_dt < start or visit_dt > end):
                    continue
                if aid:
                    seen_audit_ids.add(aid)
                rows.append(row)

    return rows, audits_searched, audits_processed, search_err


def _latest_qc_by_machine_names(
    machine_names: List[str],
    rows: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """Newest QC audit per machine using the same match rules as machine history."""
    by_machine: Dict[str, Dict[str, Any]] = {}
    for mname in machine_names:
        best: Optional[Dict[str, Any]] = None
        best_at = ""
        for row in rows:
            if not isinstance(row, dict) or not row.get("auditId"):
                continue
            loc = str(row.get("location") or "")
            keys = row.get("locationKeys") if isinstance(row.get("locationKeys"), list) else None
            if not _audit_matches_machine(mname, loc, keys):
                continue
            lat = str(row.get("lastVisitAt") or row.get("lastVisitDate") or "")
            if not lat:
                continue
            if not best or lat > best_at:
                best = row
                best_at = lat
        if best:
            by_machine[mname] = best
    return by_machine


def _resolve_qc_date_range(
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    max_days: Optional[int] = None,
) -> Tuple[datetime, datetime]:
    span_cap = max(30, min(int(max_days or _FLEET_MAX_DAYS), 365))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=span_cap)
    end = now
    if date_from:
        parsed = _parse_iso_dt(date_from if "T" in date_from else f"{date_from}T00:00:00+00:00")
        if parsed:
            start = parsed
    if date_to:
        parsed = _parse_iso_dt(date_to if "T" in date_to else f"{date_to}T23:59:59+00:00")
        if parsed:
            end = parsed
    if start > end:
        start, end = end, start
    if (end - start).days > span_cap:
        start = end - timedelta(days=span_cap)
    return start, end


def _audit_matches_machine(machine_name: str, location: str, location_keys: Optional[List[str]] = None) -> bool:
    from qa_machine_alias_lib import machines_share_qa_alias, norm_keys_for_lookup

    needle = _norm_key(machine_name)
    if not needle:
        return False
    alias_keys = norm_keys_for_lookup(machine_name)
    labels = [location]
    if location_keys:
        labels.extend([str(x) for x in location_keys if x])
    for label in labels:
        loc_key = _norm_key(label)
        if not loc_key:
            continue
        if needle == loc_key:
            return True
        if loc_key in alias_keys:
            return True
        if machines_share_qa_alias(machine_name, label):
            return True
        # Shared site: "Souq Sharq" matches "Souq Sharq - Gate 1" and vice versa.
        if needle in loc_key or loc_key in needle:
            return True
        # Token overlap (same building / hospital, different machine suffix).
        n_toks = {t for t in needle.split() if len(t) > 2}
        l_toks = {t for t in loc_key.split() if len(t) > 2}
        if n_toks and l_toks and len(n_toks & l_toks) >= 2:
            return True
    return False


def _parse_iso_dt(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _qa_score_trend(
    audits: List[Dict[str, Any]],
    *,
    ref_end: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Week-over-week score comparison from QC audit rows (relative to filter end)."""
    scored: List[Tuple[datetime, float]] = []
    for row in audits:
        score = row.get("score")
        dt = _parse_iso_dt(str(row.get("lastVisitAt") or row.get("lastVisitDate") or ""))
        if score is None or dt is None:
            continue
        try:
            scored.append((dt, float(score)))
        except (TypeError, ValueError):
            continue
    scored.sort(key=lambda x: x[0])
    points = [{"date": dt.astimezone(_KWT).date().isoformat(), "score": round(s)} for dt, s in scored[-16:]]
    if not scored:
        return {
            "trend": "unknown",
            "currentWeekAvg": None,
            "priorWeekAvg": None,
            "delta": None,
            "points": points,
        }
    end = ref_end or scored[-1][0]
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    week_start = end - timedelta(days=7)
    prior_start = end - timedelta(days=14)
    current_week = [s for dt, s in scored if week_start <= dt <= end]
    prior_week = [s for dt, s in scored if prior_start <= dt < week_start]
    cur_avg = round(sum(current_week) / len(current_week), 1) if current_week else None
    prior_avg = round(sum(prior_week) / len(prior_week), 1) if prior_week else None
    delta = None
    trend = "stable"
    if cur_avg is not None and prior_avg is not None:
        delta = round(cur_avg - prior_avg, 1)
        if delta > 1:
            trend = "improving"
        elif delta < -1:
            trend = "declining"
    elif cur_avg is not None and prior_avg is None:
        trend = "new"
    return {
        "trend": trend,
        "currentWeekAvg": cur_avg,
        "priorWeekAvg": prior_avg,
        "delta": delta,
        "points": points,
    }


def _iter_date_chunks(start: datetime, end: datetime, *, chunk_days: int = 28) -> List[Tuple[datetime, datetime]]:
    """Split a range into newest→oldest windows so older months are not starved by process caps."""
    if start > end:
        start, end = end, start
    span = max(1, int(chunk_days))
    chunks: List[Tuple[datetime, datetime]] = []
    cursor = end
    while cursor > start:
        chunk_start = max(start, cursor - timedelta(days=span - 1))
        chunks.append((chunk_start, cursor))
        if chunk_start <= start:
            break
        cursor = chunk_start - timedelta(seconds=1)
    return chunks


def list_qc_audits_for_machine(
    machine_name: str,
    *,
    days: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    location_query: Optional[str] = None,
    sort: str = "date",
    order: str = "desc",
) -> Dict[str, Any]:
    """
    List SafetyCulture QC audits for one Vendon machine (up to 1 year).
    Searches in ~monthly chunks so dense recent org traffic cannot hide older audits.
    Supports date range, location substring filter, and sort by date or score.
    """
    machine = (machine_name or "").strip()
    if not machine:
        return {"audits": [], "total": 0, "error": "machineName required"}

    span_days = max(7, min(int(days or _SEARCH_DAYS), 365))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=span_days)
    end = now
    if date_from:
        parsed = _parse_iso_dt(date_from if "T" in date_from else f"{date_from}T00:00:00+00:00")
        if parsed:
            start = parsed
    if date_to:
        parsed = _parse_iso_dt(date_to if "T" in date_to else f"{date_to}T23:59:59+00:00")
        if parsed:
            end = parsed
    if start > end:
        start, end = end, start

    loc_q = _norm_key(location_query or "")
    sort_key = (sort or "date").lower()
    order_desc = (order or "desc").lower() != "asc"
    cache_key = "|".join(
        [
            "v3",
            machine.lower(),
            start.date().isoformat(),
            end.date().isoformat(),
            loc_q,
            sort_key,
            "desc" if order_desc else "asc",
        ]
    )
    hit = _MACHINE_AUDITS_CACHE.get(cache_key)
    if hit and (time.time() - hit[0]) < _MACHINE_AUDITS_CACHE_SEC:
        return hit[1]

    if not _API_TOKEN:
        out = {
            "audits": [],
            "total": 0,
            "error": "SAFETY_CULTURE_API_TOKEN not configured",
            "trend": _qa_score_trend([]),
        }
        return out

    chunks = _iter_date_chunks(start, end, chunk_days=28)
    per_chunk_cap = (
        max(250, int(_MACHINE_AUDITS_MAX_PROCESS // max(1, len(chunks))))
        if _MACHINE_AUDITS_MAX_PROCESS > 0
        else 0
    )
    rows: List[Dict[str, Any]] = []
    seen_audit_ids: set[str] = set()
    audits_searched = 0
    audits_processed = 0
    search_err: Optional[str] = None
    recent_cut = now - timedelta(days=max(1, _RECENT_FULL_SCAN_DAYS))

    for chunk_start, chunk_end in chunks:
        audit_ids, chunk_err = _search_audits(
            chunk_start.isoformat().replace("+00:00", "Z"),
            chunk_end.isoformat().replace("+00:00", "Z"),
        )
        if chunk_err and not audit_ids:
            search_err = chunk_err
            continue
        audits_searched += len(audit_ids)
        if chunk_end >= recent_cut or per_chunk_cap <= 0:
            cap = audit_ids
        else:
            cap = audit_ids[:per_chunk_cap]
        audits_processed += len(cap)
        with ThreadPoolExecutor(max_workers=max(1, _WORKERS)) as pool:
            futures = {pool.submit(_process_audit, aid, now): aid for aid in cap}
            for fut in as_completed(futures):
                try:
                    row = fut.result()
                except Exception:
                    continue
                if not row or row.get("visitKind") != "qc":
                    continue
                aid = str(row.get("auditId") or "")
                if aid and aid in seen_audit_ids:
                    continue
                keys = row.get("locationKeys") if isinstance(row.get("locationKeys"), list) else None
                if not _audit_matches_machine(machine, str(row.get("location") or ""), keys):
                    continue
                if loc_q and loc_q not in _norm_key(str(row.get("location") or "")):
                    loc_blob = " ".join([str(row.get("location") or "")] + [str(x) for x in (keys or [])])
                    if loc_q not in _norm_key(loc_blob):
                        continue
                if aid:
                    seen_audit_ids.add(aid)
                rows.append(row)

    if sort_key == "score":
        rows.sort(
            key=lambda r: (r.get("score") is None, float(r.get("score") or 0)),
            reverse=order_desc,
        )
    else:
        rows.sort(key=lambda r: str(r.get("lastVisitAt") or ""), reverse=order_desc)

    trend = _qa_score_trend(rows, ref_end=end)
    out: Dict[str, Any] = {
        "machineName": machine,
        "audits": rows,
        "total": len(rows),
        "auditsSearched": audits_searched,
        "auditsProcessed": audits_processed,
        "dateFrom": start.date().isoformat(),
        "dateTo": end.date().isoformat(),
        "trend": trend,
        "source": "safetyculture",
        "chunks": len(chunks),
    }
    if search_err and not rows:
        out["error"] = search_err
    elif audits_searched > audits_processed and not rows:
        out["error"] = (
            "SafetyCulture returned more inspections than we could scan in this range. "
            "Narrow the date filter and try again."
        )
    _MACHINE_AUDITS_CACHE[cache_key] = (time.time(), out)
    return out


_FLEET_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_QC_ROWS_RANGE_CACHE: Dict[str, Tuple[float, Tuple[List[Dict[str, Any]], int, int, Optional[str]]]] = {}
_FLEET_CACHE_SEC = int(os.environ.get("SAFETY_CULTURE_QA_FLEET_CACHE_SEC", "180"))
_FLEET_MAX_DAYS = int(os.environ.get("SAFETY_CULTURE_QA_FLEET_MAX_DAYS", "180"))


def _get_qc_rows_in_range_cached(start: datetime, end: datetime) -> Tuple[List[Dict[str, Any]], int, int, Optional[str]]:
    cache_key = f"qc_rows|v2|{start.date().isoformat()}|{end.date().isoformat()}"
    hit = _QC_ROWS_RANGE_CACHE.get(cache_key)
    if hit and (time.time() - hit[0]) < _FLEET_CACHE_SEC:
        return hit[1]
    result = _build_qc_rows_in_range(start, end)
    _QC_ROWS_RANGE_CACHE[cache_key] = (time.time(), result)
    return result


def latest_qc_by_machine_map(
    machine_names: List[str],
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Latest QC visit per machine (chunked SC scan, cached by date range)."""
    names = sorted({str(n).strip() for n in machine_names if str(n).strip()})
    if not names:
        return {"byMachine": {}, "total": 0, "error": "machineNames required"}

    start, end = _resolve_qc_date_range(date_from=date_from, date_to=date_to)
    rows, audits_searched, audits_processed, search_err = _get_qc_rows_in_range_cached(start, end)
    by_machine = _latest_qc_by_machine_names(names, rows)
    out: Dict[str, Any] = {
        "byMachine": by_machine,
        "total": len(by_machine),
        "auditsSearched": audits_searched,
        "auditsProcessed": audits_processed,
        "dateFrom": start.date().isoformat(),
        "dateTo": end.date().isoformat(),
        "source": "safetyculture",
    }
    if search_err and not by_machine:
        out["error"] = search_err
    return out


def fleet_qc_visits_in_range(
    machine_names: List[str],
    *,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> Dict[str, Any]:
    """Latest QC visit per Vendon machine within a date range (single SC scan + location map)."""
    import hashlib

    names = sorted({str(n).strip() for n in machine_names if str(n).strip()})
    if not names:
        return {"byMachine": {}, "total": 0, "error": "machineNames required"}

    start, end = _resolve_qc_date_range(date_from=date_from, date_to=date_to)

    names_hash = hashlib.md5(",".join(names).encode()).hexdigest()[:12]
    cache_key = f"fleet|v5|{names_hash}|{start.date().isoformat()}|{end.date().isoformat()}"
    hit = _FLEET_CACHE.get(cache_key)
    if hit and (time.time() - hit[0]) < _FLEET_CACHE_SEC:
        return hit[1]

    rows, audits_searched, audits_processed, search_err = _get_qc_rows_in_range_cached(start, end)
    by_machine = _latest_qc_by_machine_names(names, rows)

    out: Dict[str, Any] = {
        "byMachine": by_machine,
        "total": len(by_machine),
        "auditsSearched": audits_searched,
        "auditsProcessed": audits_processed,
        "dateFrom": start.date().isoformat(),
        "dateTo": end.date().isoformat(),
        "source": "safetyculture",
    }
    if search_err and not by_machine:
        out["error"] = search_err
    _FLEET_CACHE[cache_key] = (time.time(), out)
    return out


def _item_plaintext_lines(item: Dict[str, Any], depth: int = 0) -> List[str]:
    if not isinstance(item, dict) or depth > 12:
        return []
    label = str(item.get("label") or item.get("name") or "").strip()
    resp = item.get("responses") if isinstance(item.get("responses"), dict) else {}
    answer_parts: List[str] = []
    text = resp.get("text")
    if isinstance(text, str) and text.strip():
        answer_parts.append(text.strip())
    note = resp.get("note")
    if isinstance(note, str) and note.strip():
        answer_parts.append(note.strip())
    sel = resp.get("selected")
    if isinstance(sel, list):
        for s in sel:
            if isinstance(s, dict):
                part = str(s.get("label") or s.get("name") or s.get("value") or "").strip()
                if part:
                    answer_parts.append(part)
            elif isinstance(s, str) and s.strip():
                answer_parts.append(s.strip())
    lines: List[str] = []
    if label and answer_parts:
        lines.append(f"{label}: {'; '.join(answer_parts)}")
    elif label:
        lines.append(label)
    elif answer_parts:
        lines.append("; ".join(answer_parts))
    for child_key in ("children", "items"):
        children = item.get(child_key)
        if not isinstance(children, list):
            continue
        for child in children:
            if isinstance(child, dict):
                lines.extend(_item_plaintext_lines(child, depth + 1))
    return lines


def audit_report_plaintext(audit: Dict[str, Any], *, max_chars: int = 14000) -> str:
    """Flatten SafetyCulture audit JSON into plain text for AI summarization."""
    if not isinstance(audit, dict):
        return ""
    lines: List[str] = []
    ad = audit.get("audit_data") if isinstance(audit.get("audit_data"), dict) else {}
    title = str(ad.get("title") or audit.get("name") or "").strip()
    if title:
        lines.append(f"Inspection: {title}")
    for block in (audit.get("header_items"), audit.get("items"), ad.get("items")):
        if not isinstance(block, list):
            continue
        for item in block:
            if isinstance(item, dict):
                lines.extend(_item_plaintext_lines(item))
    out = "\n".join(ln for ln in lines if ln and ln.strip())
    if len(out) > max_chars:
        return out[:max_chars] + "\n…"
    return out


def export_audit_pdf(audit_id: str) -> Tuple[Optional[bytes], Optional[str], Optional[str]]:
    """
    Export inspection PDF via SafetyCulture /inspection/v1/export.
    Returns (pdf_bytes, filename, error).
    """
    aid = (audit_id or "").strip()
    if not aid:
        return None, None, "audit_id required"
    if not _API_TOKEN:
        return None, None, "SAFETY_CULTURE_API_TOKEN not configured"

    body = {
        "export_data": [{"inspection_id": aid}],
        "type": "DOCUMENT_TYPE_PDF",
    }
    url = f"{_API_BASE}/inspection/v1/export"
    last_err: Optional[str] = None
    for attempt in range(4):
        try:
            res = requests.post(url, headers=_headers(), json=body, timeout=90)
            if res.status_code != 200:
                last_err = f"SafetyCulture export HTTP {res.status_code}: {(res.text or '')[:200]}"
                time.sleep(1.5 * (attempt + 1))
                continue
            data = res.json()
            if not isinstance(data, dict):
                last_err = "SafetyCulture export returned unexpected payload"
                continue
            status = str(data.get("status") or "")
            file_url = data.get("url")
            if status in ("STATUS_DONE", "DONE") and file_url:
                pdf_res = requests.get(str(file_url), timeout=120)
                if pdf_res.status_code != 200:
                    last_err = f"PDF download HTTP {pdf_res.status_code}"
                    continue
                ctype = (pdf_res.headers.get("content-type") or "").lower()
                if "pdf" not in ctype and len(pdf_res.content or b"") < 200:
                    last_err = "PDF download returned empty or non-PDF body"
                    continue
                fname = f"qa-report-{aid[:12]}.pdf"
                return pdf_res.content, fname, None
            if status in ("STATUS_IN_PROGRESS", "IN_PROGRESS"):
                time.sleep(2.0 * (attempt + 1))
                continue
            last_err = f"SafetyCulture export status {status or 'unknown'}"
        except Exception as ex:
            logger.exception("export_audit_pdf %s", aid)
            last_err = str(ex)
            time.sleep(1.5 * (attempt + 1))
    return None, None, last_err or "SafetyCulture export failed"
