# Integration Guide: Updating Frontend to Use Database Service

This guide explains how to modify the People Analytics tab to fetch data from the new database service instead of directly from Videoloft.

## Overview

The new architecture:
1. **CronJob** runs periodically (e.g., hourly) to fetch data from Videoloft and store it in PostgreSQL
2. **API Service** provides REST endpoints to query the stored data
3. **Frontend** calls the API service instead of Videoloft directly

## Step 1: Deploy the Services

Follow the setup instructions in `README.md` to deploy:
- PostgreSQL database
- CronJob for syncing
- API service

## Step 2: Update Frontend Code

### Option A: Modify `people-analytics.js` (Recommended)

In `people-analytics.js`, modify the `fetchPeopleAnalytics` function or create a new function that calls your API service:

```javascript
// Add this configuration at the top of people-analytics.js
const PEOPLE_ANALYTICS_API_BASE = 'http://people-analytics-api.default.svc.cluster.local/api';
// Or if exposed via ingress: 'https://api.yourdomain.com/api'

function fetchPeopleAnalyticsFromDatabase(params) {
  try {
    const { uidds, startTime, endTime, interval, timeZone } = params;
    
    // Convert timestamps to date strings
    const startDate = new Date(startTime).toISOString().split('T')[0];
    const endDate = new Date(endTime).toISOString().split('T')[0];
    
    // Build query parameters
    const queryParams = new URLSearchParams({
      uidds: uidds.join(','),
      start_date: startDate,
      end_date: endDate,
      interval: interval === 'date' ? 'date' : (interval === 3600000 ? 'hour' : '60000'),
      limit: '1000'
    });
    
    const url = `${PEOPLE_ANALYTICS_API_BASE}/people-analytics?${queryParams}`;
    
    console.log('📡 Fetching from database API:', url);
    
    // Make the API call
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`API request failed: ${response.getResponseCode()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    
    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }
    
    // Transform data to match expected format
    const transformedData = data.data.map(record => ({
      firstTimestamp: new Date(record.first_timestamp).getTime(),
      lastTimestamp: new Date(record.last_timestamp).getTime(),
      in: record.in,
      out: record.out,
      netTraffic: record.netTraffic,
      uid: record.uidd.split('.')[0],
      deviceId: record.uidd.split('.')[1] || record.device_id,
      trafficRatio: record.trafficRatio,
      trafficPattern: record.trafficPattern,
      durationHours: record.durationHours,
      eventCount: record.eventCount
    }));
    
    // Process and return in same format as original
    const processedData = processPeopleAnalyticsData(transformedData);
    const summary = calculatePeopleAnalyticsSummary(processedData);
    
    return {
      success: true,
      data: processedData,
      rawData: transformedData,
      totalRecords: processedData.length,
      summary: summary
    };
    
  } catch (error) {
    console.error('❌ Error fetching from database:', error);
    return {
      success: false,
      error: error.message,
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}
```

### Option B: Modify `testPeopleAnalyticsWrapper` in `people-analytics.js`

Update the `testPeopleAnalyticsWrapper` function to use the database API:

```javascript
function testPeopleAnalyticsWrapper(params) {
  try {
    // Try database API first, fallback to Videoloft if needed
    const dbResult = fetchPeopleAnalyticsFromDatabase(params);
    
    if (dbResult.success && dbResult.data.length > 0) {
      console.log('✅ Using data from database');
      return dbResult;
    } else {
      console.log('⚠️ Database empty, falling back to Videoloft');
      // Fallback to original Videoloft API
      return fetchPeopleAnalytics(params);
    }
  } catch (error) {
    console.error('❌ Error in wrapper:', error);
    // Fallback to Videoloft
    return fetchPeopleAnalytics(params);
  }
}
```

## Step 3: Update API Base URL

Set the API base URL based on your deployment:

- **Kubernetes ClusterIP**: `http://people-analytics-api.default.svc.cluster.local/api`
- **Ingress/External**: `https://api.yourdomain.com/api`
- **Local Development**: `http://localhost:5000/api`

## Step 4: Handle Data Format Differences

The API returns data in a slightly different format. Ensure you transform it to match what the frontend expects:

- `first_timestamp` → `firstTimestamp` (convert to milliseconds)
- `people_in` → `in`
- `people_out` → `out`
- `net_traffic` → `netTraffic`

## Step 5: Add Fallback Logic

It's recommended to add fallback logic that:
1. Tries the database API first
2. Falls back to Videoloft if database is empty or unavailable
3. Logs which source was used

## Step 6: Testing

1. **Test API directly**:
```bash
curl "http://localhost:5000/api/people-analytics?uidds=1382465.6&start_date=2024-01-01&end_date=2024-01-31"
```

2. **Check sync status**:
```bash
curl "http://localhost:5000/api/sync-status"
```

3. **Verify data in database**:
```bash
kubectl exec -it postgres-pod -- psql -U postgres -d people_analytics -c "SELECT COUNT(*) FROM people_analytics_records;"
```

## Benefits

1. **Performance**: Faster queries from local database
2. **Reliability**: Data persists even if Videoloft API is down
3. **Cost**: Reduced API calls to Videoloft
4. **Historical Data**: Can query historical data even if Videoloft doesn't retain it
5. **Analytics**: Can perform complex queries and aggregations

## Monitoring

Monitor the sync jobs:
```bash
# Check CronJob status
kubectl get cronjobs people-analytics-sync

# Check recent jobs
kubectl get jobs -l app=people-analytics-sync

# View logs
kubectl logs -l app=people-analytics-sync --tail=100
```

## Troubleshooting

### No data in database
- Check if CronJob is running: `kubectl get cronjobs`
- Check job logs: `kubectl logs <job-pod-name>`
- Verify Videoloft credentials in secrets

### API returns empty results
- Verify date range matches synced data
- Check device IDs (uidds) are correct
- Query sync status to see what was synced

### Frontend errors
- Check API service is running: `kubectl get pods -l app=people-analytics-api`
- Verify network connectivity from frontend to API
- Check API logs: `kubectl logs -l app=people-analytics-api`


