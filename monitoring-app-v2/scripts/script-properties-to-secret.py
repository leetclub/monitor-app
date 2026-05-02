#!/usr/bin/env python3
"""
Parse Google Apps Script 'Script properties' dump (Property / Value blocks) and
emit a Kubernetes Secret manifest (data: base64) on stdout. Stdlib only.
"""
from __future__ import annotations

import base64
import json
import re
import sys
from typing import Dict

# Keys we store in monitoring-app-v2-secrets (omit large non-secret JSON state).
SKIP_KEYS = frozenset(
    {
        "BASELINE_BUILD_STATE",
        "ACCESS_PERMISSIONS_LAST_UI_SAVE",
        "last_cache_clear",
        "DASHBOARD_ACCESS_API_URL",
        "PEOPLE_ANALYTICS_API_BASE",
    }
)


def parse_script_properties(text: str) -> Dict[str, str]:
    lines = text.splitlines()
    props: Dict[str, str] = {}
    i = 0
    while i < len(lines):
        if lines[i].strip() == "Property" and i + 2 < len(lines):
            key = lines[i + 1].strip()
            if lines[i + 2].strip() != "Value":
                i += 1
                continue
            i += 3
            val_lines: list[str] = []
            while i < len(lines) and lines[i].strip() != "Property":
                val_lines.append(lines[i])
                i += 1
            props[key] = "\n".join(val_lines).strip()
        else:
            i += 1
    return props


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "env"
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    props = parse_script_properties(raw)
    filtered = {k: v for k, v in props.items() if k not in SKIP_KEYS and v}
    data = {
        k: base64.b64encode(v.encode("utf-8")).decode("ascii")
        for k, v in filtered.items()
    }
    secret = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {"name": "monitoring-app-v2-secrets", "namespace": "leet-monitor"},
        "type": "Opaque",
        "data": data,
    }
    sys.stdout.write(json.dumps(secret))


if __name__ == "__main__":
    main()
