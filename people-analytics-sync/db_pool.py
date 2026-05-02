"""Lightweight psycopg2 access to monitoring_dashboard for attendance_snapshot_cache."""

from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
from typing import Iterator

import psycopg2


def _dsn() -> str:
    ov = (os.environ.get('ATTENDANCE_SNAPSHOT_DATABASE_URL') or '').strip()
    if ov:
        return ov
    try:
        from dashboard_access_models import get_dashboard_database_url

        return get_dashboard_database_url()
    except Exception:
        pass
    return (
        (os.environ.get('PEOPLE_API_DATABASE_URL') or '').strip()
        or (os.environ.get('DATABASE_URL') or '').strip()
    )


@contextmanager
def get_conn() -> Iterator[psycopg2.extensions.connection]:
    dsn = _dsn()
    if not dsn:
        raise RuntimeError(
            'No DB URL for attendance snapshot (set ATTENDANCE_SNAPSHOT_DATABASE_URL or '
            'dashboard DB vars DASHBOARD_DB_NAME / DB_HOST / DB_USER / DB_PASSWORD)'
        )
    conn = psycopg2.connect(dsn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def cache_key(start_date: str, end_date: str, machine_id: str) -> str:
    mid = (machine_id or '').strip()
    raw = f'{start_date}|{end_date}|{mid}'.encode('utf-8')
    return hashlib.sha256(raw).hexdigest()
