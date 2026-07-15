"""Unit tests for SafetyCulture search pagination (no live API)."""
from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import safetyculture_qa_lib as sc


def _page(audits: List[Dict[str, Any]], *, total: int) -> MagicMock:
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = {"count": len(audits), "total": total, "audits": audits}
    res.text = ""
    return res


def test_search_uses_desc_limit_and_returns_newest_ids():
    """Default SC page is oldest-100; we must request order=desc + limit=100."""
    audits = [
        {"audit_id": "audit_new", "modified_at": "2026-07-14T09:09:57.574Z"},
        {"audit_id": "audit_mid", "modified_at": "2026-07-10T12:00:00.000Z"},
        {"audit_id": "audit_old", "modified_at": "2026-07-01T10:36:42.120Z"},
    ]
    with patch.object(sc, "_API_TOKEN", "test-token"), patch("safetyculture_qa_lib.requests.get") as get:
        get.return_value = _page(audits, total=3)
        ids, err = sc._search_audit_ids("2026-06-01T00:00:00.000Z", "2026-07-14T23:59:59.000Z")
    assert err is None
    assert ids == ["audit_new", "audit_mid", "audit_old"]
    assert get.call_count == 1
    url = get.call_args[0][0]
    assert "order=desc" in url
    assert "limit=100" in url
    assert "next_page_token" not in url


def test_search_paginates_when_sc_caps_page_at_100():
    """SC returns count=100 even when limit=1000 and total>100 — keep paginating."""
    page1 = [
        {"audit_id": f"audit_p1_{i}", "modified_at": f"2026-07-14T{10 - i:02d}:00:00.000Z"}
        for i in range(100)
    ]
    page2 = [
        {"audit_id": f"audit_p2_{i}", "modified_at": f"2026-07-01T{10 - i:02d}:00:00.000Z"}
        for i in range(50)
    ]
    responses = [_page(page1, total=150), _page(page2, total=150)]

    with patch.object(sc, "_API_TOKEN", "test-token"), patch("safetyculture_qa_lib.requests.get", side_effect=responses) as get:
        ids, err = sc._search_audit_ids("2026-06-01T00:00:00.000Z", "2026-07-14T23:59:59.000Z")

    assert err is None
    assert len(ids) == 150
    assert "audit_p2_0" in ids
    assert get.call_count == 2


def test_search_paginates_when_total_exceeds_page():
    """Simulate two desc pages by advancing modified_before to the oldest on page 1."""
    page1 = [
        {"audit_id": f"audit_n{i}", "modified_at": f"2026-07-14T{10 - i:02d}:00:00.000Z"}
        for i in range(3)
    ]
    # oldest on page1 → 2026-07-14T08:00:00.000Z
    page2 = [
        {"audit_id": "audit_older", "modified_at": "2026-07-01T10:36:42.120Z"},
    ]
    responses = [_page(page1, total=4), _page(page2, total=4)]

    with patch.object(sc, "_API_TOKEN", "test-token"), patch.object(
        sc, "_SEARCH_PAGE_LIMIT", 3
    ), patch("safetyculture_qa_lib.requests.get", side_effect=responses) as get:
        ids, err = sc._search_audit_ids("2026-06-01T00:00:00.000Z", "2026-07-14T23:59:59.000Z")

    assert err is None
    assert ids[0] == "audit_n0"
    assert "audit_older" in ids
    assert get.call_count == 2
    second_url = get.call_args_list[1][0][0]
    assert "modified_before=" in second_url
    assert "2026-07-14T08%3A00%3A00.000Z" in second_url or "2026-07-14T08:00:00.000Z" in second_url


def test_ku_cba_short_sc_site_still_matches():
    assert sc._audit_match_score("KU CBA", "CBA") >= sc._MIN_MACHINE_MATCH_SCORE
    assert sc._audit_match_score("KU CBA", "KU CBA") >= sc._MIN_MACHINE_MATCH_SCORE


if __name__ == "__main__":
    test_search_uses_desc_limit_and_returns_newest_ids()
    test_search_paginates_when_total_exceeds_page()
    test_ku_cba_short_sc_site_still_matches()
    print("ok")
