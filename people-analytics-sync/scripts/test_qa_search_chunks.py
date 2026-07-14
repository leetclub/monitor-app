"""Unit tests for SafetyCulture QA search chunking (no API token required)."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from safetyculture_qa_lib import _iter_adaptive_search_chunks, _iter_date_chunks


class TestQaSearchChunks(unittest.TestCase):
    def test_recent_window_uses_short_chunks(self) -> None:
        now = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
        mod_end = now + timedelta(hours=6)
        mod_start = now - timedelta(days=35)
        chunks = _iter_adaptive_search_chunks(mod_start, mod_end, now=now)
        self.assertGreaterEqual(len(chunks), 5)
        # Newest chunk should end near mod_end and span at most 5 days.
        newest_start, newest_end = chunks[0]
        self.assertEqual(newest_end, mod_end)
        self.assertLessEqual((newest_end - newest_start).days, 4)

    def test_older_history_uses_wider_chunks(self) -> None:
        now = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)
        mod_end = now + timedelta(hours=6)
        mod_start = now - timedelta(days=90)
        chunks = _iter_adaptive_search_chunks(mod_start, mod_end, now=now)
        recent_floor = now - timedelta(days=21)
        older = [(s, e) for s, e in chunks if e < recent_floor]
        self.assertTrue(older)
        span_days = (older[0][1] - older[0][0]).days
        self.assertGreaterEqual(span_days, 10)

    def test_iter_date_chunks_newest_first(self) -> None:
        start = datetime(2026, 6, 1, tzinfo=timezone.utc)
        end = datetime(2026, 7, 14, tzinfo=timezone.utc)
        chunks = _iter_date_chunks(start, end, chunk_days=7)
        self.assertEqual(chunks[0][1], end)
        self.assertLessEqual(chunks[0][0], chunks[0][1])
        covered_start = min(s for s, _ in chunks)
        self.assertLessEqual(covered_start, start + timedelta(days=1))


if __name__ == "__main__":
    unittest.main()
