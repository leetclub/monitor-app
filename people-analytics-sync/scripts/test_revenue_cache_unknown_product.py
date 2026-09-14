#!/usr/bin/env python3
"""Unit check: blank product names bucket as Unknown Product; mix sums to customer total."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

from vendon_proxy_routes import UNKNOWN_PRODUCT_NAME, _revenue_cache_machine_payload


def test_unnamed_included_in_mix() -> None:
    vends = [
        {"name": "Karak", "price": 1.0, "payment_method": "CASHLESS", "datetime": 1},
        {"name": "", "price": 2.4, "payment_method": "CASHLESS", "datetime": 2},
        {"name": None, "price": 0.8, "payment_method": "CASH", "datetime": 3},
        {"name": "Karak", "price": 1.5, "payment_method": "WEB_CASHLESS", "datetime": 4},
        {"product_name": "  ", "price": 0.5, "payment_method": "CARD", "datetime": 5},
    ]
    built = _revenue_cache_machine_payload("1", "Test", vends)
    payload = built["payload_json"]
    mix = payload["productSales"]
    mix_all = payload["productSalesAll"]
    total = round(float(built["total_sales"]), 4)
    mix_sum = round(sum(mix.values()), 4)
    assert total == 4.7, total  # 1+2.4+0.8+0.5 (excl WEB 1.5)
    assert mix_sum == total, (mix_sum, total, mix)
    assert mix[UNKNOWN_PRODUCT_NAME] == 3.7, mix  # 2.4+0.8+0.5
    assert mix["Karak"] == 1.0
    assert "Karak" not in mix or mix_all["Karak"] == 2.5  # 1.0 + WEB 1.5
    assert mix_all[UNKNOWN_PRODUCT_NAME] == 3.7
    assert payload["productSalesMeta"]["unknownProductBucket"] is True
    assert payload["productSalesMeta"]["v"] >= 4
    print("ok unnamed mix", mix, "total", total)


if __name__ == "__main__":
    test_unnamed_included_in_mix()
