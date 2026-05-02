# Vendon Sync Monitoring Guide

## Overview

This document explains how to monitor the vendon-sync cronjob to ensure it always gets correct results.

## Protection Mechanisms

### 1. **Date Validation in Sync Code**

The sync service now includes built-in validation that prevents syncing today's data:

```python
# In sync_service.py
if date == today_kuwait:
    logger.error(f"❌ CRITICAL: Attempting to sync TODAY ({date})! This should never happen.")
```

**What it does:**
- Checks if the calculated date equals today
- Logs a critical error if it tries to sync today
- The sync will still run, but the error will be visible in logs

**How to check:**
```bash
kubectl logs -n leet-monitor job/vendon-sales-sync-<job-id> | grep "CRITICAL"
```

### 2. **Automated Verification Cronjob**

A verification cronjob runs **30 minutes after each sync** (at 2:30 AM UTC) to verify the results.

**What it checks:**
1. ✅ Date is not today (should be yesterday)
2. ✅ Sync logs show success status
3. ✅ Data completeness (machines synced, revenue totals)
4. ✅ Sample verification against Vendon API (compares database vs API for one machine)

**View verification results:**
```bash
# List verification jobs
kubectl get jobs -n leet-monitor | grep vendon-sync-verify

# View latest verification logs
kubectl logs -n leet-monitor job/vendon-sync-verify-<job-id>
```

**If verification fails:**
- The job will exit with code 1
- Check the logs to see which check failed
- Investigate the specific issue

### 3. **Enhanced Logging**

The sync now includes detailed logging:

- `📊 Machine {id} on {date}: fetched X vends, revenue=Y KWD, transactions=Z`
- `✅ Stored: machine {id} ({name}) on {date}: Y KWD, Z transactions`
- `⚠️ Machine {id} on {date}: Got exactly 10000 vends (limit reached)` - warns about pagination issues

**Monitor logs:**
```bash
# View sync logs
kubectl logs -n leet-monitor job/vendon-sales-sync-<job-id> | grep -E "(📊|✅|⚠️|❌)"
```

## Manual Verification

### Run Verification Script Manually

```bash
# Verify yesterday's data (default)
kubectl run -it --rm verify-test \
  --image=programmeradmin25/people-analytics-sync:latest \
  --restart=Never \
  -n leet-monitor \
  --env="DB_HOST=..." \
  --env="DB_PASSWORD=..." \
  --env="VENDON_API_KEY=..." \
  -- sh -c "cd /app/vendon-sync && python verify_sync_results.py"

# Verify specific date
kubectl run -it --rm verify-test \
  --image=programmeradmin25/people-analytics-sync:latest \
  --restart=Never \
  -n leet-monitor \
  --env="DB_HOST=..." \
  --env="DB_PASSWORD=..." \
  --env="VENDON_API_KEY=..." \
  -- sh -c "cd /app/vendon-sync && python verify_sync_results.py 2026-01-24"
```

### Check Database Directly

```bash
# Check what date was last synced
kubectl exec -n leet-monitor vendon-sales-api-f55cfc9ff-qcjq8 -- python3 << 'EOF'
import os
from sqlalchemy import create_engine, text
from datetime import datetime, timezone, timedelta

KUWAIT_TZ = timezone(timedelta(hours=3))
now_kuwait = datetime.now(KUWAIT_TZ).date()
yesterday = (now_kuwait - timedelta(days=1)).date()

db_url = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}?sslmode=require"
engine = create_engine(db_url)

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT DATE(sale_date) as date, COUNT(*) as records, 
               SUM(total_revenue) as total_revenue
        FROM vendon_sales_records
        WHERE DATE(sale_date) >= :yesterday
        GROUP BY DATE(sale_date)
        ORDER BY date DESC
        LIMIT 3
    """), {"yesterday": yesterday})
    
    for row in result:
        print(f"Date: {row.date}, Records: {row.records}, Revenue: {row.total_revenue:.2f} KWD")
        if row.date == now_kuwait:
            print("  ❌ WARNING: Today's data found in database!")
        elif row.date == yesterday:
            print("  ✅ Correct: Yesterday's data")
EOF
```

## Monitoring Checklist

After each sync, verify:

1. **Date Check:**
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "Calculated dates to sync"
   ```
   Should show yesterday's date, NOT today

2. **Sync Success:**
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "Successfully synced"
   ```

3. **No Critical Errors:**
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "CRITICAL"
   ```
   Should return nothing

4. **Verification Job:**
   ```bash
   kubectl logs -n leet-monitor job/vendon-sync-verify-<id>
   ```
   Should show "✅ All verifications passed"

## Alerting (Future Enhancement)

To add Slack/email alerts when verification fails:

1. Add a webhook notification in `verify_sync_results.py`
2. Or use Kubernetes events:
   ```bash
   kubectl get events -n leet-monitor --field-selector involvedObject.name=vendon-sync-verify
   ```

## Troubleshooting

### Issue: Sync is syncing today instead of yesterday

**Check:**
1. Verify the code fix is deployed:
   ```bash
   kubectl get cronjob -n leet-monitor vendon-sales-sync -o yaml | grep imagePullPolicy
   ```
   Should be `Always` to pull latest image

2. Check logs for date calculation:
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "Calculated dates"
   ```

3. If still wrong, check the running code:
   ```bash
   kubectl exec -n leet-monitor <pod-name> -- cat /app/vendon-sync/sync_service.py | grep "range(1, days_back"
   ```

### Issue: Verification fails

**Check which test failed:**
- Date check: Date might be today (should never happen)
- Sync logs: Check if sync actually completed
- Data completeness: Might be a holiday (0 revenue is normal)
- API verification: Database vs API mismatch (investigate specific machine)

### Issue: Missing data for a machine

**Check:**
1. Did the sync fetch data?
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "machine_id=<id>"
   ```

2. Was pagination limit hit?
   ```bash
   kubectl logs -n leet-monitor job/vendon-sales-sync-<id> | grep "limit reached"
   ```

3. Check database directly:
   ```bash
   # Use check_db.py script
   ```

## Summary

With these monitoring mechanisms in place:

1. ✅ **Code validation** prevents syncing today
2. ✅ **Automated verification** runs after each sync
3. ✅ **Enhanced logging** makes issues visible
4. ✅ **Manual verification** available on demand

The cron should now **always get correct results**, and if it doesn't, you'll know immediately through:
- Critical error logs
- Failed verification jobs
- Manual verification checks
