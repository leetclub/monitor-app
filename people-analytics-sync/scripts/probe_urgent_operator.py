#!/usr/bin/env python3
"""Probe POST /api/v1/tasks/urgent-operator using pod env."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

base = (os.environ.get("LEET_WORKFLOW_API_BASE") or "").rstrip("/")
key = (os.environ.get("LEET_WORKFLOW_API_KEY") or os.environ.get("TASK_MANAGER_API_KEY") or "").strip()
print("BASE", base or "(empty)", "KEY", "yes" if key else "no")
if not base or not key:
    sys.exit(2)

h = {"X-Api-Key": key, "Accept": "application/json", "Content-Type": "application/json"}
r = requests.get(f"{base}/api/v1/schedule-periods", headers=h, params={"active": "true", "per_page": 1}, timeout=30)
print("schedule-periods", r.status_code)
period = (r.json().get("data") or [None])[0] if r.ok else None
if not period:
    print("no period")
    sys.exit(1)
pid = period["id"]
d = requests.get(f"{base}/api/v1/schedule-periods/{pid}", headers=h, timeout=30).json().get("data") or {}
es = None
for row in d.get("employee_schedules") or []:
    if row.get("position_type") == "operator" and isinstance(row.get("user"), dict) and row["user"].get("id"):
        es = row
        break
if not es:
    print("no operator schedule")
    sys.exit(1)
uid = es["user"]["id"]
name = es["user"].get("name")
vm = None
for day in (es.get("schedule") or {}).values():
    if isinstance(day, dict):
        for m in day.get("vendon_machines") or []:
            if isinstance(m, dict) and (m.get("vendon_id") or m.get("id")):
                vm = m
                break
    if vm:
        break
if not vm and isinstance(es.get("vendon_machine"), dict):
    vm = es["vendon_machine"]
vid = str((vm or {}).get("vendon_id") or (vm or {}).get("id") or "")
print("operator", name, "user_id", uid, "vendon_id", vid)
kwt = ZoneInfo("Asia/Kuwait")
now = datetime.now(kwt)
due = now + timedelta(hours=24)
body = {
    "title": "GO CHECK probe (safe delete)",
    "user_id": uid,
    "vendon_id": int(vid) if vid.isdigit() else vid,
    "message": "Leet Alert probe — ignore / delete",
    "due_time": due.strftime("%H:%M"),
    "start_date": now.date().isoformat(),
    "end_date": due.date().isoformat(),
}
url = f"{base}/api/v1/tasks/urgent-operator"
print("POST", url)
print("body", body)
res = requests.post(url, headers=h, json=body, timeout=30)
print("status", res.status_code)
print((res.text or "")[:1200])
