"""Unit tests for QA audit → machine matching (no live SafetyCulture)."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from safetyculture_qa_lib import (
    _MIN_MACHINE_MATCH_SCORE,
    _audit_match_score,
    _is_machine_specific_match,
    _latest_qc_by_machine_names,
)


def _row(
    *,
    location: str,
    location_keys: list[str],
    audit_id: str,
    last_visit_at: str = "2026-07-10T12:00:00+00:00",
) -> dict:
    return {
        "location": location,
        "locationKeys": location_keys,
        "auditId": audit_id,
        "lastVisitAt": last_visit_at,
        "lastVisitDate": last_visit_at[:10],
        "visitKind": "qc",
        "score": 90.0,
    }


def test_ku_cba_short_sc_site_matches():
    assert _audit_match_score("KU CBA", "CBA") >= _MIN_MACHINE_MATCH_SCORE
    assert _audit_match_score("KU CBA", "KU CBA") >= _MIN_MACHINE_MATCH_SCORE
    assert _audit_match_score("KU CBA", "CBA Main") >= _MIN_MACHINE_MATCH_SCORE


def test_unrelated_sites_still_weak():
    assert _audit_match_score("KU CBA", "MOH Amiri") < _MIN_MACHINE_MATCH_SCORE


def test_title_boosts_machine_specific_score():
    score = _audit_match_score("MOH Amiri Gate 1 Left", "Amiri Hospital", ["Amiri Hospital", "MOH Amiri Gate 1 Left"])
    assert score >= _MIN_MACHINE_MATCH_SCORE
    assert _is_machine_specific_match(
        "MOH Amiri Gate 1 Left",
        "Amiri Hospital",
        ["Amiri Hospital", "MOH Amiri Gate 1 Left"],
        score,
    )


def test_location_only_visit_shared_across_co_located_machines():
    names = ["KU CBA", "KU CBA Left", "KU CBA Right"]
    row = _row(location="CBA", location_keys=["CBA", "QC checklist"], audit_id="audit-loc-1")
    by = _latest_qc_by_machine_names(names, [row])
    assert by["KU CBA"]["auditId"] == "audit-loc-1"
    assert by["KU CBA Left"]["auditId"] == "audit-loc-1"
    assert by["KU CBA Right"]["auditId"] == "audit-loc-1"


def test_title_specific_visit_not_shared_with_sibling():
    names = ["MOH Amiri Gate 1 Left", "MOH Amiri Gate 1 Right"]
    row = _row(
        location="Amiri Hospital",
        location_keys=["Amiri Hospital", "MOH Amiri Gate 1 Left inspection"],
        audit_id="audit-left-1",
    )
    by = _latest_qc_by_machine_names(names, [row])
    assert by["MOH Amiri Gate 1 Left"]["auditId"] == "audit-left-1"
    assert "MOH Amiri Gate 1 Right" not in by


def test_exclusive_machine_name_in_site_still_single_owner():
    names = ["KU CBA Left", "KU CBA Right"]
    row = _row(
        location="KU CBA Left",
        location_keys=["KU CBA Left", "QC visit"],
        audit_id="audit-left-site",
    )
    by = _latest_qc_by_machine_names(names, [row])
    assert by["KU CBA Left"]["auditId"] == "audit-left-site"
    assert "KU CBA Right" not in by


if __name__ == "__main__":
    test_ku_cba_short_sc_site_matches()
    test_unrelated_sites_still_weak()
    test_title_boosts_machine_specific_score()
    test_location_only_visit_shared_across_co_located_machines()
    test_title_specific_visit_not_shared_with_sibling()
    test_exclusive_machine_name_in_site_still_single_owner()
    print("ok")
