# Fix Required: Docker Image Missing vendon-sync Code

## Problem

The sync job is failing with:
```
python: can't open file '/app/vendon-sync/sync_service.py': [Errno 2] No such file or directory
```

The Docker image `programmeradmin25/people-analytics-sync:latest` doesn't contain the `vendon-sync/` directory.

## Solution Options

### Option 1: Rebuild Docker Image (Recommended)

The `people-analytics-sync` Docker image needs to include the `vendon-sync/` directory.

1. Check the Dockerfile location
2. Ensure it copies `vendon-sync/` directory
3. Rebuild and push the image

### Option 2: Use ConfigMap (Temporary Workaround)

Mount the sync code via ConfigMap (like we did for manual testing).

### Option 3: Separate Docker Image

Create a separate `vendon-sync` Docker image and update the cronjob to use it.

## Current Status

- ✅ Code is fixed (uses `/machine` endpoint to get ALL machines)
- ✅ Database tables exist
- ❌ Docker image doesn't have the code
- ❌ Sync job failing
- ❌ Only 37/62 machines in database
- ❌ Data is inaccurate (e.g., machine 393033 shows 0.0 but should be 4.80 KWD)

## Next Steps

1. Rebuild Docker image with vendon-sync code
2. Run new sync job
3. Verify all 62 machines are synced
4. Verify data accuracy matches Vendon API

