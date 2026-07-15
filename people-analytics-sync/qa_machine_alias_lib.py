"""Machine name aliases for QA manual summary counts (Vendon vs SafetyCulture names)."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from typing import FrozenSet, List, Set

_CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config")


def _apply_qa_name_typos(norm: str) -> str:
    """Fold known SC/Vendon spelling variants so QA matching stays tolerant."""
    return norm.replace("enginnering", "engineering")


def _norm_name(s: str) -> str:
    return _apply_qa_name_typos(re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip())


@lru_cache(maxsize=1)
def _alias_groups() -> List[FrozenSet[str]]:
    """Union of name groups from camera map + MOH mirror map."""
    groups: List[Set[str]] = []

    def add_cluster(names: Set[str]) -> None:
        cleaned = {n.strip() for n in names if n and str(n).strip()}
        if not cleaned:
            return
        merged: Set[str] = set(cleaned)
        for g in list(groups):
            if g & cleaned:
                merged |= g
                groups.remove(g)
        groups.append(merged)

    cam_path = os.path.join(_CONFIG_DIR, "commercial_people_camera_names.json")
    try:
        with open(cam_path, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for key, aliases in raw.items():
                if str(key).startswith("_"):
                    continue
                names = {str(key).strip()}
                if isinstance(aliases, list):
                    names |= {str(a).strip() for a in aliases if a}
                add_cluster(names)
    except Exception:
        pass

    qa_alias_path = os.path.join(_CONFIG_DIR, "qa_machine_aliases.json")
    try:
        with open(qa_alias_path, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for key, aliases in raw.items():
                if str(key).startswith("_"):
                    continue
                names = {str(key).strip()}
                if isinstance(aliases, list):
                    names |= {str(a).strip() for a in aliases if a}
                elif isinstance(aliases, str) and aliases.strip():
                    names.add(aliases.strip())
                add_cluster(names)
    except Exception:
        pass

    mirror_path = os.path.join(_CONFIG_DIR, "commercial_moh_mirror_map.json")
    try:
        with open(mirror_path, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for a, b in raw.items():
                if str(a).startswith("_"):
                    continue
                add_cluster({str(a).strip(), str(b).strip()})
    except Exception:
        pass

    return [frozenset(g) for g in groups]


@lru_cache(maxsize=256)
def _group_for_norm(norm: str) -> FrozenSet[str]:
    if not norm:
        return frozenset()
    for g in _alias_groups():
        if any(_norm_name(n) == norm for n in g):
            return g
    return frozenset()


def machine_names_for_lookup(machine_name: str) -> List[str]:
    """All display names (lower trim) that should match one QA machine."""
    needle = (machine_name or "").strip()
    if not needle:
        return []
    norm = _norm_name(needle)
    group = _group_for_norm(norm)
    if group:
        names = sorted({n.lower() for n in group})
        if needle.lower() not in names:
            names.append(needle.lower())
        return names
    return [needle.lower()]


def norm_keys_for_lookup(machine_name: str) -> Set[str]:
    """Normalized keys for aggregating fleet month-count maps."""
    keys = {_norm_name(n) for n in machine_names_for_lookup(machine_name)}
    keys.discard("")
    if not keys:
        nk = _norm_name(machine_name)
        if nk:
            keys.add(nk)
    return keys


def machines_share_qa_alias(a: str, b: str) -> bool:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ga, gb = _group_for_norm(na), _group_for_norm(nb)
    return bool(ga and ga == gb)
