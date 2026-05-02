#!/bin/bash
# Verify that cached database data matches real Vendon API data

set -euo pipefail

echo "🔍 Verifying data accuracy: Comparing cached DB vs Vendon API"
echo ""

# Get DB credentials
DB_HOST=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-host}' | base64 -d)
DB_PORT=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-port}' | base64 -d)
DB_NAME=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-name}' | base64 -d)
DB_USER=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-user}' | base64 -d)
export PGPASSWORD=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.db-password}' | base64 -d)

# Get API key
VENDON_API_KEY=$(kubectl get secret people-analytics-secrets -n leet-monitor -o jsonpath='{.data.vendon-api-key}' | base64 -d)

# Get yesterday's date
YESTERDAY=$(date -d "yesterday" +%Y-%m-%d)
echo "📅 Checking date: $YESTERDAY"
echo ""

# Get lowest machine from cached DB
echo "📊 Step 1: Getting lowest machine from cached DB..."
LOWEST_DB=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
  SELECT machine_id, total_revenue, total_transactions 
  FROM vendon_sales_records 
  WHERE DATE(sale_date) = '$YESTERDAY' 
  ORDER BY total_revenue ASC 
  LIMIT 1
")

if [ -z "$LOWEST_DB" ]; then
  echo "❌ No data found in DB for $YESTERDAY"
  exit 1
fi

MACHINE_ID=$(echo "$LOWEST_DB" | cut -d'|' -f1 | xargs)
DB_REVENUE=$(echo "$LOWEST_DB" | cut -d'|' -f2 | xargs)
DB_TRANSACTIONS=$(echo "$LOWEST_DB" | cut -d'|' -f3 | xargs)

echo "✅ Lowest machine in DB: $MACHINE_ID"
echo "   Revenue: $DB_REVENUE KWD"
echo "   Transactions: $DB_TRANSACTIONS"
echo ""

# Get same machine's data from Vendon API
echo "📡 Step 2: Getting same machine's data from Vendon API..."
START_TIMESTAMP=$(date -d "$YESTERDAY 00:00:00" +%s)
END_TIMESTAMP=$(date -d "$YESTERDAY 23:59:59" +%s)

VENDON_RESPONSE=$(curl -s "https://cloud.vendon.net/rest/v1.9.0/stats/vends?from_timestamp=$START_TIMESTAMP&to_timestamp=$END_TIMESTAMP&machine_id=$MACHINE_ID&limit=10000" \
  -H "Authorization: Token $VENDON_API_KEY")

VENDON_CODE=$(echo "$VENDON_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('code', 'error'))" 2>/dev/null || echo "error")

if [ "$VENDON_CODE" != "200" ]; then
  echo "❌ Vendon API error: $VENDON_CODE"
  echo "Response: $VENDON_RESPONSE"
  exit 1
fi

VENDON_REVENUE=$(echo "$VENDON_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
vends = data.get('result', [])
revenue = sum(v.get('price', 0) for v in vends)
print(f'{revenue:.2f}')
" 2>/dev/null || echo "0.00")

VENDON_TRANSACTIONS=$(echo "$VENDON_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
vends = data.get('result', [])
print(len(vends))
" 2>/dev/null || echo "0")

echo "✅ Vendon API data for machine $MACHINE_ID:"
echo "   Revenue: $VENDON_REVENUE KWD"
echo "   Transactions: $VENDON_TRANSACTIONS"
echo ""

# Compare
echo "🔍 Step 3: Comparison..."
REVENUE_DIFF=$(python3 -c "print(abs(float('$DB_REVENUE') - float('$VENDON_REVENUE')))" 2>/dev/null || echo "999")

if (( $(echo "$REVENUE_DIFF < 0.01" | bc -l) )); then
  echo "✅ Revenue matches! (difference: $REVENUE_DIFF KWD)"
else
  echo "❌ Revenue mismatch!"
  echo "   DB: $DB_REVENUE KWD"
  echo "   Vendon: $VENDON_REVENUE KWD"
  echo "   Difference: $REVENUE_DIFF KWD"
fi

if [ "$DB_TRANSACTIONS" = "$VENDON_TRANSACTIONS" ]; then
  echo "✅ Transaction count matches! ($DB_TRANSACTIONS)"
else
  echo "❌ Transaction count mismatch!"
  echo "   DB: $DB_TRANSACTIONS"
  echo "   Vendon: $VENDON_TRANSACTIONS"
fi

echo ""
echo "📊 Summary:"
echo "   Total machines in DB for $YESTERDAY: $(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(DISTINCT machine_id) FROM vendon_sales_records WHERE DATE(sale_date) = '$YESTERDAY'")"
echo "   Total machines with revenue > 0: $(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(DISTINCT machine_id) FROM vendon_sales_records WHERE DATE(sale_date) = '$YESTERDAY' AND total_revenue > 0")"

