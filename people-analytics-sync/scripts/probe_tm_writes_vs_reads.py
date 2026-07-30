#!/usr/bin/env python3
"""Compare working Task Manager read APIs vs new write APIs (Live)."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

BASE = (os.environ.get("LEET_WORKFLOW_API_BASE") or "https://workflow.theleetclub.com").rstrip("/")
KEY = (os.environ.get("LEET_WORKFLOW_API_KEY") or os.environ.get("TASK_MANAGER_API_KEY") or "").strip()
TIMEOUT = 30


def headers(extra=None):
    h = {"Accept": "application/json", "X-Api-Key": KEY}
    if extra:
        h.update(extra)
    return h


def show(label, res):
    body = (res.text or "").replace("\n", " ")[:400]
    print(f"{label} -> {res.status_code} {body}")


def main():
    print("=== CONFIG ===")
    print("BASE", BASE)
    print("KEY", "yes" if KEY else "NO")
    if not KEY:
        sys.exit(2)

    print("\n=== READ APIs (expected working) ===")
    r = requests.get(f"{BASE}/api/v1/schedule-periods", headers=headers(), params={"active": "true", "per_page": 1}, timeout=TIMEOUT)
    show("GET schedule-periods?active=true", r)
    period = (r.json().get("data") or [None])[0] if r.ok else None
    if not period:
        print("Cannot continue without period")
        sys.exit(1)
    pid = period["id"]
    r = requests.get(f"{BASE}/api/v1/schedule-periods/{pid}", headers=headers(), timeout=TIMEOUT)
    show(f"GET schedule-periods/{pid}", r)
    detail = r.json().get("data") if r.ok else {}
    detail = detail if isinstance(detail, dict) else {}

    # pick operator + machine
    es = None
    for row in detail.get("employee_schedules") or []:
        if row.get("position_type") == "operator" and isinstance(row.get("user"), dict) and row["user"].get("id"):
            es = row
            break
    if not es:
        for row in detail.get("employee_schedules") or []:
            if isinstance(row.get("user"), dict) and row["user"].get("id"):
                es = row
                break
    if not es:
        print("no employee schedule with user")
        sys.exit(1)

    uid = int(es["user"]["id"])
    uname = es["user"].get("name")
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
    mid_internal = (vm or {}).get("id")
    print(f"operator={uname!r} user_id={uid} vendon_id={vid} machine_id={mid_internal}")

    today = datetime.now(ZoneInfo("Asia/Kuwait")).date().isoformat()
    r = requests.get(f"{BASE}/api/v1/attendance/users/{uid}", headers=headers(), params={"date": today}, timeout=TIMEOUT)
    show(f"GET attendance/users/{uid}?date={today}", r)

    r = requests.get(
        f"{BASE}/api/v1/attendance/users/{uid}/days",
        headers=headers(),
        params={"from": today, "until": today},
        timeout=TIMEOUT,
    )
    show(f"GET attendance/users/{uid}/days", r)

    r = requests.get(
        f"{BASE}/api/v1/daily-checks",
        headers=headers(),
        params={"all": "true", "date": today, "vendon_id": vid},
        timeout=TIMEOUT,
    )
    show(f"GET daily-checks?date={today}&vendon_id={vid}", r)
    checks = (r.json().get("data") or []) if r.ok else []
    if checks and isinstance(checks[0], dict) and checks[0].get("id") is not None:
        cid = checks[0]["id"]
        r = requests.get(f"{BASE}/api/v1/daily-checks/{cid}", headers=headers(), timeout=TIMEOUT)
        show(f"GET daily-checks/{cid}", r)

    r = requests.get(
        f"{BASE}/api/v1/quality-control",
        headers=headers(),
        params={"vendon_id": vid, "all": "true"},
        timeout=TIMEOUT,
    )
    show(f"GET quality-control?vendon_id={vid}&all=true", r)

    # auth sanity
    print("\n=== AUTH SANITY ===")
    r = requests.get(f"{BASE}/api/v1/schedule-periods", headers={"Accept": "application/json"}, params={"active": "true"}, timeout=TIMEOUT)
    show("GET schedule-periods NO KEY", r)
    r = requests.get(
        f"{BASE}/api/v1/schedule-periods",
        headers={"Accept": "application/json", "Authorization": f"Bearer {KEY}"},
        params={"active": "true", "per_page": 1},
        timeout=TIMEOUT,
    )
    show("GET schedule-periods Bearer", r)

    print("\n=== WRITE APIs (failing?) ===")
    kwt = ZoneInfo("Asia/Kuwait")
    now = datetime.now(kwt)
    due = now + timedelta(hours=24)
    urgent_body = {
        "title": "GO CHECK probe",
        "user_id": uid,
        "vendon_id": int(vid) if str(vid).isdigit() else vid,
        "message": "Leet Alert probe — ignore/delete",
        "due_time": due.strftime("%H:%M"),
        "start_date": now.date().isoformat(),
        "end_date": due.date().isoformat(),
    }
    variants = [
        ("urgent JSON X-Api-Key", "/api/v1/tasks/urgent-operator", urgent_body, {"Content-Type": "application/json"}),
        (
            "urgent JSON Bearer",
            "/api/v1/tasks/urgent-operator",
            urgent_body,
            {"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
        ),
        (
            "urgent vendon_id string",
            "/api/v1/tasks/urgent-operator",
            {**urgent_body, "vendon_id": str(vid)},
            {"Content-Type": "application/json"},
        ),
        (
            "urgent with machine_id only",
            "/api/v1/tasks/urgent-operator",
            {
                "title": urgent_body["title"],
                "user_id": uid,
                "machine_id": mid_internal or vid,
                "message": urgent_body["message"],
                "start_date": urgent_body["start_date"],
                "end_date": urgent_body["end_date"],
                "due_time": urgent_body["due_time"],
            },
            {"Content-Type": "application/json"},
        ),
        (
            "urgent no due_time",
            "/api/v1/tasks/urgent-operator",
            {k: v for k, v in urgent_body.items() if k != "due_time"},
            {"Content-Type": "application/json"},
        ),
        (
            "DM JSON",
            "/api/v1/direct-messages",
            {"user_id": uid, "message": "Leet Alert DM probe — ignore"},
            {"Content-Type": "application/json"},
        ),
        (
            "cleaning-overdue JSON",
            "/api/v1/notifications/cleaning-overdue",
            {"user_id": uid, "vendon_id": int(vid) if str(vid).isdigit() else vid, "overdue_date": today},
            {"Content-Type": "application/json"},
        ),
        (
            "cleaning-overdue machine_id",
            "/api/v1/notifications/cleaning-overdue",
            {"user_id": uid, "machine_id": mid_internal or vid, "overdue_date": today},
            {"Content-Type": "application/json"},
        ),
    ]

    for label, path, body, extra in variants:
        # For Bearer variant, omit duplicate X-Api-Key confusion? keep both as docs allow either
        hh = headers(extra)
        if "Bearer" in label:
            hh = {"Accept": "application/json", "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
        res = requests.post(f"{BASE}{path}", headers=hh, json=body, timeout=TIMEOUT)
        show(f"POST {label}", res)
        # print response headers that might help
        if res.status_code >= 500:
            print("  x-request-id:", res.headers.get("x-request-id") or res.headers.get("X-Request-Id") or "-")
            print("  content-type:", res.headers.get("content-type"))

    # multipart form for urgent (no file)
    print("\n=== WRITE multipart (no attachment) ===")
    form = {
        "title": "GO CHECK probe multipart",
        "user_id": str(uid),
        "vendon_id": str(vid),
        "message": "Leet Alert multipart probe — ignore",
        "start_date": urgent_body["start_date"],
        "end_date": urgent_body["end_date"],
        "due_time": urgent_body["due_time"],
    }
    res = requests.post(
        f"{BASE}/api/v1/tasks/urgent-operator",
        headers={"Accept": "application/json", "X-Api-Key": KEY},
        data=form,
        timeout=TIMEOUT,
    )
    show("POST urgent multipart/form-data", res)

    # OPTIONS / route existence
    print("\n=== ROUTE EXISTENCE ===")
    for path in (
        "/api/v1/tasks/urgent-operator",
        "/api/v1/direct-messages",
        "/api/v1/notifications/cleaning-overdue",
        "/api/v1/quality-control",
        "/api/v1/daily-checks",
    ):
        try:
            res = requests.options(f"{BASE}{path}", headers=headers(), timeout=TIMEOUT)
            show(f"OPTIONS {path}", res)
        except Exception as ex:
            print(f"OPTIONS {path} ERR {ex}")
        res = requests.get(f"{BASE}{path}", headers=headers(), timeout=TIMEOUT)
        show(f"GET {path} (no/extra params)", res)


if __name__ == "__main__":
    main()
