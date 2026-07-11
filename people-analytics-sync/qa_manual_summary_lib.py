"""Manual QA visit summaries — bullet validation and Kuwait-month helpers."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import text

KW_TZ = ZoneInfo("Asia/Kuwait")
_BULLET_PREFIX = re.compile(r"^(\s*)([-•*]|\d+[\.\)])\s+\S")


def validate_bullet_summary(text: str) -> Tuple[bool, Optional[str]]:
    """Require non-empty text where every non-blank line is a bullet."""
    raw = (text or "").strip()
    if not raw:
        return False, "Summary is required"
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return False, "Summary is required"
    for ln in lines:
        if not _BULLET_PREFIX.match(ln):
            return False, "Each line must start with a bullet (-, •, *, or 1. / 1))"
    if len(lines) < 3:
        return False, "Enter at least 3 bullet points"
    if len(lines) > 5:
        return False, "At most 5 bullet points"
    return True, None


def parse_bullet_lines(text: str) -> List[str]:
    """Strip bullet markers from each line for display."""
    out: List[str] = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        s = re.sub(r"^[-•*]\s*", "", s)
        s = re.sub(r"^\d+[\.\)]\s*", "", s)
        s = s.strip()
        if s:
            out.append(s)
    return out


def kuwait_year_month(now: Optional[datetime] = None) -> str:
    dt = (now or datetime.now(KW_TZ)).astimezone(KW_TZ)
    return dt.strftime("%Y-%m")


def _normalize_machine_name(name: str) -> str:
    return (name or "").strip()


def month_count_sql() -> str:
    """SQL fragment: count rows for machine in current Kuwait calendar month."""
    return """
        SELECT COUNT(*)::int
        FROM qa_manual_summary
        WHERE lower(trim(machine_name)) = lower(trim(:machine_name))
          AND to_char(created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
              = to_char(NOW() AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
    """


def month_count_for_machine(db, machine_name: str) -> int:
    """Count saves this Kuwait month across Vendon/SC alias names."""
    from qa_machine_alias_lib import machine_names_for_lookup

    names = machine_names_for_lookup(machine_name)
    if not names:
        return 0
    return int(
        db.execute(
            text(
                """
                SELECT COUNT(*)::int
                FROM qa_manual_summary
                WHERE lower(trim(machine_name)) = ANY(:names)
                  AND to_char(created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
                      = to_char(NOW() AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
                """
            ),
            {"names": names},
        ).scalar()
        or 0
    )


def machine_name_filter_sql() -> str:
    """WHERE fragment matching any alias for :machine_name."""
    return "lower(trim(machine_name)) = ANY(:names)"


def norm_machine_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def admin_summary_month_counts(db) -> Dict[str, int]:
    """All machines → admin summary save count in the current Kuwait calendar month."""
    rows = db.execute(
        text(
            """
            SELECT machine_name, COUNT(*)::int AS cnt
            FROM qa_manual_summary
            WHERE to_char(created_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
                = to_char(NOW() AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM')
            GROUP BY machine_name
            """
        )
    ).fetchall()
    out: Dict[str, int] = {}
    for r in rows:
        nk = norm_machine_key(str(r.machine_name or ""))
        if nk:
            out[nk] = out.get(nk, 0) + int(r.cnt)
    return out


def admin_summary_mtd_for_machine(machine_name: str, counts: Dict[str, int]) -> int:
    from qa_machine_alias_lib import norm_keys_for_lookup

    if not counts:
        return 0
    keys = norm_keys_for_lookup(machine_name)
    if keys:
        total = sum(int(counts.get(k, 0) or 0) for k in keys)
        if total > 0:
            return total
    needle = norm_machine_key(machine_name)
    if not needle:
        return 0
    if needle in counts:
        return int(counts[needle])
    best = 0
    best_len = 0
    for mk, cnt in counts.items():
        if needle in mk or mk in needle:
            ln = min(len(needle), len(mk))
            if ln > best_len:
                best_len = ln
                best = int(cnt)
    return best


def enrich_qc_visits_with_admin_summaries(
    by_location_key: Dict[str, Dict[str, Any]],
    db,
    *,
    now: Optional[datetime] = None,
) -> Dict[str, Dict[str, Any]]:
    """
    Attach latest admin manual QA summary metadata to existing SafetyCulture rows.
    Never overwrites SC visit fields (lastVisitAt, officerName, auditId, score).
    """
    from dashboard_access_models import QaManualSummary
    from qa_machine_alias_lib import norm_keys_for_lookup

    _ = now  # reserved for tests
    out = dict(by_location_key or {})
    rows = (
        db.query(QaManualSummary)
        .order_by(QaManualSummary.created_at.desc())
        .limit(5000)
        .all()
    )
    latest_admin: Dict[str, Tuple[str, str]] = {}
    for row in rows:
        if not row.created_at:
            continue
        saved_at = row.created_at
        if saved_at.tzinfo is None:
            saved_at = saved_at.replace(tzinfo=timezone.utc)
        saved_iso = saved_at.isoformat()
        loc = str(row.machine_name or "").strip()
        if not loc:
            continue
        for nk in norm_keys_for_lookup(loc):
            prev_at = latest_admin.get(nk, ("", ""))[0]
            if saved_iso > prev_at:
                latest_admin[nk] = (saved_iso, str(row.created_by or ""))

    for nk, (saved_iso, saved_by) in latest_admin.items():
        prev = out.get(nk)
        if not prev or not isinstance(prev, dict):
            continue
        merged = dict(prev)
        merged["adminSummary"] = True
        merged["adminSummaryAt"] = saved_iso
        merged["adminSummaryBy"] = saved_by
        out[nk] = merged
    return out
