from safetyculture_qa_lib import _MIN_MACHINE_MATCH_SCORE, _audit_match_score


def test_ku_cba_short_sc_site_matches():
    assert _audit_match_score("KU CBA", "CBA") >= _MIN_MACHINE_MATCH_SCORE
    assert _audit_match_score("KU CBA", "KU CBA") >= _MIN_MACHINE_MATCH_SCORE
    assert _audit_match_score("KU CBA", "CBA Main") >= _MIN_MACHINE_MATCH_SCORE


def test_unrelated_sites_still_weak():
    assert _audit_match_score("KU CBA", "MOH Amiri") < _MIN_MACHINE_MATCH_SCORE


if __name__ == "__main__":
    test_ku_cba_short_sc_site_matches()
    test_unrelated_sites_still_weak()
    print("ok", _audit_match_score("KU CBA", "CBA"), _audit_match_score("KU CBA", "CBA Main"))
