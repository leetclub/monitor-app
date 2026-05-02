#!/bin/bash
# Quick health check script for People Analytics CronJob

echo "=========================================="
echo "People Analytics CronJob Health Check"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check CronJob Status
echo "1. CronJob Status:"
echo "------------------"
CRONJOB_STATUS=$(kubectl get cronjob people-analytics-sync -n leet-monitor -o jsonpath='{.status.active}' 2>/dev/null)
if [ -n "$CRONJOB_STATUS" ]; then
    echo -e "${GREEN}✓${NC} CronJob exists"
    SCHEDULE=$(kubectl get cronjob people-analytics-sync -n leet-monitor -o jsonpath='{.spec.schedule}' 2>/dev/null)
    echo "   Schedule: $SCHEDULE"
else
    echo -e "${RED}✗${NC} CronJob not found"
fi
echo ""

# 2. Check Latest Job
echo "2. Latest Job:"
echo "--------------"
LATEST_JOB=$(kubectl get jobs -n leet-monitor -l app=people-analytics-sync --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)
if [ -n "$LATEST_JOB" ]; then
    JOB_STATUS=$(kubectl get job $LATEST_JOB -n leet-monitor -o jsonpath='{.status.conditions[0].type}' 2>/dev/null)
    JOB_TIME=$(kubectl get job $LATEST_JOB -n leet-monitor -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null)
    echo -e "${GREEN}✓${NC} Latest job: $LATEST_JOB"
    echo "   Status: $JOB_STATUS"
    echo "   Created: $JOB_TIME"
    
    # Check pod status
    POD_NAME=$(kubectl get pods -n leet-monitor -l job-name=$LATEST_JOB -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    if [ -n "$POD_NAME" ]; then
        POD_STATUS=$(kubectl get pod $POD_NAME -n leet-monitor -o jsonpath='{.status.phase}' 2>/dev/null)
        echo "   Pod: $POD_NAME ($POD_STATUS)"
        
        # Check if pod completed successfully
        if [ "$POD_STATUS" = "Succeeded" ]; then
            echo -e "   ${GREEN}✓${NC} Job completed successfully"
        elif [ "$POD_STATUS" = "Failed" ]; then
            echo -e "   ${RED}✗${NC} Job failed"
        fi
    fi
else
    echo -e "${YELLOW}⚠${NC} No jobs found"
fi
echo ""

# 3. Check Recent Logs
echo "3. Recent Logs (last 10 lines):"
echo "-------------------------------"
if [ -n "$POD_NAME" ]; then
    kubectl logs $POD_NAME -n leet-monitor --tail=10 2>/dev/null | sed 's/^/   /'
else
    echo -e "${YELLOW}⚠${NC} No pod logs available"
fi
echo ""

# 4. Check Database Status
echo "4. Database Status:"
echo "-------------------"
DB_CHECK=$(psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -t -c "SELECT MAX(synced_at)::text || '|' || COUNT(*)::text FROM people_analytics_records;" 2>/dev/null)
if [ -n "$DB_CHECK" ]; then
    LAST_SYNC=$(echo $DB_CHECK | cut -d'|' -f1)
    TOTAL_RECORDS=$(echo $DB_CHECK | cut -d'|' -f2)
    echo -e "${GREEN}✓${NC} Database accessible"
    echo "   Last sync: $LAST_SYNC"
    echo "   Total records: $TOTAL_RECORDS"
else
    echo -e "${RED}✗${NC} Cannot connect to database"
fi
echo ""

# 5. Check Recent Syncs
echo "5. Recent Syncs (last 5):"
echo "-------------------------"
RECENT_SYNCS=$(psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -t -c "SELECT status || '|' || sync_started_at::text || '|' || COALESCE(records_synced::text, '0') FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;" 2>/dev/null)
if [ -n "$RECENT_SYNCS" ]; then
    echo "$RECENT_SYNCS" | while IFS='|' read -r status time records; do
        if [ "$status" = "success" ]; then
            echo -e "   ${GREEN}✓${NC} $status - $records records - $time"
        else
            echo -e "   ${RED}✗${NC} $status - $records records - $time"
        fi
    done
else
    echo -e "${YELLOW}⚠${NC} No sync logs found"
fi
echo ""

# 6. Check for Duplicates
echo "6. Data Quality Check:"
echo "---------------------"
DUPLICATES=$(psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -t -c "SELECT COUNT(*) - COUNT(DISTINCT (uidd, first_timestamp, last_timestamp, interval_type)) FROM people_analytics_records;" 2>/dev/null)
if [ -n "$DUPLICATES" ]; then
    if [ "$DUPLICATES" -eq 0 ]; then
        echo -e "   ${GREEN}✓${NC} No duplicates found"
    else
        echo -e "   ${RED}✗${NC} Found $DUPLICATES duplicate records"
    fi
fi
echo ""

# 7. Check API Health
echo "7. API Health:"
echo "--------------"
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://people-api.theleetclub.com/health 2>/dev/null)
if [ "$API_STATUS" = "200" ]; then
    echo -e "   ${GREEN}✓${NC} API is healthy (HTTP $API_STATUS)"
else
    echo -e "   ${RED}✗${NC} API returned HTTP $API_STATUS"
fi
echo ""

echo "=========================================="
echo "Health check complete"
echo "=========================================="

