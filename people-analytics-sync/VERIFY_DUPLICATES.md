# How to Verify and Remove Duplicates

## Quick Check (Recommended First Step)

Run this to see if there are duplicates:

```bash
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -f people-analytics-sync/verify_no_duplicates.sql
```

This will show:
- ✅ Status (no duplicates or how many found)
- ✅ Whether unique constraint exists
- ✅ Sample duplicates if any exist

## Detailed Check

To see detailed information about duplicates:

```bash
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -f people-analytics-sync/check_duplicates.sql
```

## Remove Duplicates

**⚠️ IMPORTANT: Backup your database first!**

```bash
# 1. Backup (optional but recommended)
pg_dump -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
        -p 25060 -U doadmin -d people_analytics \
        > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Remove duplicates and add constraint
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -f people-analytics-sync/remove_duplicates.sql
```

This script will:
1. Show current state (how many duplicates)
2. Preview what will be deleted
3. Delete duplicates (keeps most recent by `synced_at`)
4. Add unique constraint
5. Verify everything is clean

## Manual SQL Commands

If you prefer to run commands manually:

### 1. Check for duplicates:
```sql
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as unique_combinations,
    COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as duplicates
FROM people_analytics_records;
```

### 2. See duplicate groups:
```sql
SELECT 
    uidd,
    first_timestamp,
    last_timestamp,
    interval_type,
    COUNT(*) as count
FROM people_analytics_records
GROUP BY uidd, first_timestamp, last_timestamp, interval_type
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

### 3. Remove duplicates (keeps most recent):
```sql
DELETE FROM people_analytics_records
WHERE id NOT IN (
    SELECT DISTINCT ON (uidd, first_timestamp, last_timestamp, interval_type) id
    FROM people_analytics_records
    ORDER BY uidd, first_timestamp, last_timestamp, interval_type, synced_at DESC
);
```

### 4. Add unique constraint:
```sql
ALTER TABLE people_analytics_records
ADD CONSTRAINT uq_uidd_timestamp_interval 
UNIQUE (uidd, first_timestamp, last_timestamp, interval_type);
```

### 5. Verify constraint exists:
```sql
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'people_analytics_records'::regclass
  AND conname = 'uq_uidd_timestamp_interval';
```

## After Cleanup

Once duplicates are removed and the constraint is added:
- ✅ New syncs will automatically prevent duplicates (upsert logic)
- ✅ If Videoloft sends the same data, it will update the existing record
- ✅ No more duplicate records will be created

## Monitoring

You can periodically check for duplicates with:
```bash
psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -c "SELECT COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) as duplicates FROM people_analytics_records;"
```

If this returns `0`, you're good! 🎉

