function fetchMaintenanceSchedules(filters) {
  console.log("Fetching maintenance data with filters:", filters);
  
  try {
    const payload = {
      "offset": filters.offset || 0,
      "limit": filters.limit || 25,
      "statuses": filters.statuses || ["ok", "due_soon", "due", "overdue"],
      "maintenance_type_ids": filters.maintenance_type_ids || [],
      "assigned_employee_ids": filters.assigned_employee_ids || [],
      "machine_ids": filters.machine_ids || [],
      "location_ids": filters.location_ids || [],
      "machine_tag_ids": filters.machine_tag_ids || [],
      "client_ids": filters.client_ids || []
    };

    const approaches = [
      tryWithApiKey(payload),
      tryWithSimpleRequest(payload)
    ];
    
    for (let i = 0; i < approaches.length; i++) {
      try {
        const result = approaches[i];
        if (result) return result;
      } catch (e) {
        console.log(`Approach ${i} failed:`, e.message);
      }
    }
    
    throw new Error("All authentication approaches failed");
    
  } catch (error) {
    console.error('Error fetching maintenance schedules:', error);
    throw error;
  }
}

function tryWithApiKey(payload) {
  console.log("Trying with API key approach");
  
  const options = {
    'method': 'PUT',
    'contentType': 'application/json',
    'headers': {
      'Authorization': 'Token ' + API_KEY,
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'origin': 'https://cloud.vendon.net',
      'referer': 'https://cloud.vendon.net/preventative-maintenance-schedules',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  const response = UrlFetchApp.fetch(MAINTENANCE_API_URL, options);
  
  if (response.getResponseCode() === 200) {
    return JSON.parse(response.getContentText());
  }
  
  return null;
}

function tryWithSimpleRequest(payload) {
  console.log("Trying with simple request approach");
  
  const options = {
    'method': 'PUT',
    'contentType': 'application/json',
    'headers': {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  const response = UrlFetchApp.fetch(MAINTENANCE_API_URL, options);
  
  if (response.getResponseCode() === 200) {
    return JSON.parse(response.getContentText());
  }
  
  return null;
}

function getMaintenanceData(filters) {
  try {
    console.log("Getting maintenance data with filters:", filters);
    const data = fetchMaintenanceSchedules(filters);
    
    const result = {
      schedules: data.result || [],
      totalCount: data.paging ? data.paging.total : 0,
      offset: filters.offset || 0,
      limit: filters.limit || 25
    };
    
    console.log("Maintenance data result:", result);
    return result;
    
  } catch (error) {
    console.error("Error in getMaintenanceData:", error);
    return {
      error: error.message,
      schedules: [],
      totalCount: 0
    };
  }
}

// ===== UNIFIED PROGRESS SYSTEM =====
function updateProgress(progressKey, percent, message) {
  try {
    console.log(`🔧 BACKEND: updateProgress called with key: ${progressKey}, percent: ${percent}, message: ${message}`);
    
    const progressCache = CacheService.getScriptCache();
    const progressData = {
      percent: Math.min(100, Math.max(0, percent)),
      message: message,
      timestamp: new Date().getTime(),
      processed: 0,
      total: 0
    };
    
    console.log(`📊 BACKEND: Storing progress [${percent}%]: ${message} with key: ${progressKey}`);
    
    // Store for 5 minutes to be safe
    const success = progressCache.put(progressKey, JSON.stringify(progressData), 300);
    
    if (success) {
      console.log("✅ BACKEND: Progress stored successfully");
    } else {
      console.log("❌ BACKEND: Progress storage failed");
    }
    
    return success;
  } catch (error) {
    console.error("❌ BACKEND: Error updating progress:", error);
    return false;
  }
}

function getProgress(progressKey) {
  try {
    console.log(`🔍 Retrieving progress for key: ${progressKey}`);
    
    const progressCache = CacheService.getScriptCache();
    const cached = progressCache.get(progressKey);
    
    if (cached) {
      const progressData = JSON.parse(cached);
      console.log(`✅ Progress retrieved: ${progressData.percent}% - ${progressData.message}`);
      return progressData;
    } else {
      console.log("❌ No progress found for key:", progressKey);
      return { percent: 0, message: "No progress data found", processed: 0, total: 0 };
    }
  } catch (error) {
    console.error("❌ Error getting progress:", error);
    return { percent: 0, message: "Error getting progress: " + error.message, processed: 0, total: 0 };
  }
}

function getMaintenanceDataWithProgress(filters) {
  console.log("🔄 STARTING MAINTENANCE LOADING WITH PROGRESS");
  console.log("📋 Filters received:", filters);
  
  // Use the progress key from frontend, or create a fallback
  const progressKey = filters.progressKey || 'maintenance_progress_' + new Date().getTime();
  
  console.log("🔑 Using progress key:", progressKey);
  
  try {
    // Update progress immediately
    console.log("📊 Setting initial progress...");
    updateProgress(progressKey, 5, "Starting maintenance loading...");
    
    updateProgress(progressKey, 10, "Preparing request...");
    console.log("Getting maintenance data with filters:", filters);
    
    updateProgress(progressKey, 20, "Fetching maintenance schedules...");
    const data = fetchMaintenanceSchedules(filters);
    
    updateProgress(progressKey, 80, "Processing results...");
    const result = {
      schedules: data.result || [],
      totalCount: data.paging ? data.paging.total : 0,
      offset: filters.offset || 0,
      limit: filters.limit || 25
    };
    
    updateProgress(progressKey, 95, "Finalizing results...");
    console.log("Maintenance data result:", result);
    
    updateProgress(progressKey, 100, "✅ Complete!");
    return result;
    
  } catch (error) {
    console.error("Error in getMaintenanceDataWithProgress:", error);
    updateProgress(progressKey, 0, `❌ Error: ${error.message}`);
    return {
      error: error.message,
      schedules: [],
      totalCount: 0
    };
  }
}