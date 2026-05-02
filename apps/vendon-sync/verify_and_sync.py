#!/usr/bin/env python3
"""
Verify data accuracy and check sync status
"""
import requests
import json
import os
from datetime import datetime, timedelta

VENDON_API_KEY = "7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD"
VENDON_API_BASE = "https://cloud.vendon.net/rest/v1.9.0"
CACHED_API_BASE = "https://vendon-api.theleetclub.com"

def get_machine_count():
    """Get total number of machines from Vendon"""
    url = f"{VENDON_API_BASE}/machine"
    headers = {"Authorization": f"Token {VENDON_API_KEY}"}
    try:
        response = requests.get(url, headers=headers, timeout=30)
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 200:
                machines = data.get('result', [])
                return len(machines)
    except Exception as e:
        print(f"Error getting machines: {e}")
    return 0

def verify_machine_data(machine_id, date_str):
    """Verify machine data from Vendon API"""
    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
    start_ts = int(date_obj.timestamp())
    end_ts = int((date_obj + timedelta(days=1)).timestamp()) - 1
    
    url = f"{VENDON_API_BASE}/stats/vends"
    params = {
        'from_timestamp': start_ts,
        'to_timestamp': end_ts,
        'machine_id': machine_id,
        'limit': 10000
    }
    headers = {"Authorization": f"Token {VENDON_API_KEY}"}
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 200:
                vends = data.get('result', [])
                revenue = sum(v.get('price', 0) for v in vends)
                return {
                    'revenue': revenue,
                    'transactions': len(vends),
                    'vends': vends
                }
    except Exception as e:
        print(f"Error verifying machine {machine_id}: {e}")
    return None

def check_cached_api():
    """Check cached API status"""
    url = f"{CACHED_API_BASE}/api/vendon-sales/lowest-yesterday"
    try:
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        print(f"Error checking cached API: {e}")
    return None

def main():
    print("=" * 60)
    print("🔍 Verifying Data Accuracy and Sync Status")
    print("=" * 60)
    print()
    
    # 1. Get total machines from Vendon
    print("📊 Step 1: Getting total machines from Vendon...")
    total_machines = get_machine_count()
    print(f"   ✅ Total machines in Vendon: {total_machines}")
    print()
    
    # 2. Check cached API
    print("📡 Step 2: Checking cached API...")
    cached_data = check_cached_api()
    if cached_data:
        if cached_data.get('lowestMachine'):
            lowest = cached_data['lowestMachine']
            print(f"   ✅ Lowest machine in cache: {lowest.get('machineId')}")
            print(f"      Revenue: {lowest.get('revenue', 0):.2f} KWD")
            print(f"      Date: {lowest.get('date')}")
        print(f"   📊 Total machines in cache: {cached_data.get('totalMachines', 0)}")
    print()
    
    # 3. Verify specific machine (393033 - Sultan Hamra)
    print("🔍 Step 3: Verifying machine 393033 (Sultan Hamra) for 2026-01-16...")
    vendon_data = verify_machine_data("393033", "2026-01-16")
    if vendon_data:
        print(f"   ✅ Vendon API data:")
        print(f"      Revenue: {vendon_data['revenue']:.2f} KWD")
        print(f"      Transactions: {vendon_data['transactions']}")
        print()
        print(f"   💡 If DB shows 0.0 KWD and Vendon shows {vendon_data['revenue']:.2f} KWD,")
        print(f"      then the DB data is INCORRECT and needs resync.")
    else:
        print("   ❌ Failed to get data from Vendon API")
    print()
    
    # 4. Summary
    print("=" * 60)
    print("📋 Summary:")
    print(f"   • Total machines in Vendon: {total_machines}")
    print(f"   • Machines in cached DB: {cached_data.get('totalMachines', 0) if cached_data else 'unknown'}")
    if total_machines > 0 and cached_data:
        missing = total_machines - cached_data.get('totalMachines', 0)
        if missing > 0:
            print(f"   ⚠️  Missing {missing} machines in database!")
            print(f"   💡 This is because sync only got machines with recent activity.")
            print(f"   💡 The fix is deployed but needs a new sync job to run.")
    print("=" * 60)

if __name__ == "__main__":
    main()

