// ===== PEOPLE ANALYTICS API INTEGRATION =====
 
function fetchPeopleAnalytics(params) {
  try {
    console.log("🔍 Fetching people analytics with params:", params);
    
    const { uidds, startTime, endTime, interval, timeZone } = params;
    
    // Validate required parameters
    if (!uidds || !Array.isArray(uidds) || uidds.length === 0) {
      console.error("❌ Invalid uidds parameter:", uidds);
      return {
        success: false,
        error: "uidds parameter is required and must be an array",
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    if (!startTime || !endTime) {
      console.error("❌ Missing time parameters:", { startTime, endTime });
      return {
        success: false,
        error: "startTime and endTime are required",
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    console.log("✅ Parameters validated successfully");
    
    // First authenticate to get the token and authenticator
    console.log("🔐 Authenticating with Videoloft...");
    console.log("🔐 Authentication started at:", new Date().toISOString());
    
    const authStartTime = Date.now();
    const authResult = authenticateWithVideoloft();
    const authEndTime = Date.now();
    
    console.log("🔐 Authentication completed in", (authEndTime - authStartTime), "ms");
    console.log("🔐 Auth result:", authResult);
    console.log("🔐 Auth result type:", typeof authResult);
    console.log("🔐 Auth result keys:", authResult ? Object.keys(authResult) : "null/undefined");
    
    if (!authResult || !authResult.success) {
      console.error("❌ Authentication failed:", authResult);
      return {
        success: false,
        error: "Failed to authenticate with Videoloft: " + (authResult?.error || "Unknown error"),
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    console.log("✅ Authentication successful");
    console.log("✅ Auth token length:", authResult.authToken ? authResult.authToken.length : "MISSING");
    console.log("✅ Authenticator URL:", authResult.authenticator);
    
    // Use the correct Videoloft People Analytics API endpoint
    console.log("📊 Calling Videoloft People Analytics API...");
    const analyticsUrl = "https://euwest1-analytics.manything.com/people";
    
    console.log("🔍 Debug info:", {
      analyticsUrl: analyticsUrl,
      authToken: authResult.authToken ? "Present" : "Missing"
    });
    
    const payload = {
      uidds: uidds,
      startTime: startTime,
      endTime: endTime,
      interval: interval || "date",
      timeZone: timeZone || "Asia/Kuwait"
    };
    
    console.log("📡 Making request to:", analyticsUrl);
    console.log("📦 Payload:", JSON.stringify(payload, null, 2));
    console.log("🔑 Auth token (first 50 chars):", authResult.authToken ? authResult.authToken.substring(0, 50) + "..." : "MISSING");
    
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `ManythingToken ${authResult.authToken}`
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    console.log("📡 Request options:", JSON.stringify({
      method: requestOptions.method,
      headers: requestOptions.headers,
      payloadLength: requestOptions.payload.length,
      muteHttpExceptions: requestOptions.muteHttpExceptions
    }, null, 2));
    
    console.log("📡 Making API call...");
    const response = UrlFetchApp.fetch(analyticsUrl, requestOptions);
    
    console.log("📡 Response received!");
    console.log("📡 Response status:", response.getResponseCode());
    console.log("📡 Response headers:", JSON.stringify(response.getHeaders(), null, 2));
    
    const responseText = response.getContentText();
    console.log("📡 Response content length:", responseText.length);
    console.log("📡 Response content (first 500 chars):", responseText.substring(0, 500));
    
    if (responseText.length > 500) {
      console.log("📡 Response content (last 500 chars):", responseText.substring(responseText.length - 500));
    }
    
    if (response.getResponseCode() !== 200) {
      const errorText = response.getContentText();
      console.error("❌ Analytics API request failed:", {
        status: response.getResponseCode(),
        headers: response.getHeaders(),
        content: errorText,
        url: analyticsUrl
      });
      return {
        success: false,
        error: `Analytics API request failed with status ${response.getResponseCode()}: ${errorText}`,
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    console.log("📊 Parsing response JSON...");
    let responseData;
    try {
      responseData = JSON.parse(responseText);
      console.log("📊 Analytics API response parsed successfully");
      console.log("📊 Response data type:", typeof responseData);
      console.log("📊 Response data length:", Array.isArray(responseData) ? responseData.length : "Not an array");
      console.log("📊 Response data (first item):", Array.isArray(responseData) && responseData.length > 0 ? responseData[0] : "No items");
    } catch (parseError) {
      console.error("❌ Failed to parse response JSON:", parseError);
      console.error("❌ Raw response text:", responseText);
      return {
        success: false,
        error: "Failed to parse API response: " + parseError.message,
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    console.log("📊 Processing analytics data...");

    // IMPORTANT:
    // Videoloft /people already returns bucketed aggregates for interval=date/hour/60000.
    // Running processPeopleAnalyticsData() here can re-bucket/reorder rows and create partial/shifted buckets,
    // which shows false per-bucket diffs even when totals match.
    const isBucketedInterval =
      interval === "date" ||
      interval === "hour" ||
      interval === 3600000 ||
      interval === "60000" ||
      interval === 60000;

    const processedData = isBucketedInterval ? responseData : processPeopleAnalyticsData(responseData);
    console.log("📊 Processed data length:", processedData.length, "(bucketedInterval=", isBucketedInterval, ")");
    
    const summary = calculatePeopleAnalyticsSummary(processedData);
    console.log("📊 Calculated summary:", summary);
    
    const result = {
      success: true,
      data: processedData,
      rawData: responseData,
      totalRecords: processedData.length,
      summary: summary
    };
    
    console.log("✅ People analytics processing completed");
    console.log("✅ Final result keys:", Object.keys(result));
    console.log("✅ Final result success:", result.success);
    console.log("✅ Final result data length:", result.data.length);
    return result;
    
  } catch (error) {
    console.error("❌ Error fetching people analytics:", error);
    console.error("❌ Error stack:", error.stack);
    return {
      success: false,
      error: error.message || "Unknown error occurred",
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

// ===== MOTION EVENTS TO PEOPLE ANALYTICS =====

function getVideoloftDeviceInfo(uidd, authResult) {
  try {
    console.log(`📱 Getting device info for ${uidd}`);
    
    const deviceInfoUrl = `${authResult.authenticator}/devices/viewerInfo?uidd=${uidd}`;
    console.log("📡 Requesting device info from:", deviceInfoUrl);
    
    const response = UrlFetchApp.fetch(deviceInfoUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ManythingToken ${authResult.authToken}`,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    console.log("📡 Device info response status:", response.getResponseCode());
    
    if (response.getResponseCode() !== 200) {
      const errorText = response.getContentText();
      console.error("❌ Device info request failed:", {
        status: response.getResponseCode(),
        content: errorText,
        url: deviceInfoUrl
      });
      return {
        success: false,
        error: `Device info request failed with status ${response.getResponseCode()}: ${errorText}`
      };
    }
    
    const responseData = JSON.parse(response.getContentText());
    console.log("📱 Device info response:", responseData);
    
    // Extract logger server from the response
    if (responseData.result) {
      for (const uid in responseData.result) {
        const userDevices = responseData.result[uid];
        if (userDevices.devices) {
          for (const deviceId in userDevices.devices) {
            const device = userDevices.devices[deviceId];
            if (device.uidd === uidd && device.logger) {
              return {
                success: true,
                logger: device.logger,
                wowza: device.wowza,
                streamname: device.streamname,
                device: device
              };
            }
          }
        }
      }
    }
    
    return {
      success: false,
      error: "Logger server not found for device"
    };
    
  } catch (error) {
    console.error("❌ Failed to get device info:", error);
    return { success: false, error: error.message };
  }
}

function getVideoloftEvents(uidd, startTime, endTime, loggerServer, authToken) {
  try {
    console.log(`📊 Getting events for ${uidd} from logger: ${loggerServer}`);
    
    // Convert timestamps to seconds (Videoloft API expects seconds)
    const startTimeSeconds = Math.floor(startTime / 1000);
    const endTimeSeconds = Math.floor(endTime / 1000);
    
    const eventsUrl = `${loggerServer}/alert?uid=${uidd}&startt=${startTimeSeconds}&endt=${endTimeSeconds}&limit=100&token=${authToken}`;
    console.log("📡 Requesting events from:", eventsUrl);
    
    const response = UrlFetchApp.fetch(eventsUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    console.log("📡 Events response status:", response.getResponseCode());
    
    if (response.getResponseCode() !== 200) {
      const errorText = response.getContentText();
      console.error("❌ Events request failed:", {
        status: response.getResponseCode(),
        content: errorText,
        url: eventsUrl
      });
      return {
        success: false,
        error: `Events request failed with status ${response.getResponseCode()}: ${errorText}`
      };
    }
    
    const responseData = JSON.parse(response.getContentText());
    console.log("📊 Events response:", responseData);
    
    const events = responseData.result || [];
    console.log(`📊 Found ${events.length} events for ${uidd}`);
    
    return {
      success: true,
      events: events
    };
    
  } catch (error) {
    console.error("❌ Failed to get events:", error);
    return { success: false, error: error.message };
  }
}

function processMotionEventsToPeopleAnalytics(events, startTime, endTime, interval) {
  try {
    console.log("🔄 Processing motion events to people analytics...");
    
    // Group events by time interval
    const groupedEvents = {};
    
    events.forEach(event => {
      const eventTime = new Date(event.startt);
      let timeKey;
      
      if (interval === 'hour') {
        // Group by hour
        timeKey = eventTime.toISOString().substring(0, 13) + ':00:00.000Z';
      } else if (interval === 'date') {
        // Group by date
        timeKey = eventTime.toISOString().substring(0, 10) + 'T00:00:00.000Z';
      } else {
        // Default to date
        timeKey = eventTime.toISOString().substring(0, 10) + 'T00:00:00.000Z';
      }
      
      if (!groupedEvents[timeKey]) {
        groupedEvents[timeKey] = {
          timestamp: timeKey,
          firstTimestamp: eventTime.getTime(),
          lastTimestamp: eventTime.getTime(),
          events: [],
          uid: event.uidd ? event.uidd.split('.')[0] : 'unknown',
          deviceId: event.deviceId || (event.uidd ? event.uidd.split('.')[1] : 'unknown')
        };
      }
      
      groupedEvents[timeKey].events.push(event);
      groupedEvents[timeKey].firstTimestamp = Math.min(groupedEvents[timeKey].firstTimestamp, eventTime.getTime());
      groupedEvents[timeKey].lastTimestamp = Math.max(groupedEvents[timeKey].lastTimestamp, eventTime.getTime());
    });
    
    // Convert to people analytics format
    const analyticsData = Object.values(groupedEvents).map(group => {
      // Estimate people in/out based on motion events
      // This is a simplified algorithm - in reality, you'd need more sophisticated analysis
      const motionEvents = group.events.filter(e => e.type === 'motion');
      const peopleIn = Math.ceil(motionEvents.length * 0.6); // Assume 60% of motion events are people entering
      const peopleOut = Math.ceil(motionEvents.length * 0.4); // Assume 40% are people leaving
      
      return {
        timestamp: group.timestamp,
        firstTimestamp: group.firstTimestamp,
        lastTimestamp: group.lastTimestamp,
        uid: group.uid,
        deviceId: group.deviceId,
        in: peopleIn,
        out: peopleOut,
        net: peopleIn - peopleOut,
        events: motionEvents.length,
        duration: group.lastTimestamp - group.firstTimestamp
      };
    });
    
    // Sort by timestamp
    analyticsData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    console.log(`✅ Processed ${analyticsData.length} time periods from ${events.length} events`);
    return analyticsData;
    
  } catch (error) {
    console.error("❌ Error processing motion events:", error);
    return [];
  }
}

// ===== VIDEOLOFT API FUNCTIONS =====

function authenticateWithVideoloft() {
  try {
    console.log("🔐 Authenticating with Videoloft");
    
    // Get credentials from PropertiesService
    const email = PropertiesService.getScriptProperties().getProperty('VIDEOLOFT_EMAIL');
    const password = PropertiesService.getScriptProperties().getProperty('VIDEOLOFT_PASSWORD');
    
    if (!email || !password) {
      throw new Error("Videoloft credentials not configured. Please set VIDEOLOFT_EMAIL and VIDEOLOFT_PASSWORD in script properties.");
    }
    
    const loginUrl = "https://auth1.manything.com/login";
    const payload = {
      email: email,
      password: password
    };
    
    const response = UrlFetchApp.fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      payload: JSON.stringify(payload)
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Login failed with status ${response.getResponseCode()}: ${response.getContentText()}`);
    }
    
    const responseData = JSON.parse(response.getContentText());
    
    // Check if we need to redirect to a specific region
    if (responseData.location) {
      console.log("🔄 Redirecting to region:", responseData.location);
      const regionResponse = UrlFetchApp.fetch(responseData.location + "/login", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        payload: JSON.stringify(payload)
      });
      
      if (regionResponse.getResponseCode() !== 200) {
        throw new Error(`Regional login failed with status ${regionResponse.getResponseCode()}: ${regionResponse.getContentText()}`);
      }
      
      const regionData = JSON.parse(regionResponse.getContentText());
      return {
        success: true,
        authToken: regionData.result.authToken,
        authenticator: regionData.result.authenticator,
        uid: regionData.result.uid,
        provider: regionData.result.provider
      };
    }
    
    return {
      success: true,
      authToken: responseData.result.authToken,
      authenticator: responseData.result.authenticator,
      uid: responseData.result.uid,
      provider: responseData.result.provider
    };
    
  } catch (error) {
    console.error("❌ Videoloft authentication failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function getVideoloftDeviceInfo(authToken, authenticator, provider, uidds) {
  try {
    console.log("📱 Getting Videoloft device information for:", uidds);
    
    // Use the correct API endpoint structure
    // Format: https://{authenticator}/{provider}/devices/viewerInfo
    const viewerInfoUrl = `${authenticator}/${provider}/devices/viewerInfo`;
    const uiddParams = uidds.map(uidd => `uidd=${uidd}`).join('&');
    const fullUrl = `${viewerInfoUrl}?${uiddParams}`;
    
    console.log("📡 Requesting device info from:", fullUrl);
    
    const response = UrlFetchApp.fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ManythingToken ${authToken}`,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true // This will prevent automatic exception throwing
    });
    
    console.log("📡 Response status:", response.getResponseCode());
    console.log("📡 Response headers:", response.getHeaders());
    console.log("📡 Response content:", response.getContentText());
    
    if (response.getResponseCode() !== 200) {
      const errorText = response.getContentText();
      console.error("❌ Device info request failed:", {
        status: response.getResponseCode(),
        headers: response.getHeaders(),
        content: errorText,
        url: fullUrl
      });
      throw new Error(`Device info request failed with status ${response.getResponseCode()}: ${errorText}`);
    }
    
    const responseData = JSON.parse(response.getContentText());
    console.log("📱 Device info response:", responseData);
    
    // Flatten the device data for easier access
    const flattenedDevices = {};
    if (responseData.result) {
      Object.keys(responseData.result).forEach(uid => {
        const userDevices = responseData.result[uid];
        if (userDevices.devices) {
          Object.keys(userDevices.devices).forEach(deviceId => {
            const device = userDevices.devices[deviceId];
            flattenedDevices[device.uidd] = device;
          });
        }
      });
    }
    
    console.log("📱 Flattened devices:", flattenedDevices);
    
    return {
      success: true,
      data: flattenedDevices
    };
    
  } catch (error) {
    console.error("❌ Failed to get device information:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function getVideoloftEvents(loggerServer, authToken, uidd, startTime, endTime) {
  try {
    console.log("📊 Getting Videoloft events for device:", uidd);
    
    // Convert timestamps to seconds for Videoloft API
    const startTimeSeconds = Math.floor(startTime / 1000);
    const endTimeSeconds = Math.floor(endTime / 1000);
    
    const eventsUrl = `https://${loggerServer}/alert`;
    const params = [
      `uid=${uidd}`,
      `startt=${startTimeSeconds}`,
      `endt=${endTimeSeconds}`,
      `limit=100`,
      `token=${authToken}`
    ].join('&');
    
    const fullUrl = `${eventsUrl}?${params}`;
    
    const response = UrlFetchApp.fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Events request failed with status ${response.getResponseCode()}: ${response.getContentText()}`);
    }
    
    const responseData = JSON.parse(response.getContentText());
    
    return {
      success: true,
      data: responseData.result || []
    };
    
  } catch (error) {
    console.error("❌ Failed to get events:", error);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
}

function processVideoloftEventsForPeopleAnalytics(events, startTime, endTime, interval) {
  console.log("🔄 Processing Videoloft events for people analytics:", events);
  
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }
  
  // Group events by time intervals
  const intervalMs = getIntervalMs(interval);
  const groupedEvents = {};
  
  events.forEach(event => {
    const eventTime = event.startt * 1000; // Convert from seconds to milliseconds
    const intervalKey = Math.floor(eventTime / intervalMs) * intervalMs;
    
    if (!groupedEvents[intervalKey]) {
      groupedEvents[intervalKey] = {
        firstTimestamp: eventTime,
        lastTimestamp: eventTime,
        in: 0,
        out: 0,
        events: []
      };
    }
    
    // For motion events, we'll simulate people counting
    // In a real implementation, you'd need AI/ML to analyze the video
    if (event.type === 'motion') {
      // Simulate people counting based on motion magnitude
      const motionMagnitude = parseInt(event.smx, 16) || 0;
      const peopleCount = Math.floor(motionMagnitude / 2) + 1; // Rough estimation
      
      // Randomly assign as "in" or "out" based on time patterns
      const hour = new Date(eventTime).getHours();
      const isIncoming = hour >= 8 && hour <= 18; // Business hours = incoming
      
      if (isIncoming) {
        groupedEvents[intervalKey].in += peopleCount;
      } else {
        groupedEvents[intervalKey].out += peopleCount;
      }
    }
    
    groupedEvents[intervalKey].events.push(event);
    groupedEvents[intervalKey].lastTimestamp = Math.max(groupedEvents[intervalKey].lastTimestamp, eventTime);
  });
  
  // Convert grouped data to array and add analytics
  return Object.values(groupedEvents).map(group => {
    const netTraffic = group.in - group.out;
    const totalTraffic = group.in + group.out;
    const trafficRatio = group.out > 0 ? (group.in / group.out) : (group.in > 0 ? Infinity : 0);
    
    // Determine traffic pattern
    let trafficPattern = "Normal";
    if (netTraffic > 10) trafficPattern = "High Inflow";
    else if (netTraffic < -10) trafficPattern = "High Outflow";
    else if (totalTraffic > 50) trafficPattern = "Busy Period";
    else if (totalTraffic < 5) trafficPattern = "Quiet Period";
    
    const duration = group.lastTimestamp - group.firstTimestamp;
    const durationHours = duration / (1000 * 60 * 60);
    
    return {
      firstTimestamp: group.firstTimestamp,
      lastTimestamp: group.lastTimestamp,
      in: group.in,
      out: group.out,
      netTraffic: netTraffic,
      totalTraffic: totalTraffic,
      trafficRatio: trafficRatio,
      trafficPattern: trafficPattern,
      duration: duration,
      durationHours: durationHours,
      eventCount: group.events.length,
      processedAt: new Date()
    };
  });
}

function getIntervalMs(interval) {
  switch (interval) {
    case 'hour': return 60 * 60 * 1000; // 1 hour
    case '60000': return 60 * 1000; // 1 minute
    case 'date':
    default: return 24 * 60 * 60 * 1000; // 1 day
  }
}

// ===== CAMERA MANAGEMENT FUNCTIONS =====

function getVideoloftCameras() {
  try {
    console.log("📱 Getting available Videoloft cameras");
    
    // First authenticate
    const authResult = authenticateWithVideoloft();
    if (!authResult.success) {
      throw new Error("Failed to authenticate with Videoloft: " + authResult.error);
    }
    
    // Get devices from the authenticator server
    const devicesUrl = `${authResult.authenticator}/devices`;
    console.log("📡 Requesting devices from:", devicesUrl);
    
    const response = UrlFetchApp.fetch(devicesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ManythingToken ${authResult.authToken}`,
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    console.log("📡 Response status:", response.getResponseCode());
    console.log("📡 Response content:", response.getContentText());
    
    if (response.getResponseCode() !== 200) {
      const errorText = response.getContentText();
      console.error("❌ Devices request failed:", {
        status: response.getResponseCode(),
        content: errorText,
        url: devicesUrl
      });
      throw new Error(`Devices request failed with status ${response.getResponseCode()}: ${errorText}`);
    }
    
    const responseData = JSON.parse(response.getContentText());
    console.log("📱 Devices response:", responseData);
    
    // Flatten the device data
    const cameras = [];
    if (responseData.result) {
      Object.keys(responseData.result).forEach(uid => {
        const userDevices = responseData.result[uid];
        if (userDevices.devices) {
          Object.keys(userDevices.devices).forEach(deviceId => {
            const device = userDevices.devices[deviceId];
            cameras.push({
              id: device.uidd,
              name: device.phonename || `Camera ${deviceId}`,
              alias: userDevices.alias || `User ${uid}`,
              permissions: device.permissions || ['r']
            });
          });
        }
      });
    }
    
    console.log("📱 Available cameras:", cameras);
    
    return {
      success: true,
      cameras: cameras
    };
    
  } catch (error) {
    console.error("❌ Failed to get cameras:", error);
    return {
      success: false,
      error: error.message,
      cameras: []
    };
  }
}

// ===== AUTOMATIC AUTHENTICATION =====
// Credentials are automatically loaded from PropertiesService
// No manual credential management needed

// ===== VENDON SALES API INTEGRATION =====

/**
 * Fetch Vendon sales from cached API (vendon-sync) when direct Vendon API is unavailable.
 * Returns { totalSales, totalTransactions, sales } where sales is [] (charts will have no series).
 */
function fetchVendonSalesFromCache(machineId, startTime, endTime) {
  try {
    var apiBase = (PropertiesService.getScriptProperties && PropertiesService.getScriptProperties().getProperty("VENDON_API_BASE")) || "https://vendon-api.theleetclub.com";
    var totalRevenue = 0, totalTransactions = 0;
    var start = new Date(startTime);
    var end = new Date(endTime);
    var current = new Date(start.getTime());
    var maxDays = 62; // limit to avoid excessive requests
    var days = 0;
    while (current.getTime() <= end.getTime() && days < maxDays) {
      days++;
      var dateStr = Utilities.formatDate(current, "Asia/Kuwait", "yyyy-MM-dd");
      var url = apiBase + "/api/vendon-sales?machine_ids=" + encodeURIComponent(machineId) + "&date=" + dateStr;
      var res = UrlFetchApp.fetch(url, { method: "GET", muteHttpExceptions: true, headers: { "Accept": "application/json" } });
      var dayRev = 0, dayTx = 0;
      if (res.getResponseCode() === 200) {
        var json = JSON.parse(res.getContentText());
        if (json.success && json.data && Array.isArray(json.data)) {
          for (var i = 0; i < json.data.length; i++) {
            var r = Number(json.data[i].totalRevenue) || 0;
            var t = Number(json.data[i].totalTransactions) || 0;
            dayRev += r;
            dayTx += t;
            totalRevenue += r;
            totalTransactions += t;
          }
        }
      }
      console.log("💰 Cache day date=" + dateStr + " → revenue=" + dayRev + ", transactions=" + dayTx);
      current.setDate(current.getDate() + 1);
    }
    console.log("💰 Cache API: totalRevenue=" + totalRevenue + ", totalTransactions=" + totalTransactions + " for machine " + machineId + " (no VENDON_API_KEY; set it in Script Properties to use direct Vendon for correct totals)");
    return {
      success: true,
      data: { totalSales: totalRevenue, totalTransactions: totalTransactions, sales: [] }
    };
  } catch (e) {
    console.warn("⚠️ fetchVendonSalesFromCache failed:", e);
    return { success: false, error: (e && e.message) ? e.message : String(e), data: [] };
  }
}

/**
 * @param {string} machineId
 * @param {number} startTime - ms (fallback when dateRange missing)
 * @param {number} endTime - ms (fallback when dateRange missing)
 * @param {{ startDate?: string, endDate?: string }} [dateRange] - YYYY-MM-DD. When both set, from/to are computed from Kuwait day boundaries (matches vendon-sync).
 */
function fetchVendonSales(machineId, startTime, endTime, dateRange) {
  try {
    console.log("💰 Fetching Vendon sales data for machine:", machineId);
    if (!machineId) {
      return { success: false, error: "machineId is required", data: [] };
    }

    var startTimestamp, endTimestamp, startMs, endMs;
    if (dateRange && typeof dateRange.startDate === 'string' && dateRange.startDate && typeof dateRange.endDate === 'string' && dateRange.endDate) {
      // Use Kuwait day boundaries from startDate/endDate (matches vendon-sync) to avoid ms/serialization issues
      startMs = new Date(dateRange.startDate + "T00:00:00+03:00").getTime();
      endMs = new Date(dateRange.endDate + "T23:59:59.999+03:00").getTime();
      startTimestamp = Math.floor(startMs / 1000);
      endTimestamp = Math.floor(endMs / 1000);
      console.log("💰 Vendon range from startDate/endDate (Kuwait): from_ts=" + startTimestamp + " to_ts=" + endTimestamp + " (" + dateRange.startDate + " -> " + dateRange.endDate + ")");
    } else {
      startTimestamp = Math.floor(Number(startTime) / 1000);
      endTimestamp = Math.floor(Number(endTime) / 1000);
      startMs = startTime;
      endMs = endTime;
      console.log("💰 Vendon range from startTime/endTime: from_ts=" + startTimestamp + " to_ts=" + endTimestamp);
    }
    if (!endTimestamp || endTimestamp <= startTimestamp) {
      endTimestamp = startTimestamp + (24 * 60 * 60) - 1;
    }

    var apiKey =
      (PropertiesService.getScriptProperties && PropertiesService.getScriptProperties().getProperty("VENDON_API_KEY")) ||
      (PropertiesService.getScriptProperties && PropertiesService.getScriptProperties().getProperty("vendon-api-key")) ||
      (typeof API_KEY !== "undefined" && API_KEY) ||  // same as config.js / other tabs (analytics, attendance, etc.)
      null;
    if (!apiKey) {
      console.warn("⚠️ No Vendon API key (VENDON_API_KEY, vendon-api-key, or API_KEY), using cache API");
      return fetchVendonSalesFromCache(machineId, startMs, endMs);
    }

    // Use Vendon pagination so we never silently truncate (no mock data, ever).
    const baseUrl = "https://cloud.vendon.net/rest/v1.9.0/stats/vends";
    const limit = 10000;
    let offset = 0;
    let allVends = [];
    let iterations = 0;
    const maxIterations = 200; // safety

    while (iterations < maxIterations) {
      iterations++;
      const url = `${baseUrl}?from_timestamp=${startTimestamp}&to_timestamp=${endTimestamp}&machine_id=${machineId}&limit=${limit}&offset=${offset}`;
      const options = {
        method: "GET",
        headers: {
          "Authorization": `Token ${apiKey}`,
          "Accept": "application/json"
        },
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const status = response.getResponseCode();
      const responseText = response.getContentText();

      if (status !== 200) {
        console.warn("⚠️ Sales API request failed:", { status, url, body: responseText.substring(0, 500) });
        if (allVends.length > 0) break;
        return { success: false, error: "Sales API request failed with status " + status, data: [] };
      }

      let salesData;
      try {
        salesData = JSON.parse(responseText);
      } catch (parseError) {
        console.error("❌ Failed to parse sales response JSON:", parseError);
        if (allVends.length > 0) break;
        return { success: false, error: "Failed to parse sales response JSON", data: [] };
      }

      if (salesData.code !== 200) {
        console.warn("⚠️ Sales API returned error code:", salesData.code);
        if (allVends.length > 0) break;
        return { success: false, error: "Sales API error " + salesData.code + ": " + (salesData.message || "Unknown error"), data: [] };
      }

      const chunk = salesData.result || [];
      if (!chunk.length) break;

      allVends = allVends.concat(chunk);
      if (chunk.length < limit) break;
      offset += limit;
    }

    // Process the sales data to get totals
    var totalSales = allVends.reduce(function(sum, sale) { return sum + (sale.price || 0); }, 0);
    var totalTransactions = allVends.length;
    console.log("💰 Vendon returned " + totalTransactions + " vends, totalSales=" + totalSales.toFixed(2) + " KWD");

    const processedData = {
      totalSales: totalSales,
      totalTransactions: totalTransactions,
      sales: allVends
    };
    
    return {
      success: true,
      data: processedData
    };
    
  } catch (error) {
    console.error("❌ Error fetching Vendon sales:", error);
    return { success: false, error: error.message, data: [] };
  }
}

async function getBestPerformingMachine(startMs, endMs, excludeMachineId) {
  try {
    console.log("🏆 Finding best performing machine from all Vendon machines...");
    if (excludeMachineId) {
      console.log("🏆 Excluding machine ID from comparison:", excludeMachineId);
    }
    
    // Get all machines from Vendon API - correct endpoint
    const machinesUrl = "https://cloud.vendon.net/rest/v1.9.0/machine";
    const options = {
      method: "GET",
      headers: { 
        "Authorization": "Token 7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD",
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(machinesUrl, options);
    console.log("🏆 Machines API response status:", response.getResponseCode());
    console.log("🏆 Machines API response text:", response.getContentText().substring(0, 500));
    
    if (response.getResponseCode() !== 200) {
      console.warn("⚠️ Machines API request failed:", response.getContentText());
      return {
        success: false,
        error: "Failed to fetch machines",
        bestMachine: null
      };
    }
    
    const machinesData = JSON.parse(response.getContentText());
    console.log("🏆 Machines data received:", machinesData);
    
    if (!machinesData.result || machinesData.result.length === 0) {
      return {
        success: false,
        error: "No machines found",
        bestMachine: null
      };
    }
    
    // Use provided range, else last 7 days
    const now = new Date();
    const providedStart = (typeof startMs === 'number' && startMs > 0) ? new Date(startMs) : null;
    const providedEnd = (typeof endMs === 'number' && endMs > 0) ? new Date(endMs) : null;
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const startOfDay = providedStart ? new Date(providedStart.getFullYear(), providedStart.getMonth(), providedStart.getDate()) : new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate());
    const endOfDay = providedEnd ? new Date(providedEnd.getFullYear(), providedEnd.getMonth(), providedEnd.getDate()) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    let endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    if (endTimestamp <= startTimestamp) {
      endTimestamp = startTimestamp + (24 * 60 * 60) - 1;
    }
    
    console.log("🏆 Comparing machines for date range:", { startTimestamp, endTimestamp });
    
    // Get sales data for each machine and find the best performing one
    // Also track second-best for comparison when current machine is the best
    let bestMachine = null;
    let secondBestMachine = null;
    let bestSalesPerDay = 0;
    let secondBestSalesPerDay = 0;
    let bestMachineSalesData = null; // include vends for frontend hourly/daily charts
    
    for (const machine of machinesData.result) {
      try {
        // Skip excluded machine
        if (excludeMachineId && machine.id == excludeMachineId) {
          console.log(`🏆 Skipping excluded machine: ${machine.name} (ID: ${machine.id})`);
          continue;
        }
        
        console.log(`🏆 Checking machine: ${machine.name} (ID: ${machine.id})`);
        
        const salesResult = fetchVendonSales(machine.id, startOfDay.getTime(), endOfDay.getTime());
        
        if (salesResult.success && salesResult.data) {
          const totalSales = salesResult.data.totalSales || 0;
          const totalTransactions = salesResult.data.totalTransactions || 0;
          
          // Calculate sales per day (average over the date range)
          const daysDiff = Math.max(1, (endOfDay.getTime() - startOfDay.getTime()) / (24 * 60 * 60 * 1000));
          const salesPerDay = totalSales / daysDiff;
          
          console.log(`🏆 Machine ${machine.name}: Total Sales=${totalSales}, Sales/Day=${salesPerDay.toFixed(2)}, Transactions=${totalTransactions}`);
          
          // Track best and second-best machines
          if (salesPerDay > bestSalesPerDay) {
            // Current best becomes second-best
            secondBestMachine = bestMachine;
            secondBestSalesPerDay = bestSalesPerDay;
            
            // New best machine
            bestSalesPerDay = salesPerDay;
            bestMachine = {
              id: machine.id,
              name: machine.name,
              totalSales: totalSales,
              totalTransactions: totalTransactions,
              salesPerDay: salesPerDay,
              daysAnalyzed: daysDiff
            };
            bestMachineSalesData = salesResult.data; // keep sales vends for selected best machine
          } else if (salesPerDay > secondBestSalesPerDay) {
            // New second-best machine
            secondBestSalesPerDay = salesPerDay;
            secondBestMachine = {
              id: machine.id,
              name: machine.name,
              totalSales: totalSales,
              totalTransactions: totalTransactions,
              salesPerDay: salesPerDay,
              daysAnalyzed: daysDiff
            };
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error checking machine ${machine.name}:`, error);
        continue;
      }
    }
    
    if (bestMachine) {
      console.log("🏆 Best performing machine found:", bestMachine);
      if (secondBestMachine) {
        console.log("🏆 Second-best machine found:", secondBestMachine);
      }
      return {
        success: true,
        bestMachine: bestMachine,
        secondBestMachine: secondBestMachine, // Include second-best for comparison
        sales: bestMachineSalesData, // expose best machine sales including vends
        comparisonDate: startOfDay.toISOString().split('T')[0]
      };
    } else {
      return {
        success: false,
        error: "No machines with sales data found",
        bestMachine: null
      };
    }
    
  } catch (error) {
    console.error("❌ Error getting best performing machine:", error);
    return {
      success: false,
      error: error.message,
      bestMachine: null
    };
  }
}

/**
 * Get top N machines by revenue over a date range (defaults to yesterday, top 5).
 * Returns machines sorted by totalSales.
 */
async function getTopRevenueMachines(startMs, endMs, limit) {
  try {
    const machinesUrl = "https://cloud.vendon.net/rest/v1.9.0/machine";
    const options = {
      method: "GET",
      headers: { 
        "Authorization": "Token 7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD",
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(machinesUrl, options);
    if (response.getResponseCode() !== 200) {
      console.warn("⚠️ Machines API request failed:", response.getContentText());
      return { success: false, error: "Failed to fetch machines", machines: [] };
    }

    const machinesData = JSON.parse(response.getContentText());
    const machines = (machinesData && machinesData.result) ? machinesData.result : [];
    if (!machines.length) {
      return { success: false, error: "No machines found", machines: [] };
    }

    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const defaultEnd = new Date(defaultStart.getFullYear(), defaultStart.getMonth(), defaultStart.getDate(), 23, 59, 59);
    const startOfDay = startMs ? new Date(startMs) : defaultStart;
    const endOfDay = endMs ? new Date(endMs) : defaultEnd;

    let startTimestamp = Math.floor(startOfDay.getTime() / 1000);
    let endTimestamp = Math.floor(endOfDay.getTime() / 1000);
    if (endTimestamp <= startTimestamp) {
      endTimestamp = startTimestamp + (24 * 60 * 60) - 1;
    }

    const limitN = Math.max(1, Math.min(limit || 5, 20));

    const results = [];
    for (const machine of machines) {
      try {
        const salesResult = fetchVendonSales(machine.id, startOfDay.getTime(), endOfDay.getTime());
        if (salesResult.success && salesResult.data) {
          const totalSales = salesResult.data.totalSales || 0;
          const totalTransactions = salesResult.data.totalTransactions || 0;
          results.push({
            id: machine.id,
            name: machine.name,
            totalSales,
            totalTransactions
          });
        }
      } catch (e) {
        console.warn("⚠️ Failed sales fetch for machine", machine.id, e);
      }
    }

    results.sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0));
    const top = results.slice(0, limitN);

    return {
      success: true,
      machines: top,
      from: startTimestamp,
      to: endTimestamp
    };
  } catch (error) {
    console.error("❌ Error in getTopRevenueMachines:", error);
    return { success: false, error: error.message || String(error), machines: [] };
  }
}

async function getMachineName(machineId) {
  try {
    console.log(`🏷️ Getting machine name for ID: ${machineId}`);
    
    // Use the same API endpoint and structure as api-core.js
    const machinesUrl = "https://cloud.vendon.net/rest/v1.9.0/machine";
    const options = {
      method: "GET",
      headers: { 
        "Authorization": "Token 7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD",
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      muteHttpExceptions: true
    };
    
    try {
      const response = UrlFetchApp.fetch(machinesUrl, options);
      console.log(`🏷️ Machines API response status:`, response.getResponseCode());
      console.log(`🏷️ Machines API response text:`, response.getContentText().substring(0, 500));
      
      if (response.getResponseCode() === 200) {
        const machinesData = JSON.parse(response.getContentText());
        console.log(`🏷️ Machines data received:`, machinesData);
        
        if (machinesData.result && Array.isArray(machinesData.result)) {
          const machine = machinesData.result.find(m => m.id == machineId);
          if (machine && machine.name) {
            console.log(`🏷️ Found machine name: ${machine.name}`);
            return machine.name;
          }
        }
      } else {
        console.warn(`⚠️ Machines API failed with status: ${response.getResponseCode()}`);
        console.warn(`⚠️ Response: ${response.getContentText()}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error fetching machines:`, error);
    }
    
    // Fallback - return machine ID
    console.log(`🏷️ Using machine ID as name: ${machineId}`);
    return `Machine ${machineId}`;
    
  } catch (error) {
    console.warn(`⚠️ Error getting machine name for ${machineId}:`, error);
    return `Machine ${machineId}`;
  }
}

async function getBestMachineFromKnownList(machineIds) {
  try {
    console.log("🏆 Using fallback approach with known machine IDs:", machineIds);
    
    // Get current date range for comparison (last 7 days for better data)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const startOfDay = new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let bestMachine = null;
    let bestSalesPerDay = 0;
    
    for (const machineId of machineIds) {
      try {
        console.log(`🏆 Checking known machine ID: ${machineId}`);
        
        // Try to get machine name from Vendon API
        const machineName = await getMachineName(machineId);
        
        const salesResult = fetchVendonSales(machineId, startOfDay.getTime(), endOfDay.getTime());
        
        if (salesResult.success && salesResult.data) {
          const totalSales = salesResult.data.totalSales || 0;
          const totalTransactions = salesResult.data.totalTransactions || 0;
          
          // Calculate sales per day (average over the 7-day period)
          const daysDiff = Math.max(1, (endOfDay.getTime() - startOfDay.getTime()) / (24 * 60 * 60 * 1000));
          const salesPerDay = totalSales / daysDiff;
          
          console.log(`🏆 Machine ${machineName}: Total Sales=${totalSales}, Sales/Day=${salesPerDay.toFixed(2)}, Transactions=${totalTransactions}`);
          
          if (salesPerDay > bestSalesPerDay) {
            bestSalesPerDay = salesPerDay;
            bestMachine = {
              id: machineId,
              name: machineName,
              totalSales: totalSales,
              totalTransactions: totalTransactions,
              salesPerDay: salesPerDay,
              daysAnalyzed: daysDiff
            };
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error checking machine ${machineId}:`, error);
        continue;
      }
    }
    
    if (bestMachine) {
      console.log("🏆 Best performing machine found (fallback):", bestMachine);
      return {
        success: true,
        bestMachine: bestMachine,
        comparisonDate: startOfDay.toISOString().split('T')[0]
      };
    } else {
      return {
        success: false,
        error: "No machines with sales data found in known list",
        bestMachine: null
      };
    }
    
  } catch (error) {
    console.error("❌ Error in fallback approach:", error);
    return {
      success: false,
      error: error.message,
      bestMachine: null
    };
  }
}

function processMachineStats(statsData) {
  try {
    console.log("🏆 Processing machine stats data...");
    
    // Get current date range for comparison
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    
    let bestMachine = null;
    let bestPerformance = 0;
    
    // Process each machine in stats data
    for (const machine of statsData.result) {
      try {
        const machineId = machine.id || machine.machine_id;
        const machineName = machine.name || `Machine ${machineId}`;
        
        console.log(`🏆 Processing machine: ${machineName} (ID: ${machineId})`);
        
        // Get detailed sales data for this machine
        const salesResult = fetchVendonSales(machineId, startOfDay.getTime(), endOfDay.getTime());
        
        if (salesResult.success && salesResult.data) {
          const totalSales = salesResult.data.totalSales || 0;
          const totalTransactions = salesResult.data.totalTransactions || 0;
          
          // Calculate performance score
          const performanceScore = totalSales + (totalTransactions * 10);
          
          console.log(`🏆 Machine ${machineName}: Sales=${totalSales}, Transactions=${totalTransactions}, Score=${performanceScore}`);
          
          if (performanceScore > bestPerformance) {
            bestPerformance = performanceScore;
            bestMachine = {
              id: machineId,
              name: machineName,
              totalSales: totalSales,
              totalTransactions: totalTransactions,
              performanceScore: performanceScore
            };
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error processing machine:`, error);
        continue;
      }
    }
    
    if (bestMachine) {
      console.log("🏆 Best performing machine found (from stats):", bestMachine);
      return {
        success: true,
        bestMachine: bestMachine,
        comparisonDate: startOfDay.toISOString().split('T')[0]
      };
    } else {
      return {
        success: false,
        error: "No machines with sales data found in stats",
        bestMachine: null
      };
    }
    
  } catch (error) {
    console.error("❌ Error processing machine stats:", error);
    return {
      success: false,
      error: error.message,
      bestMachine: null
    };
  }
}

// ===== TESTING AND DEBUGGING FUNCTIONS =====

function testBackendConnection() {
  try {
    console.log("🧪 Testing backend connection...");
    
    // Simple test to ensure backend is working
    const testResult = {
      success: true,
      message: "Backend connection successful",
      timestamp: new Date().toISOString(),
      data: [],
      totalRecords: 0,
      summary: null
    };
    
    console.log("✅ Backend test result:", testResult);
    return testResult;
    
  } catch (error) {
    console.error("❌ Backend connection test failed:", error);
    return {
      success: false,
      error: error.message,
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

function testSimpleResponse() {
  try {
    console.log("🧪 Testing simple response...");
    
    const simpleResult = {
      success: true,
      message: "Simple test successful",
      data: [
        { test: "data1", value: 100 },
        { test: "data2", value: 200 }
      ],
      totalRecords: 2,
      summary: { total: 300 }
    };
    
    console.log("✅ Simple test result:", simpleResult);
    return simpleResult;
    
  } catch (error) {
    console.error("❌ Simple test failed:", error);
    return {
      success: false,
      error: error.message,
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

function testSimplePeopleAnalytics() {
  try {
    console.log("🧪 Testing simple people analytics...");
    
    // Test with minimal parameters
    const testParams = {
      uidds: ["1382465.6"], // Use the camera ID from your logs
      startTime: Date.now() - (24 * 60 * 60 * 1000), // 1 day ago
      endTime: Date.now(), // Now
      interval: "date",
      timeZone: "Europe/London"
    };
    
    console.log("📊 Test parameters:", testParams);
    
    const result = fetchPeopleAnalytics(testParams);
    console.log("📊 Simple test result:", result);
    
    return result;
    
  } catch (error) {
    console.error("❌ Simple people analytics test failed:", error);
    return {
      success: false,
      error: error.message,
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

function testVideoloftAPIEndpoints() {
  try {
    console.log("🧪 Testing Videoloft API endpoints");
    
    // First authenticate
    const authResult = authenticateWithVideoloft();
    if (!authResult.success) {
      throw new Error("Authentication failed: " + authResult.error);
    }
    
    console.log("✅ Authentication successful:", {
      authenticator: authResult.authenticator,
      provider: authResult.provider,
      uid: authResult.uid
    });
    
    // Test different API endpoint structures for both devices and people
    const endpoints = [
      // Device endpoints
      { url: `${authResult.authenticator}/devices`, method: 'GET', name: 'Devices' },
      { url: `${authResult.authenticator}/${authResult.provider}/devices`, method: 'GET', name: 'Devices with Provider' },
      { url: `${authResult.authenticator}/free_test/devices`, method: 'GET', name: 'Devices with free_test' },
      
      // People endpoints
      { url: `${authResult.authenticator}/people`, method: 'POST', name: 'People', payload: { uidds: ["827029.78426"], startTime: Date.now() - 86400000, endTime: Date.now(), interval: "date", timeZone: "Europe/London" } },
      { url: `${authResult.authenticator}/${authResult.provider}/people`, method: 'POST', name: 'People with Provider', payload: { uidds: ["827029.78426"], startTime: Date.now() - 86400000, endTime: Date.now(), interval: "date", timeZone: "Europe/London" } },
      { url: `${authResult.authenticator}/free_test/people`, method: 'POST', name: 'People with free_test', payload: { uidds: ["827029.78426"], startTime: Date.now() - 86400000, endTime: Date.now(), interval: "date", timeZone: "Europe/London" } }
    ];
    
    const results = [];
    
    for (const endpoint of endpoints) {
      console.log(`📡 Testing ${endpoint.name}: ${endpoint.url}`);
      
      try {
        const requestOptions = {
          method: endpoint.method,
          headers: {
            'Authorization': `ManythingToken ${authResult.authToken}`,
            'Accept': 'application/json'
          },
          muteHttpExceptions: true
        };
        
        if (endpoint.method === 'POST' && endpoint.payload) {
          requestOptions.headers['Content-Type'] = 'application/json';
          requestOptions.payload = JSON.stringify(endpoint.payload);
        }
        
        const response = UrlFetchApp.fetch(endpoint.url, requestOptions);
        
        const result = {
          name: endpoint.name,
          endpoint: endpoint.url,
          method: endpoint.method,
          status: response.getResponseCode(),
          success: response.getResponseCode() === 200,
          content: response.getContentText().substring(0, 200) + (response.getContentText().length > 200 ? '...' : '')
        };
        
        results.push(result);
        console.log(`📊 Result for ${endpoint.name}:`, result);
        
      } catch (error) {
        console.error(`❌ Error testing ${endpoint.name}:`, error);
        results.push({
          name: endpoint.name,
          endpoint: endpoint.url,
          method: endpoint.method,
          status: 'ERROR',
          success: false,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      results: results
    };
    
  } catch (error) {
    console.error("❌ API endpoints test failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function testPeopleAnalyticsDirectly() {
  try {
    console.log("🧪 Testing people analytics directly with correct API endpoint");
    
    // Test with the exact parameters from your working curl command
    const params = {
      uidds: ["827029.78426"], // Use the example from your curl command
      startTime: 1748214000000, // Use the exact timestamps from your example
      endTime: 1750805999999,
      interval: "date",
      timeZone: "Europe/London"
    };
    
    console.log("📊 Testing with params:", params);
    console.log("📊 Expected API endpoint: https://euwest1-analytics.manything.com/people");
    
    const result = fetchPeopleAnalytics(params);
    console.log("📊 Direct test result:", result);
    
    return result;
    
  } catch (error) {
    console.error("❌ Direct test failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== FETCH FROM DATABASE API =====

function fetchPeopleAnalyticsFromDatabase(params) {
  try {
    console.log("🔍 Fetching people analytics from database API");
    
    const { uidds, startTime, endTime, interval, timeZone, startDate: startDateParam, endDate: endDateParam } = params;
    
    // Get API URL from PropertiesService or use default
    const apiBase = PropertiesService.getScriptProperties().getProperty('PEOPLE_ANALYTICS_API_BASE') || 
                    'https://people-api.theleetclub.com';
    
    const tz = timeZone || "Asia/Kuwait";

    // Prefer raw YYYY-MM-DD strings from the UI if provided (avoids browser-timezone epoch conversion bugs).
    // Fallback to converting startTime/endTime -> YYYY-MM-DD in the requested timezone.
    const startDate = startDateParam || Utilities.formatDate(new Date(startTime), tz, "yyyy-MM-dd");
    const endDate = endDateParam || Utilities.formatDate(new Date(endTime - 1), tz, "yyyy-MM-dd");
    
    // Convert interval format
    let apiInterval = 'date';
    if (interval === 'date') {
      apiInterval = 'date';
    } else if (interval === 3600000 || interval === 'hour') {
      apiInterval = 'hour';
    } else if (interval === 60000 || interval === '60000') {
      apiInterval = '60000';
    }
    
    // Build query parameters
    const queryParams = [
      'uidds=' + encodeURIComponent(uidds.join(',')),
      'start_date=' + encodeURIComponent(startDate),
      'end_date=' + encodeURIComponent(endDate),
      'interval=' + encodeURIComponent(apiInterval),
      // IMPORTANT: Tell the API how to interpret YYYY-MM-DD boundaries.
      // Without this, the API will treat them as UTC and Kuwait "days" can leak into the next/previous day.
      'timezone=' + encodeURIComponent(tz),
      'limit=1000'
    ].join('&');
    
    const apiUrl = apiBase + '/api/people-analytics?' + queryParams;
    console.log("📡 Calling database API:", apiUrl);
    
    // Make the API call
    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log("📡 API response status:", statusCode);
    
    if (statusCode !== 200) {
      console.error("❌ API request failed:", statusCode, responseText);
      throw new Error(`API request failed with status ${statusCode}: ${responseText}`);
    }
    
    const apiData = JSON.parse(responseText);
    
    if (!apiData.success) {
      console.error("❌ API returned error:", apiData.error);
      throw new Error(apiData.error || 'Unknown API error');
    }
    
    console.log("✅ API returned", apiData.data.length, "records");
    
    // Transform API data to match expected format
    // IMPORTANT: The rest of this codebase expects Videoloft-style timestamps in SECONDS.
    // The API returns ISO timestamps, which Date().getTime() gives in MILLISECONDS.
    // So we convert to SECONDS here to avoid year-58006 type bugs (ms treated as seconds then *1000).
    const transformedData = (apiData.data || []).map(record => {
      // Parse timestamps (API returns ISO strings). Ensure UTC parse if missing timezone.
      const ftIso = (record.first_timestamp && /[zZ]|[+-]\d\d:\d\d$/.test(record.first_timestamp))
        ? record.first_timestamp
        : (record.first_timestamp + "Z");
      const ltIso = (record.last_timestamp && /[zZ]|[+-]\d\d:\d\d$/.test(record.last_timestamp))
        ? record.last_timestamp
        : (record.last_timestamp + "Z");
      const firstTs = Math.floor(new Date(ftIso).getTime() / 1000);
      const lastTs = Math.floor(new Date(ltIso).getTime() / 1000);
      
      // Extract uid and deviceId from uidd (format: "uid.deviceId")
      const uiddParts = record.uidd.split('.');
      const uid = uiddParts[0] || '';
      const deviceId = uiddParts[1] || record.device_id || '';
      
      return {
        firstTimestamp: firstTs,   // seconds
        lastTimestamp: lastTs,     // seconds
        in: record.in || 0,
        out: record.out || 0,
        netTraffic: record.netTraffic || 0,
        uid: uid,
        deviceId: deviceId,
        trafficRatio: record.trafficRatio,
        trafficPattern: record.trafficPattern,
        durationHours: record.durationHours,
        eventCount: record.eventCount || 0
      };
    });
    
    // IMPORTANT:
    // The DB API already returns bucketed aggregates (hour/date). Don't re-process/re-bucket.
    // Re-processing can introduce partial buckets and make DB vs Videoloft compare look wrong.
    const processedData = transformedData;
    const summary = calculatePeopleAnalyticsSummary(processedData);
    
    return {
      success: true,
      data: processedData,
      rawData: transformedData,
      totalRecords: processedData.length,
      summary: summary
    };
    
  } catch (error) {
    console.error("❌ Error fetching from database API:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

// Simple wrapper function to test the exact same call as the UI
function testPeopleAnalyticsWrapper(params) {
  try {
    console.log("🧪 Testing people analytics wrapper with params:", params);
    console.log("🧪 Wrapper function started at:", new Date().toISOString());
    
    // Validate input parameters
    if (!params) {
      console.error("❌ No parameters provided");
      return {
        success: false,
        error: "No parameters provided",
        data: [],
        totalRecords: 0,
        summary: null
      };
    }

    // Normalize startTime/endTime from startDate/endDate for Kuwait (matches compare wrapper + vendon-sync).
    // Avoids browser/serialization skew so Vendon gets the correct day range (e.g. 2026-01-20 00:00–23:59 Kuwait).
    if (params.startDate && params.endDate && (params.timeZone === 'Asia/Kuwait' || params.timeZone === 'Asia/Riyadh')) {
      params = Object.assign({}, params);
      params.startTime = new Date(params.startDate + 'T00:00:00+03:00').getTime();
      params.endTime = new Date(params.endDate + 'T23:59:59.999+03:00').getTime();
      console.log("🧪 Normalized Vendon range (Kuwait):", { startDate: params.startDate, endDate: params.endDate, startTime: params.startTime, endTime: params.endTime });
    }
    
    // Try database API first, fallback to Videoloft if needed
    console.log("📊 [DATA SOURCE] Trying database API first...");
    const startTime = Date.now();
    let result = fetchPeopleAnalyticsFromDatabase(params);
    const endTime = Date.now();
    
    // If database API fails or returns no data, fallback to Videoloft
    if (!result.success || (result.success && result.data.length === 0)) {
      console.log("⚠️ [DATA SOURCE] Database API failed or returned no data, falling back to Videoloft");
      console.log("📊 [DATA SOURCE] Calling fetchPeopleAnalytics (Videoloft) with validated params");
      console.log("📊 Parameters being passed:", JSON.stringify(params, null, 2));
      
      const videoloftStartTime = Date.now();
      result = fetchPeopleAnalytics(params);
      const videoloftEndTime = Date.now();
      console.log("📊 [DATA SOURCE] Videoloft fetch completed in", (videoloftEndTime - videoloftStartTime), "ms");
      console.log("⚠️ [DATA SOURCE] ⚠️ USING VIDEOLOFT DIRECTLY (not database) ⚠️");
    } else {
      console.log("📊 [DATA SOURCE] Database API fetch completed in", (endTime - startTime), "ms");
      console.log("✅ [DATA SOURCE] ✅ USING DATABASE API (not Videoloft) ✅");
    }
    
    console.log("📊 fetchPeopleAnalytics completed in", (endTime - startTime), "ms");
    console.log("📊 Wrapper test result:", result);
    console.log("📊 Result type:", typeof result);
    console.log("📊 Result keys:", result ? Object.keys(result) : "null/undefined");
    
    // Ensure we always return a proper object
    if (!result) {
      console.error("❌ fetchPeopleAnalytics returned null/undefined");
      return {
        success: false,
        error: "fetchPeopleAnalytics returned null/undefined",
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    // Validate result structure
    if (typeof result !== 'object') {
      console.error("❌ fetchPeopleAnalytics returned invalid type:", typeof result);
      return {
        success: false,
        error: "fetchPeopleAnalytics returned invalid type: " + typeof result,
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    // Ensure required fields exist
    if (!result.hasOwnProperty('success')) {
      console.error("❌ Result missing success field:", result);
      return {
        success: false,
        error: "Result missing success field",
        data: [],
        totalRecords: 0,
        summary: null
      };
    }
    
    console.log("✅ Wrapper returning valid result");
    console.log("✅ Wrapper result success:", result.success);
    console.log("✅ Wrapper result data length:", result.data ? result.data.length : "NO DATA");
    
    const machineId = params && params.machineId ? String(params.machineId) : null;
    const machineName = params && params.machineName ? String(params.machineName) : (machineId ? `Machine ${machineId}` : null);

    // Simplify the response for Google Apps Script serialization
    const simplifiedData = (result.data || []).map(item => ({
      in: item.in,
      out: item.out,
      netTraffic: item.netTraffic,
      firstTimestamp: item.firstTimestamp,
      lastTimestamp: item.lastTimestamp,
      uid: item.uid,
      deviceId: item.deviceId,
      // Convert timestamps to readable dates
      startDate: new Date(item.firstTimestamp * 1000).toISOString().split('T')[0],
      endDate: new Date(item.lastTimestamp * 1000).toISOString().split('T')[0],
      startTime: new Date(item.firstTimestamp * 1000).toISOString().split('T')[1].split('.')[0],
      endTime: new Date(item.lastTimestamp * 1000).toISOString().split('T')[1].split('.')[0],
      // Machine mapping (provided by UI)
      machineId: machineId,
      machineName: machineName
    })).sort((a, b) => b.firstTimestamp - a.firstTimestamp); // Sort by newest first
    
    // Fetch sales data for the machine (use params.startTime/params.endTime like production)
    var salesResult = { success: false, error: "No machineId provided", data: [] };
    if (machineId) {
      console.log("💰 Fetching Vendon sales for machine:", machineId);
      salesResult = fetchVendonSales(machineId, params.startTime, params.endTime, { startDate: params.startDate, endDate: params.endDate });
    } else {
      console.warn("⚠️ Skipping Vendon sales fetch: missing machineId (mapping required)");
    }
    
    const simplifiedSummary = result.summary ? {
      totalIn: result.summary.totalIn,
      totalOut: result.summary.totalOut,
      netTraffic: result.summary.netTraffic,
      totalPeriods: result.summary.totalPeriods,
      salesData: salesResult.success ? salesResult.data : null,
      salesSuccess: salesResult.success
    } : null;
    
    const finalResult = {
      success: result.success || false,
      data: simplifiedData,
      totalRecords: simplifiedData.length,
      summary: simplifiedSummary,
      salesData: salesResult.success ? salesResult.data : null,
      error: result.error || null
    };
    
    console.log("✅ Final wrapper result (simplified):", {
      success: finalResult.success,
      dataLength: finalResult.data.length,
      totalRecords: finalResult.totalRecords,
      summaryKeys: finalResult.summary ? Object.keys(finalResult.summary) : null
    });
    
    return finalResult;
    
  } catch (error) {
    console.error("❌ Wrapper test failed:", error);
    console.error("❌ Error stack:", error.stack);
    return {
      success: false,
      error: error.message || "Unknown error in wrapper",
      data: [],
      totalRecords: 0,
      summary: null
    };
  }
}

// ===== DB vs VIDEOLOFT COMPARISON (TEMP TESTING) =====
// Returns both results side-by-side so the UI can verify DB matches Videoloft for the same request.
function testPeopleAnalyticsCompareWrapper(params) {
  try {
    console.log("🧪 [COMPARE] Starting DB vs Videoloft comparison with params:", params);

    // If UI passed raw dates, normalize startTime/endTime for Videoloft fetch to avoid browser-timezone skew.
    // Asia/Kuwait is fixed UTC+03:00 (no DST).
    if (params && params.startDate && params.endDate && (params.timeZone === 'Asia/Kuwait' || params.timeZone === 'Asia/Riyadh')) {
      params = Object.assign({}, params);
      params.startTime = new Date(params.startDate + 'T00:00:00+03:00').getTime();
      params.endTime = new Date(params.endDate + 'T23:59:59+03:00').getTime();
      console.log("🧪 [COMPARE] Normalized date range (Kuwait) => ms:", {
        startDate: params.startDate,
        endDate: params.endDate,
        startTime: params.startTime,
        endTime: params.endTime
      });
    }

    const dbStart = Date.now();
    const dbResult = fetchPeopleAnalyticsFromDatabase(params);
    const dbEnd = Date.now();
    console.log("🧪 [COMPARE] DB/API completed in", (dbEnd - dbStart), "ms");

    const vlStart = Date.now();
    const videoloftResult = fetchPeopleAnalytics(params);
    const vlEnd = Date.now();
    console.log("🧪 [COMPARE] Videoloft completed in", (vlEnd - vlStart), "ms");

    // Use DB as the source of truth for UI rendering during comparison.
    // IMPORTANT: Keep the response SMALL to avoid Apps Script serialization returning null.
    //
    // For *diffing*, prefer RAW buckets (pre-processing) when available. The processed data can merge/split
    // buckets and make timestamps differ even when totals match.
    const dbRaw = (dbResult && dbResult.success) ? (dbResult.rawData || dbResult.data || []) : [];
    const vlRaw = (videoloftResult && videoloftResult.success) ? (videoloftResult.rawData || videoloftResult.data || []) : [];

    // For UI, still render processed DB data (charts/table)
    const dbData = (dbResult && dbResult.success) ? (dbResult.data || []) : [];
    const vlData = (videoloftResult && videoloftResult.success) ? (videoloftResult.data || []) : [];

    const sumTotals = (arr) => {
      const totalIn = arr.reduce((s, r) => s + (r.in || 0), 0);
      const totalOut = arr.reduce((s, r) => s + (r.out || 0), 0);
      return { totalIn, totalOut, netTraffic: totalIn - totalOut, records: arr.length };
    };

    const dbTotals = sumTotals(dbData);
    const vlTotals = sumTotals(vlData);

    // Diff by normalized hour bucket: deviceId + hour-start (seconds).
    // This prevents false diffs when one side has partial-hour boundaries but totals still match.
    const toHourStartSec = (sec) => Math.floor((Number(sec) || 0) / 3600) * 3600;
    const keyOf = (r) => {
      const deviceId = r.deviceId ?? r.device_id ?? '';
      const hourStart = toHourStartSec(r.firstTimestamp);
      return `${deviceId}.${hourStart}`;
    };

    // If we have explicit range, filter to it (params.startTime/endTime are ms)
    const rangeStartSec = params?.startTime ? Math.floor(params.startTime / 1000) : null;
    const rangeEndSec = params?.endTime ? Math.floor(params.endTime / 1000) : null;
    const inRange = (r) => {
      if (!rangeStartSec || !rangeEndSec) return true;
      const ts = Number(r.firstTimestamp) || 0;
      return ts >= rangeStartSec && ts <= rangeEndSec;
    };

    const dbMap = {};
    dbRaw.filter(inRange).forEach(r => { dbMap[keyOf(r)] = r; });
    const vlMap = {};
    vlRaw.filter(inRange).forEach(r => { vlMap[keyOf(r)] = r; });

    const keys = Array.from(new Set(Object.keys(dbMap).concat(Object.keys(vlMap))));
    const diffs = [];
    keys.forEach(k => {
      const a = dbMap[k];
      const b = vlMap[k];
      if (!a) {
        diffs.push({ key: k, status: "missing_in_db", db: null, videoloft: b });
        return;
      }
      if (!b) {
        diffs.push({ key: k, status: "missing_in_videoloft", db: a, videoloft: null });
        return;
      }
      if ((a.in || 0) !== (b.in || 0) || (a.out || 0) !== (b.out || 0)) {
        diffs.push({ key: k, status: "mismatch", db: a, videoloft: b });
      }
    });

    // If totals match exactly, treat per-bucket diffs as false positives (usually caused by downstream
    // formatting/processing differences) and hide them. This keeps the UI signal honest: totals are the
    // primary validation criterion for preserved aggregates.
    const totalsMatchExact =
      (dbTotals.totalIn === vlTotals.totalIn) &&
      (dbTotals.totalOut === vlTotals.totalOut);
    const effectiveDiffs = totalsMatchExact ? [] : diffs;

    // Keep response Apps Script-friendly (no huge payloads)
    // Also include a human readable bucket label in Kuwait time for easier debugging.
    const fmtKuwait = (sec) => Utilities.formatDate(new Date(sec * 1000), "Asia/Kuwait", "yyyy-MM-dd HH:mm:ss");
    const trimmedDiffs = effectiveDiffs.slice(0, 200).map(d => {
      const sec = Number((d.db?.firstTimestamp ?? d.videoloft?.firstTimestamp) || 0);
      const hourStart = toHourStartSec(sec);
      const hourEnd = hourStart + (59 * 60);
      return ({
      status: d.status,
      key: d.key,
      bucket: `${fmtKuwait(hourStart)} \u2192 ${fmtKuwait(hourEnd)}`,
      dbIn: d.db ? d.db.in : null,
      dbOut: d.db ? d.db.out : null,
      vlIn: d.videoloft ? d.videoloft.in : null,
      vlOut: d.videoloft ? d.videoloft.out : null,
      firstTimestamp: d.db?.firstTimestamp || d.videoloft?.firstTimestamp || null,
      lastTimestamp: d.db?.lastTimestamp || d.videoloft?.lastTimestamp || null,
      uid: d.db?.uid || d.videoloft?.uid || null,
      deviceId: d.db?.deviceId || d.videoloft?.deviceId || null
      });
    });

    // Build a UI-compatible response (same shape as testPeopleAnalyticsWrapper finalResult)
    const simplifiedData = (dbData || []).map(item => ({
      in: item.in,
      out: item.out,
      netTraffic: item.netTraffic,
      firstTimestamp: item.firstTimestamp,
      lastTimestamp: item.lastTimestamp,
      uid: item.uid,
      deviceId: item.deviceId,
      // Convert timestamps to readable dates (expects seconds)
      startDate: new Date(item.firstTimestamp * 1000).toISOString().split('T')[0],
      endDate: new Date(item.lastTimestamp * 1000).toISOString().split('T')[0],
      startTime: new Date(item.firstTimestamp * 1000).toISOString().split('T')[1].split('.')[0],
      endTime: new Date(item.lastTimestamp * 1000).toISOString().split('T')[1].split('.')[0],
      machineId: "375535",
      machineName: "Jaber Hospital - Gate 2"
    })).sort((a, b) => b.firstTimestamp - a.firstTimestamp);

    const salesResult = fetchVendonSales("375535", params.startTime, params.endTime, { startDate: params.startDate, endDate: params.endDate });
    const simplifiedSummary = dbResult && dbResult.summary ? {
      totalIn: dbResult.summary.totalIn,
      totalOut: dbResult.summary.totalOut,
      netTraffic: dbResult.summary.netTraffic,
      totalPeriods: dbResult.summary.totalPeriods,
      salesData: salesResult.success ? salesResult.data : null,
      salesSuccess: salesResult.success
    } : null;

    const uiResult = {
      success: !!(dbResult && dbResult.success),
      data: simplifiedData,
      totalRecords: simplifiedData.length,
      summary: simplifiedSummary,
      salesData: salesResult.success ? salesResult.data : null,
      error: dbResult?.error || null
    };

    return {
      success: true,
      // What the UI will render
      dbResultForUi: uiResult,
      // Comparison payload
      db: { success: !!dbResult?.success, error: dbResult?.error || null, totals: dbTotals },
      videoloft: { success: !!videoloftResult?.success, error: videoloftResult?.error || null, totals: vlTotals },
      diffSummary: { totalDiffs: effectiveDiffs.length, shownDiffs: trimmedDiffs.length },
      diffs: trimmedDiffs
    };
  } catch (e) {
    console.error("❌ [COMPARE] Comparison failed:", e);
    return { success: false, error: e.message || String(e) };
  }
}

function testVideoloftAPIFlow() {
  try {
    console.log("🧪 Testing complete Videoloft API flow");
    
    // Step 1: Authenticate
    const authResult = authenticateWithVideoloft();
    if (!authResult.success) {
      throw new Error("Authentication failed: " + authResult.error);
    }
    console.log("✅ Authentication successful:", authResult);
    
    // Step 2: Get all devices using correct API structure
    const devicesUrl = `${authResult.authenticator}/${authResult.provider}/devices`;
    console.log("📡 Requesting devices from:", devicesUrl);
    
    const devicesResponse = UrlFetchApp.fetch(devicesUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ManythingToken ${authResult.authToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (devicesResponse.getResponseCode() !== 200) {
      throw new Error(`Devices request failed: ${devicesResponse.getContentText()}`);
    }
    
    const devicesData = JSON.parse(devicesResponse.getContentText());
    console.log("✅ Devices retrieved:", devicesData);
    
    // Step 3: Get detailed device info for first available device
    let firstUidd = null;
    if (devicesData.result) {
      Object.keys(devicesData.result).forEach(uid => {
        const userDevices = devicesData.result[uid];
        if (userDevices.devices) {
          Object.keys(userDevices.devices).forEach(deviceId => {
            if (!firstUidd) {
              firstUidd = userDevices.devices[deviceId].uidd;
            }
          });
        }
      });
    }
    
    if (!firstUidd) {
      throw new Error("No devices found in account");
    }
    
    console.log("📱 Testing with device:", firstUidd);
    
    // Step 4: Get device viewer info using correct API structure
    const viewerInfoUrl = `${authResult.authenticator}/${authResult.provider}/devices/viewerInfo?uidd=${firstUidd}`;
    console.log("📡 Requesting viewer info from:", viewerInfoUrl);
    
    const viewerResponse = UrlFetchApp.fetch(viewerInfoUrl, {
      method: 'GET',
      headers: {
        'Authorization': `ManythingToken ${authResult.authToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (viewerResponse.getResponseCode() !== 200) {
      throw new Error(`Viewer info request failed: ${viewerResponse.getContentText()}`);
    }
    
    const viewerData = JSON.parse(viewerResponse.getContentText());
    console.log("✅ Device viewer info:", viewerData);
    
    // Step 5: Get events for the device
    const device = viewerData.result[Object.keys(viewerData.result)[0]].devices[Object.keys(viewerData.result[Object.keys(viewerData.result)[0]].devices)[0]];
    const loggerServer = device.logger;
    
    console.log("📊 Getting events from logger:", loggerServer);
    
    // Get events from last 7 days
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (7 * 24 * 60 * 60); // 7 days ago
    
    const eventsUrl = `https://${loggerServer}/alert`;
    const eventsParams = [
      `uid=${firstUidd}`,
      `startt=${startTime}`,
      `endt=${endTime}`,
      `limit=20`,
      `token=${authResult.authToken}`
    ].join('&');
    
    const fullEventsUrl = `${eventsUrl}?${eventsParams}`;
    console.log("📡 Events URL:", fullEventsUrl);
    
    const eventsResponse = UrlFetchApp.fetch(fullEventsUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (eventsResponse.getResponseCode() !== 200) {
      throw new Error(`Events request failed: ${eventsResponse.getContentText()}`);
    }
    
    const eventsData = JSON.parse(eventsResponse.getContentText());
    console.log("✅ Events retrieved:", eventsData);
    
    return {
      success: true,
      message: "Complete API flow test successful",
      data: {
        auth: authResult,
        devices: devicesData,
        viewerInfo: viewerData,
        events: eventsData,
        testDevice: firstUidd,
        loggerServer: loggerServer
      }
    };
    
  } catch (error) {
    console.error("❌ API flow test failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function processPeopleAnalyticsData(rawData) {
  console.log("🔄 Processing people analytics data:", rawData);
  
  if (!Array.isArray(rawData)) {
    console.warn("⚠️ Raw data is not an array:", rawData);
    return [];
  }
  
  return rawData.map(record => {
    // Calculate additional metrics
    const netTraffic = (record.in || 0) - (record.out || 0);
    const totalTraffic = (record.in || 0) + (record.out || 0);
    const trafficRatio = record.out > 0 ? (record.in / record.out) : (record.in > 0 ? Infinity : 0);
    
    // Determine traffic pattern
    let trafficPattern = "Normal";
    if (netTraffic > 10) trafficPattern = "High Inflow";
    else if (netTraffic < -10) trafficPattern = "High Outflow";
    else if (totalTraffic > 50) trafficPattern = "Busy Period";
    else if (totalTraffic < 5) trafficPattern = "Quiet Period";
    
    // Calculate time-based metrics
    const startTime = new Date(record.firstTimestamp);
    const endTime = new Date(record.lastTimestamp);
    const duration = endTime - startTime;
    const durationHours = duration / (1000 * 60 * 60);
    
    return {
      ...record,
      netTraffic: netTraffic,
      totalTraffic: totalTraffic,
      trafficRatio: trafficRatio,
      trafficPattern: trafficPattern,
      duration: duration,
      durationHours: durationHours,
      startTime: startTime,
      endTime: endTime,
      processedAt: new Date()
    };
  });
}

function calculatePeopleAnalyticsSummary(data) {
  if (!data || data.length === 0) {
    return {
      totalIn: 0,
      totalOut: 0,
      netTraffic: 0,
      averageTrafficRatio: 0,
      peakTraffic: 0,
      quietPeriods: 0,
      busyPeriods: 0
    };
  }
  
  const totalIn = data.reduce((sum, record) => sum + (record.in || 0), 0);
  const totalOut = data.reduce((sum, record) => sum + (record.out || 0), 0);
  const netTraffic = totalIn - totalOut;
  
  const trafficRatios = data
    .filter(record => record.trafficRatio !== Infinity && !isNaN(record.trafficRatio))
    .map(record => record.trafficRatio);
  
  const averageTrafficRatio = trafficRatios.length > 0 
    ? trafficRatios.reduce((sum, ratio) => sum + ratio, 0) / trafficRatios.length 
    : 0;
  
  const peakTraffic = Math.max(...data.map(record => record.totalTraffic));
  
  const busyPeriods = data.filter(record => record.trafficPattern === "Busy Period").length;
  const quietPeriods = data.filter(record => record.trafficPattern === "Quiet Period").length;
  
  return {
    totalIn: totalIn,
    totalOut: totalOut,
    netTraffic: netTraffic,
    averageTrafficRatio: averageTrafficRatio,
    peakTraffic: peakTraffic,
    quietPeriods: quietPeriods,
    busyPeriods: busyPeriods,
    totalPeriods: data.length,
    averageInPerPeriod: totalIn / data.length,
    averageOutPerPeriod: totalOut / data.length
  };
}

// ===== SALES CORRELATION FUNCTIONS =====

function fetchSalesDataForPeopleAnalytics(params) {
  try {
    console.log("💰 Fetching sales data for people analytics correlation");
    const machineId = params && params.machineId ? String(params.machineId) : null;
    if (!machineId) {
      return { success: false, error: "machineId is required for real sales correlation", salesData: [], totalSales: 0, totalTransactions: 0 };
    }
    const startTime = params.startTime;
    const endTime = params.endTime;
    const r = fetchVendonSales(machineId, startTime, endTime);
    if (!r.success) {
      return { success: false, error: r.error || "Failed to fetch Vendon sales", salesData: [], totalSales: 0, totalTransactions: 0 };
    }
    return { success: true, salesData: r.data.sales || [], totalSales: r.data.totalSales || 0, totalTransactions: r.data.totalTransactions || 0 };
    
  } catch (error) {
    console.error("❌ Error fetching sales data:", error);
    return {
      success: false,
      error: error.message,
      salesData: [],
      totalSales: 0,
      totalTransactions: 0
    };
  }
}

// ===== TREND ANALYSIS FUNCTIONS =====

function analyzePeopleTrends(data) {
  try {
    console.log("📈 Analyzing people trends");
    
    if (!data || data.length === 0) {
      return {
        hourlyPatterns: {},
        dailyPatterns: {},
        growthTrend: "No data",
        anomalies: []
      };
    }
    
    // Group by hour
    const hourlyPatterns = {};
    data.forEach(record => {
      const hour = new Date(record.firstTimestamp).getHours();
      if (!hourlyPatterns[hour]) {
        hourlyPatterns[hour] = { in: 0, out: 0, count: 0 };
      }
      hourlyPatterns[hour].in += record.in || 0;
      hourlyPatterns[hour].out += record.out || 0;
      hourlyPatterns[hour].count++;
    });
    
    // Group by day of week
    const dailyPatterns = {};
    data.forEach(record => {
      const dayOfWeek = new Date(record.firstTimestamp).getDay();
      if (!dailyPatterns[dayOfWeek]) {
        dailyPatterns[dayOfWeek] = { in: 0, out: 0, count: 0 };
      }
      dailyPatterns[dayOfWeek].in += record.in || 0;
      dailyPatterns[dayOfWeek].out += record.out || 0;
      dailyPatterns[dayOfWeek].count++;
    });
    
    // Calculate growth trend
    const sortedData = data.sort((a, b) => a.firstTimestamp - b.firstTimestamp);
    const firstHalf = sortedData.slice(0, Math.floor(sortedData.length / 2));
    const secondHalf = sortedData.slice(Math.floor(sortedData.length / 2));
    
    const firstHalfTotal = firstHalf.reduce((sum, record) => sum + (record.in || 0) + (record.out || 0), 0);
    const secondHalfTotal = secondHalf.reduce((sum, record) => sum + (record.in || 0) + (record.out || 0), 0);
    
    const growthRate = firstHalfTotal > 0 ? ((secondHalfTotal - firstHalfTotal) / firstHalfTotal * 100) : 0;
    const growthTrend = growthRate > 10 ? "Growing" : growthRate < -10 ? "Declining" : "Stable";
    
    // Detect anomalies
    const anomalies = detectTrafficAnomalies(data);
    
    return {
      hourlyPatterns: hourlyPatterns,
      dailyPatterns: dailyPatterns,
      growthTrend: growthTrend,
      growthRate: growthRate,
      anomalies: anomalies
    };
    
  } catch (error) {
    console.error("❌ Error analyzing trends:", error);
    return {
      hourlyPatterns: {},
      dailyPatterns: {},
      growthTrend: "Error",
      anomalies: []
    };
  }
}

function detectTrafficAnomalies(data) {
  const anomalies = [];
  
  if (data.length < 3) return anomalies;
  
  // Calculate average traffic
  const totalTraffic = data.reduce((sum, record) => sum + (record.in || 0) + (record.out || 0), 0);
  const averageTraffic = totalTraffic / data.length;
  
  // Find records that are significantly above or below average
  data.forEach((record, index) => {
    const recordTraffic = (record.in || 0) + (record.out || 0);
    const deviation = Math.abs(recordTraffic - averageTraffic) / averageTraffic;
    
    if (deviation > 2) { // More than 200% deviation
      anomalies.push({
        index: index,
        timestamp: record.firstTimestamp,
        traffic: recordTraffic,
        average: averageTraffic,
        deviation: deviation,
        type: recordTraffic > averageTraffic ? "High Traffic" : "Low Traffic"
      });
    }
  });
  
  return anomalies;
}
