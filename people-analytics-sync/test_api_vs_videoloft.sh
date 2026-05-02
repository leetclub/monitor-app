#!/bin/bash
# Quick test script to compare API results with Videoloft

DATE=$(date +%Y-%m-%d)
DEVICE="1382465.21"

echo "=========================================="
echo "Testing API vs Videoloft"
echo "=========================================="
echo "Date: $DATE"
echo "Device: $DEVICE"
echo ""

echo "1. Testing API:"
echo "---------------"
API_RESULT=$(curl -s "https://people-api.theleetclub.com/api/people-analytics?uidds=$DEVICE&start_date=$DATE&end_date=$DATE")
API_COUNT=$(echo $API_RESULT | jq '.data | length' 2>/dev/null || echo "ERROR")
API_TOTAL_IN=$(echo $API_RESULT | jq '.summary.totalIn' 2>/dev/null || echo "ERROR")
API_TOTAL_OUT=$(echo $API_RESULT | jq '.summary.totalOut' 2>/dev/null || echo "ERROR")

echo "   Records: $API_COUNT"
echo "   Total In: $API_TOTAL_IN"
echo "   Total Out: $API_TOTAL_OUT"
echo ""

echo "2. Check Database Directly:"
echo "----------------------------"
DB_RESULT=$(psql -h db-postgresql-nyc1-51052-do-user-18469088-0.i.db.ondigitalocean.com \
     -p 25060 -U doadmin -d people_analytics \
     -t -c "SELECT COUNT(*)::text || '|' || COALESCE(SUM(people_in)::text, '0') || '|' || COALESCE(SUM(people_out)::text, '0') FROM people_analytics_records WHERE uidd = '$DEVICE' AND DATE(first_timestamp) = '$DATE';" 2>/dev/null)

if [ -n "$DB_RESULT" ]; then
    DB_COUNT=$(echo $DB_RESULT | cut -d'|' -f1)
    DB_TOTAL_IN=$(echo $DB_RESULT | cut -d'|' -f2)
    DB_TOTAL_OUT=$(echo $DB_RESULT | cut -d'|' -f3)
    echo "   Records: $DB_COUNT"
    echo "   Total In: $DB_TOTAL_IN"
    echo "   Total Out: $DB_TOTAL_OUT"
else
    echo "   ERROR: Could not query database"
fi
echo ""

echo "3. Comparison:"
echo "--------------"
if [ "$API_COUNT" = "$DB_COUNT" ] && [ "$API_TOTAL_IN" = "$DB_TOTAL_IN" ]; then
    echo "   ✅ API matches database"
else
    echo "   ⚠️  API and database differ"
    echo "   API: $API_COUNT records, $API_TOTAL_IN in, $API_TOTAL_OUT out"
    echo "   DB:  $DB_COUNT records, $DB_TOTAL_IN in, $DB_TOTAL_OUT out"
fi
echo ""

echo "=========================================="

