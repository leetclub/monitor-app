#!/usr/bin/env python3
"""Test pagination for machine 325250 on 2026-01-17"""
import os
import requests
from datetime import datetime, timezone, timedelta

KUWAIT_TZ = timezone(timedelta(hours=3))
VENDON_API_KEY = os.getenv('VENDON_API_KEY')
VENDON_API_BASE = os.getenv('VENDON_API_BASE', 'https://cloud.vendon.net/rest/v1.9.0')

# 2026-01-17 in Kuwait timezone
target_date = datetime(2026, 1, 17, 0, 0, 0, tzinfo=KUWAIT_TZ)
start_dt = datetime.combine(target_date.date(), datetime.min.time(), tzinfo=KUWAIT_TZ)
end_dt = datetime.combine(target_date.date(), datetime.max.time(), tzinfo=KUWAIT_TZ)
from_timestamp = int(start_dt.timestamp())
to_timestamp = int(end_dt.timestamp())

machine_id = "325250"

print(f"Testing pagination for machine {machine_id} on 2026-01-17")
print(f"Timestamp range: {from_timestamp} to {to_timestamp}")

all_vends = []
offset = 0
limit = 10000
iteration = 0

while iteration < 10:  # Max 10 iterations
    iteration += 1
    url = f"{VENDON_API_BASE}/stats/vends"
    params = {
        'from_timestamp': from_timestamp,
        'to_timestamp': to_timestamp,
        'machine_id': machine_id,
        'limit': limit,
        'offset': offset
    }
    
    headers = {
        'Authorization': f'Token {VENDON_API_KEY}',
        'Accept': 'application/json'
    }
    
    response = requests.get(url, params=params, headers=headers, timeout=60)
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        break
    
    data = response.json()
    if data.get('code') != 200:
        print(f"API error: {data.get('code')} - {data.get('message')}")
        break
    
    vends = data.get('result', [])
    if not vends:
        break
    
    all_vends.extend(vends)
    print(f"Chunk {iteration}: {len(vends)} vends (total: {len(all_vends)})")
    
    if len(vends) < limit:
        break
    
    offset += limit

total_revenue = sum(v.get('price', 0) for v in all_vends)
print(f"\nTotal: {len(all_vends)} vends, {total_revenue:.2f} KWD")
print(f"Expected: 124.15 KWD")
print(f"Difference: {abs(total_revenue - 124.15):.2f} KWD")


