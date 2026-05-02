               

function getVendonCredentials() {
  const scriptProperties = PropertiesService.getScriptProperties();
  return {
    username: scriptProperties.getProperty('VENDON_USERNAME'),
    password: scriptProperties.getProperty('VENDON_PASSWORD')
  };
}

function refreshVendonSessionBasicAuth() {
  try {
    console.log("🔐 Attempting Vendon login with Basic Auth...");
    const credentials = getVendonCredentials();
    
    if (!credentials.username || !credentials.password) {
      throw new Error("Vendon credentials not configured");
    }
    
    const authString = Utilities.base64Encode(`${credentials.username}:${credentials.password}`);
    
    const profileOptions = {
      'method': 'GET',
      'headers': {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': `Basic ${authString}`,
        'user-agent': VENDON_SESSION.userAgent,
        'referer': 'https://cloud.vendon.net/login'
      },
      'muteHttpExceptions': true
    };
    
    const profileResponse = UrlFetchApp.fetch('https://cloud.vendon.net/rest/head/user/profile', profileOptions);
    console.log("Profile response code:", profileResponse.getResponseCode());
    
    const profileCookies = extractAllCookies(profileResponse);
    
    if (profileResponse.getResponseCode() === 200 && profileCookies) {
      VENDON_SESSION.allCookies = profileCookies;
      VENDON_SESSION.lastRefresh = Date.now();
      console.log("✅ Vendon Basic Auth session established");
      return true;
    } else {
      throw new Error(`Basic Auth failed (HTTP ${profileResponse.getResponseCode()})`);
    }
    
  } catch (error) {
    console.error("Basic Auth login error:", error);
    throw error;
  }
}

function extractAllCookies(response) {
  const headers = response.getAllHeaders();
  const setCookieHeaders = headers['Set-Cookie'];
  
  if (!setCookieHeaders) return null;
  
  const cookies = [];
  
  if (Array.isArray(setCookieHeaders)) {
    setCookieHeaders.forEach(cookie => {
      const cookieValue = cookie.split(';')[0].trim();
      if (cookieValue) cookies.push(cookieValue);
    });
  } else {
    const cookieValue = setCookieHeaders.split(';')[0].trim();
    if (cookieValue) cookies.push(cookieValue);
  }
  
  return cookies.join('; ');
}

// ===== REMOTE CREDITS FETCHING =====
function fetchRemoteCreditsFromSettingChangeLog(machineId, startDate, endDate) {
  // Check cache first
  const cacheKey = `remote_credits_${machineId}_${startDate}_${endDate}`;
  const cached = getCachedData(cacheKey);
  if (cached) {
    console.log(`✅ Using cached remote credits for machine ${machineId}`);
    // Ensure cached data is sorted (in case old cache entries weren't sorted)
    if (cached.length > 0 && cached[0].timestamp) {
      cached.sort((a, b) => a.timestamp - b.timestamp);
    }
    return cached;
  }
  
  // Fetch fresh data
  const credits = fetchRemoteCreditsDirect(machineId, startDate, endDate);
  
  // Cache for 10 minutes (600 seconds) - attendance data changes infrequently
  setCachedData(cacheKey, credits, 600);
  console.log(`💾 Cached remote credits for machine ${machineId}`);
  
  return credits;
}

function fetchRemoteCreditsDirect(machineId, startDate, endDate) {
  try {
    console.log(`Direct approach: Fetching remote credits for machine ${machineId}`);
    
    const startTimestamp = Math.floor(new Date(startDate + "T00:00:00").getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000);
    
    const credentials = getVendonCredentials();
    const authString = Utilities.base64Encode(`${credentials.username}:${credentials.password}`);
    
    const allRemoteCredits = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;
    const maxPages = 20; // Reduced from 50 to prevent long waits
    let pageCount = 0;
    const maxSuccessfulCredits = 10; // Early exit if we find enough successful credits
    
    while (hasMore && pageCount < maxPages) {
      pageCount++;
      const url = `https://cloud.vendon.net/rest/head/machine/settingChangeLog?id=${machineId}&from_timestamp=${startTimestamp}&to_timestamp=${endTimestamp}&user=&limit=${limit}&offset=${offset}`;
      
      console.log(`Fetching page: offset=${offset}, limit=${limit}`);
      
      const options = {
        'method': 'GET',
        'headers': {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'authorization': `Basic ${authString}`,
          'priority': 'u=1, i',
          'referer': `https://cloud.vendon.net/device/${machineId}/log`,
          'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
        },
        'muteHttpExceptions': true
      };
      
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      if (responseCode === 200) {
        const data = JSON.parse(responseText);
        const logRecords = data.result?.log_records || [];
        
        if (logRecords.length === 0) {
          hasMore = false;
          break;
        }
        
        const parsedCredits = parseRemoteCreditResponse(data, machineId);
        
        console.log(`Page ${Math.floor(offset / limit) + 1}: ${logRecords.length} total records, ${parsedCredits.length} remote credits`);
        
        allRemoteCredits.push(...parsedCredits);
        
        // Early exit optimization: If we have enough successful credits, stop fetching
        const successfulCount = allRemoteCredits.filter(c => c.status === 'Vend successful').length;
        if (successfulCount >= maxSuccessfulCredits) {
          console.log(`✅ Found ${successfulCount} successful credits, stopping early`);
          hasMore = false;
          break;
        }
        
        // Check if we got fewer records than the limit (last page)
        if (logRecords.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      } else {
        console.error(`Direct approach failed at offset ${offset}:`, responseText);
        throw new Error(`HTTP ${responseCode}: ${responseText}`);
      }
    }
    
    if (pageCount >= maxPages) {
      console.warn(`⚠️ Reached maximum page limit (${maxPages}). Some data might be missing.`);
    }
    
    // Sort by timestamp to ensure consistent ordering (earliest first)
    // This is critical for attendance processing which takes the first valid credit
    allRemoteCredits.sort((a, b) => a.timestamp - b.timestamp);
    
    console.log(`✅ Direct approach successful: ${allRemoteCredits.length} total remote credits fetched across ${pageCount} pages (sorted by timestamp)`);
    return allRemoteCredits;
    
  } catch (error) {
    console.error("Error in direct approach:", error);
    throw error;
  }
}

function parseRemoteCreditResponse(data, machineId) {
  if (data.code !== 200) {
    throw new Error(`API error: ${data.code}`);
  }
  
  const logRecords = data.result?.log_records || [];
  console.log(`Found ${logRecords.length} log records`);
  
  const remoteCredits = [];
  
  for (const record of logRecords) {
    if (record.action === 'Remote credit sent') {
      let parsedCredit = parseRemoteCreditRecordRobust(record, machineId);
      if (!parsedCredit) {
        parsedCredit = parseRemoteCreditRecord(record, machineId);
      }
      if (parsedCredit) {
        remoteCredits.push(parsedCredit);
      }
    }
  }
  
  console.log(`Parsed ${remoteCredits.length} remote credit records`);
  return remoteCredits;
}

function parseRemoteCreditRecord(record, machineId) {
  try {
    const data = record.data || '';
    
    console.log(`Parsing remote credit record data: "${data}"`);
    
    // Extract credit amount - handle both => and =&gt;
    const creditMatch = data.match(/Credit\s*(?:=>|=&gt;)\s*([\d.]+)/);
    const creditAmount = creditMatch ? parseFloat(creditMatch[1]) : null;
    console.log(`Credit amount: ${creditAmount}`);
    
    // Extract status - handle both => and =&gt;
    const statusMatch = data.match(/Status\s*(?:=>|=&gt;)\s*([^<\n]+)/);
    const status = statusMatch ? statusMatch[1].trim() : 'Unknown';
    console.log(`Status: "${status}"`);
    
    // ONLY consider successful vends
    if (status !== 'Vend successful') {
      console.log(`Skipping credit with status: "${status}"`);
      return null;
    }
    
    // Extract allowed products
    const productsMatch = data.match(/Allowed products\s*(?:=>|=&gt;)\s*([^<\n]+)/);
    const allowedProducts = productsMatch ? productsMatch[1].trim() : '';
    console.log(`Allowed products: "${allowedProducts}"`);
    
    // Determine user type
    const userType = getUserTypeFromRecord(record);
    console.log(`User type: ${userType}, User: ${record.user_name}`);
    
    return {
      id: record.id,
      user_id: record.user_id,
      user_name: record.user_name,
      timestamp: record.changed_at,
      machine_id: machineId,
      credit_amount: creditAmount,
      status: status,
      allowed_products: allowedProducts,
      user_type: userType,
      source: 'settingChangeLog'
    };
    
  } catch (error) {
    console.error("Error parsing remote credit record:", error);
    return null;
  }
}

function parseRemoteCreditRecordRobust(record, machineId) {
  try {
    const data = record.data || '';
    
    console.log(`Robust parsing for: "${data}"`);
    
    const lines = data.split(/<br\s*\/?>\s*\n?/).filter(line => line.trim());
    
    let creditAmount = null;
    let status = 'Unknown';
    let allowedProducts = '';
    
    lines.forEach(line => {
      const trimmedLine = line.trim();
      
      if (trimmedLine.toLowerCase().includes('credit')) {
        const creditParts = trimmedLine.split(/(?:=>|=&gt;)/);
        if (creditParts.length >= 2) {
          const amountStr = creditParts[1].trim();
          creditAmount = parseFloat(amountStr);
        }
      }
      
      if (trimmedLine.toLowerCase().includes('status')) {
        const statusParts = trimmedLine.split(/(?:=>|=&gt;)/);
        if (statusParts.length >= 2) {
          status = statusParts[1].trim();
        }
      }
      
      if (trimmedLine.toLowerCase().includes('allowed products')) {
        const productParts = trimmedLine.split(/(?:=>|=&gt;)/);
        if (productParts.length >= 2) {
          allowedProducts = productParts[1].trim();
        }
      }
    });
    
    console.log(`Robust parsing result - Credit: ${creditAmount}, Status: "${status}", Products: "${allowedProducts}"`);
    
    if (status !== 'Vend successful') {
      console.log(`Skipping credit with status: "${status}"`);
      return null;
    }
    
    const userType = getUserTypeFromRecord(record);
    
    return {
      id: record.id,
      user_id: record.user_id,
      user_name: record.user_name,
      timestamp: record.changed_at,
      machine_id: machineId,
      credit_amount: creditAmount,
      status: status,
      allowed_products: allowedProducts,
      user_type: userType,
      source: 'settingChangeLog'
    };
    
  } catch (error) {
    console.error("Error in robust parsing:", error);
    return null;
  }
}

// ===== ATTENDANCE PROCESSING =====
function getAttendanceAndCleaningData(filters) {
  try {
    console.log("Getting attendance and cleaning data with filters:", filters);
    
    const allMachines = fetchMachines();
    const { startDate, endDate, machineId } = filters;
    
    const targetMachines = machineId 
      ? allMachines.filter(m => m.id == machineId) 
      : allMachines;
    
    console.log(`Processing ${targetMachines.length} machines for data`);
    
    const allUsers = fetchUsers();
    
    let attendance = [];
    let attendanceError = null;
    
    try {
      console.log("Attempting to fetch attendance data with session...");
      attendance = processAttendanceWithCorrectAPI(filters, targetMachines, allUsers);
      console.log(`Successfully processed ${attendance.length} attendance records`);
    } catch (error) {
      console.error("Attendance processing failed:", error);
      attendanceError = error.message;
    }
    
    console.log("Processing cleaning data...");
    const cleaning = processCleaningData(filters, targetMachines);
    const generalCleaning = processGeneralCleaning(filters, targetMachines);
    
    console.log(`Cleaning results: ${cleaning.length} daily, ${generalCleaning.length} general`);
    
    // Integrate daily cleaning finish times with attendance records
    const enhancedAttendance = integrateCleaningFinishTimes(attendance, cleaning);
    
    // SKIP all-time cleaning averages calculation during initial load for speed
    // This can be calculated on-demand if needed
    let allTimeCleaningAverages = [];
    console.log("⏩ Skipping all-time averages calculation for faster load");
    
    return {
      success: true,
      attendance: enhancedAttendance || [],
      cleaning: cleaning || [],
      generalCleaning: generalCleaning || [],
      attendanceCount: enhancedAttendance.length,
      cleaningCount: cleaning.length,
      generalCleaningCount: generalCleaning.length,
      hasAttendanceData: enhancedAttendance.length > 0,
      attendanceError: attendanceError,
      allTimeCleaningAverages: allTimeCleaningAverages
    };
    
  } catch (error) {
    console.error("Error getting attendance and cleaning data:", error);
    return {
      success: false,
      error: error.message,
      attendance: [],
      cleaning: [],
      generalCleaning: [],
      attendanceCount: 0,
      cleaningCount: 0,
      generalCleaningCount: 0,
      hasAttendanceData: false
    };
  }
}

function processAttendanceWithCorrectAPI(filters, targetMachines, allUsers) {
  const { startDate, endDate } = filters;
  const attendanceRecords = [];
  // Track which users have already been recorded per machine/date to avoid duplicates
  const recordedUsers = new Set(); // Key format: `${machineId}_${date}_${userId}` or `${machineId}_${date}_${userName}`

  for (const machine of targetMachines) {
    try {
      console.log(`Processing attendance for machine: ${machine.name} (ID: ${machine.id})`);
      
      const remoteCredits = fetchRemoteCreditsFromSettingChangeLog(machine.id, startDate, endDate);
      console.log(`Found ${remoteCredits.length} remote credits for machine ${machine.name}`);
      
      const successfulCredits = remoteCredits.filter(credit => credit.status === 'Vend successful');
      
      // Sort by timestamp to ensure consistent processing order (earliest first)
      // This ensures we always record the first attendance per user per machine per day
      successfulCredits.sort((a, b) => a.timestamp - b.timestamp);
      
      if (successfulCredits.length > 0) {
        console.log(`Found ${successfulCredits.length} successful credits for ${machine.name} (sorted by timestamp)`);
        
        for (const credit of successfulCredits) {
          console.log(`Processing credit by ${credit.user_name} at ${new Date(credit.timestamp * 1000).toLocaleString()}`);
          
          const attendanceRecord = processAttendanceForCredit(machine, credit, startDate, allUsers);
          if (attendanceRecord) {
            // Verify the attendance date is within the requested range
            // (processAttendanceForCredit uses actual date from timestamp, which might differ slightly)
            // Also check if the credit timestamp itself is within range as a fallback
            const creditDate = new Date(credit.timestamp * 1000).toISOString().split('T')[0];
            const isDateInRange = attendanceRecord.date >= startDate && attendanceRecord.date <= endDate;
            const isCreditDateInRange = creditDate >= startDate && creditDate <= endDate;
            
            if (isDateInRange || isCreditDateInRange) {
              // Check if we've already recorded an attendance for this user/machine/date combination
              const userKey = `${machine.id}_${attendanceRecord.date}_${credit.user_id || credit.user_name}`;
              
              if (recordedUsers.has(userKey)) {
                console.log(`⏭️ Skipping duplicate attendance for ${credit.user_name} on ${attendanceRecord.date} (already recorded first attendance for this user/machine/date)`);
              } else {
                console.log(`✅ Attendance confirmed for ${credit.user_name} on ${attendanceRecord.date} (credit date: ${creditDate})`);
                attendanceRecords.push(attendanceRecord);
                recordedUsers.add(userKey);
              }
            } else {
              console.log(`⚠️ Attendance date ${attendanceRecord.date} and credit date ${creditDate} are both outside filter range ${startDate} to ${endDate}`);
            }
          } else {
            console.log(`❌ Attendance not confirmed despite successful credit (machine: ${machine.name}, user: ${credit.user_name}, time: ${new Date(credit.timestamp * 1000).toLocaleString()})`);
          }
        }
      } else {
        console.log(`❌ NO SUCCESSFUL REMOTE CREDITS FOUND for machine ${machine.name}. Attendance not recorded.`);
      }
    } catch (error) {
      console.error(`Error processing attendance for machine ${machine.id}:`, error);
    }
  }

  console.log(`📊 Total attendance records found: ${attendanceRecords.length} for ${targetMachines.length} machines`);
  
  // Log which machines got attendance and which didn't (for debugging)
  const machinesWithAttendance = new Set(attendanceRecords.map(r => r.machine_id));
  const machinesWithoutAttendance = targetMachines
    .filter(m => !machinesWithAttendance.has(String(m.id)))
    .map(m => m.name);
  
  if (machinesWithoutAttendance.length > 0) {
    console.log(`⚠️ Machines without attendance records (${machinesWithoutAttendance.length}):`, machinesWithoutAttendance.join(', '));
  }
  if (machinesWithAttendance.size > 0) {
    const machinesWith = targetMachines
      .filter(m => machinesWithAttendance.has(String(m.id)))
      .map(m => m.name);
    console.log(`✅ Machines with attendance records (${machinesWith.length}):`, machinesWith.join(', '));
  }
  
  return attendanceRecords;
}


function getAttendanceAndCleaningDataWithProgress(filters) {
  console.log("🔄 STARTING ATTENDANCE DATA LOADING WITH PROGRESS");
  console.log("📋 Filters received:", filters);
  
  // Use the progress key from frontend, or create a fallback
  const progressKey = filters.progressKey || 'attendance_progress_' + new Date().getTime();
  
  console.log("🔑 Using progress key:", progressKey);
  
  try {
    // Update progress immediately - use synchronous cache operations
    console.log("📊 Setting initial progress...");
    updateProgress(progressKey, 5, "Starting session...");
    
    const allMachines = fetchMachines();
    const { startDate, endDate, machineId } = filters;
    
    const targetMachines = machineId 
      ? allMachines.filter(m => m.id == machineId) 
      : allMachines;
    
    console.log(`🔍 Processing ${targetMachines.length} machines`);
    updateProgress(progressKey, 10, `Found ${targetMachines.length} machines`);
    
    // Test authentication
    updateProgress(progressKey, 15, "Authenticating with Vendon...");
    console.log("🔐 Testing authentication...");
    
    try {
      const authSuccess = refreshVendonSessionBasicAuth();
      if (!authSuccess) {
        throw new Error("Authentication failed - please check Vendon credentials");
      }
      updateProgress(progressKey, 20, "✅ Authentication successful");
      console.log("✅ Authentication successful");
    } catch (authError) {
      console.error("❌ Authentication failed:", authError);
      updateProgress(progressKey, 20, "❌ Authentication failed");
      throw authError;
    }
    
    const allUsers = fetchUsers();
    let attendance = [];
    // Track which users have already been recorded per machine/date to avoid duplicates
    const recordedUsers = new Set(); // Key format: `${machineId}_${date}_${userId}` or `${machineId}_${date}_${userName}`
    
    updateProgress(progressKey, 25, "Starting machine processing...");
    
    // Process each machine with progress updates
    for (let i = 0; i < targetMachines.length; i++) {
      const machine = targetMachines[i];
      const progressPercent = 25 + Math.floor((i / targetMachines.length) * 60);
      
      const statusMessage = `Processing machine ${i+1}/${targetMachines.length}: ${machine.name}`;
      updateProgress(progressKey, progressPercent, statusMessage);
      
      console.log(`🔄 ${statusMessage}`);
      
      try {
        const remoteCredits = fetchRemoteCreditsFromSettingChangeLog(machine.id, startDate, endDate);
        console.log(`💰 Found ${remoteCredits.length} remote credits for ${machine.name}`);
        
        const successfulCredits = remoteCredits.filter(credit => credit.status === 'Vend successful');
        
        // Sort by timestamp to ensure consistent processing order (earliest first)
        // This ensures we always record the first attendance per user per machine per day
        successfulCredits.sort((a, b) => a.timestamp - b.timestamp);
        
        if (successfulCredits.length > 0) {
          console.log(`✅ Found ${successfulCredits.length} successful credits (sorted by timestamp)`);
          
          for (const credit of successfulCredits) {
            const attendanceRecord = processAttendanceForCredit(machine, credit, startDate, allUsers);
            if (attendanceRecord) {
              // Verify the attendance date is within the requested range
              // Also check if the credit timestamp itself is within range as a fallback
              const creditDate = new Date(credit.timestamp * 1000).toISOString().split('T')[0];
              const isDateInRange = attendanceRecord.date >= startDate && attendanceRecord.date <= endDate;
              const isCreditDateInRange = creditDate >= startDate && creditDate <= endDate;
              
              if (isDateInRange || isCreditDateInRange) {
                // Check if we've already recorded an attendance for this user/machine/date combination
                const userKey = `${machine.id}_${attendanceRecord.date}_${credit.user_id || credit.user_name}`;
                
                if (recordedUsers.has(userKey)) {
                  console.log(`⏭️ Skipping duplicate attendance for ${credit.user_name} on ${attendanceRecord.date} (already recorded first attendance for this user/machine/date)`);
                } else {
                  console.log(`👤 Attendance confirmed for ${credit.user_name} on ${attendanceRecord.date} (credit date: ${creditDate})`);
                  attendance.push(attendanceRecord);
                  recordedUsers.add(userKey);
                }
              } else {
                console.log(`⚠️ Attendance date ${attendanceRecord.date} and credit date ${creditDate} are both outside filter range ${startDate} to ${endDate}`);
              }
            }
          }
        } else {
          console.log(`❌ No successful credits for ${machine.name}`);
        }
        
      } catch (machineError) {
        console.error(`💥 Machine ${machine.name} error:`, machineError);
      }
    }
    
    updateProgress(progressKey, 90, "Processing cleaning data...");
    console.log("🧹 Processing cleaning data...");
    
    const cleaning = processCleaningData(filters, targetMachines);
    const generalCleaning = processGeneralCleaning(filters, targetMachines);
    
    // Integrate daily cleaning finish times with attendance records
    const enhancedAttendance = integrateCleaningFinishTimes(attendance, cleaning);
    
    updateProgress(progressKey, 95, "✅ Data loaded!");
    console.log(`🎉 COMPLETED: ${enhancedAttendance.length} attendance, ${cleaning.length} cleaning records`);
    
    // SKIP all-time cleaning averages calculation during initial load for speed
    // This can be calculated on-demand or in background if needed
    // The averages are not critical for initial display
    let allTimeCleaningAverages = [];
    console.log("⏩ Skipping all-time averages calculation for faster load (can be loaded on-demand)");
    
    updateProgress(progressKey, 100, "✅ Complete!");
    
    return {
      success: true,
      attendance: enhancedAttendance,
      cleaning: cleaning,
      generalCleaning: generalCleaning || [],
      attendanceCount: enhancedAttendance.length,
      cleaningCount: cleaning.length,
      generalCleaningCount: (generalCleaning || []).length,
      hasAttendanceData: enhancedAttendance.length > 0,
      progressKey: progressKey,
      allTimeCleaningAverages: allTimeCleaningAverages || []
    };
    
  } catch (error) {
    console.error("💥 FATAL ERROR in attendance loading:", error);
    updateProgress(progressKey, 0, `❌ Error: ${error.message}`);
    
    return {
      success: false,
      error: error.message,
      attendance: [],
      cleaning: [],
      generalCleaning: [],
      attendanceCount: 0,
      cleaningCount: 0,
      generalCleaningCount: 0,
      hasAttendanceData: false,
      progressKey: progressKey
    };
  }
}



function updateProgress(progressKey, percent, message) {
  try {
    const progressCache = CacheService.getScriptCache();
    const progressData = {
      percent: Math.min(100, Math.max(0, percent)),
      message: message,
      timestamp: new Date().getTime(),
      processed: 0,
      total: 0
    };
    
    console.log(`📊 Storing progress [${percent}%]: ${message} with key: ${progressKey}`);
    
    // Store for 5 minutes to be safe
    const success = progressCache.put(progressKey, JSON.stringify(progressData), 300);
    
    if (success) {
      console.log("✅ Progress stored successfully");
    } else {
      console.log("❌ Progress storage failed");
    }
    
    return success;
  } catch (error) {
    console.error("❌ Error updating progress:", error);
    return false;
  }
}

function getAttendanceProgress(progressKey) {
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

function processAttendanceWithProgress(filters, targetMachines, allUsers, progressKey) {
  const { startDate, endDate } = filters;
  const attendanceRecords = [];
  const totalMachines = targetMachines.length;
  // Track which users have already been recorded per machine/date to avoid duplicates
  const recordedUsers = new Set(); // Key format: `${machineId}_${date}_${userId}` or `${machineId}_${date}_${userName}`

  for (let i = 0; i < targetMachines.length; i++) {
    const machine = targetMachines[i];
    
    // Calculate progress percentage
    const progressPercent = 20 + Math.floor((i / totalMachines) * 60);
    
    try {
      updateProgress(progressKey, progressPercent, `Processing machine: ${machine.name} (${i + 1}/${totalMachines})`);
      
      console.log(`Processing attendance for machine: ${machine.name} (${i + 1}/${totalMachines})`);
      
      const remoteCredits = fetchRemoteCreditsFromSettingChangeLog(machine.id, startDate, endDate);
      console.log(`Found ${remoteCredits.length} remote credits for machine ${machine.name}`);
      
      const successfulCredits = remoteCredits.filter(credit => credit.status === 'Vend successful');
      
      // Sort by timestamp to ensure consistent processing order (earliest first)
      // This ensures we always record the first attendance per user per machine per day
      successfulCredits.sort((a, b) => a.timestamp - b.timestamp);
      
      if (successfulCredits.length > 0) {
        console.log(`Found ${successfulCredits.length} successful credits for ${machine.name} (sorted by timestamp)`);
        
        for (const credit of successfulCredits) {
          console.log(`Processing credit by ${credit.user_name} at ${new Date(credit.timestamp * 1000).toLocaleString()}`);
          
          const attendanceRecord = processAttendanceForCredit(machine, credit, startDate, allUsers);
          if (attendanceRecord) {
            // Verify the attendance date is within the requested range
            // Also check if the credit timestamp itself is within range as a fallback
            const creditDate = new Date(credit.timestamp * 1000).toISOString().split('T')[0];
            const isDateInRange = attendanceRecord.date >= startDate && attendanceRecord.date <= endDate;
            const isCreditDateInRange = creditDate >= startDate && creditDate <= endDate;
            
            if (isDateInRange || isCreditDateInRange) {
              // Check if we've already recorded an attendance for this user/machine/date combination
              const userKey = `${machine.id}_${attendanceRecord.date}_${credit.user_id || credit.user_name}`;
              
              if (recordedUsers.has(userKey)) {
                console.log(`⏭️ Skipping duplicate attendance for ${credit.user_name} on ${attendanceRecord.date} (already recorded first attendance for this user/machine/date)`);
              } else {
                console.log(`✅ Attendance confirmed for ${credit.user_name} on ${attendanceRecord.date} (credit date: ${creditDate})`);
                attendanceRecords.push(attendanceRecord);
                recordedUsers.add(userKey);
              }
            } else {
              console.log(`⚠️ Attendance date ${attendanceRecord.date} and credit date ${creditDate} are both outside filter range ${startDate} to ${endDate}`);
            }
          } else {
            console.log(`❌ Attendance not confirmed despite successful credit (machine: ${machine.name}, user: ${credit.user_name}, time: ${new Date(credit.timestamp * 1000).toLocaleString()})`);
          }
        }
      } else {
        console.log(`❌ NO SUCCESSFUL REMOTE CREDITS FOUND for machine ${machine.name}. Attendance not recorded.`);
      }
    } catch (error) {
      console.error(`Error processing attendance for machine ${machine.id}:`, error);
      updateProgress(progressKey, progressPercent, `Error with ${machine.name}: ${error.message}`);
    }
  }

  return attendanceRecords;
}

// Enhanced function to calculate work duration
function processAttendanceForCredit(machine, remoteCredit, date, allUsers) {
  try {
    console.log(`Processing attendance for successful credit at ${new Date(remoteCredit.timestamp * 1000)}`);
    
    // Calculate the actual attendance date from the timestamp
    const actualAttendanceDate = new Date(remoteCredit.timestamp * 1000).toISOString().split('T')[0];
    console.log(`📅 Actual attendance date: ${actualAttendanceDate} (was using filter date: ${date})`);
    
    // Fetch power events in strict 3-minute window (as required)
    // Don't use cache for narrow windows to avoid stale data issues
    const windowStart = remoteCredit.timestamp;
    const windowEnd = remoteCredit.timestamp + 180; // 3 minutes
    const powerEventsAfter = fetchPowerEventsInWindowNoCache(
      machine.id, 
      windowStart, 
      windowEnd
    );
    
    console.log(`Found ${powerEventsAfter.length} power events within 3 minutes AFTER credit (timestamp: ${remoteCredit.timestamp})`);
    
    // Log power event details for debugging
    if (powerEventsAfter.length > 0) {
      console.log(`   Power events found:`, powerEventsAfter.map(e => ({
        timestamp: e.received_at,
        time: new Date(e.received_at * 1000).toLocaleTimeString(),
        secondsAfterCredit: e.received_at - remoteCredit.timestamp
      })));
    }
    
    // Check for 2 consecutive events within 3 minutes
    const hasConsecutiveEvents = checkConsecutiveEvents(powerEventsAfter, 2, 180);
    
    if (hasConsecutiveEvents) {
      console.log(`✅ Attendance confirmed - found 2 consecutive power events within 3 minutes AFTER remote credit`);
      
      // Find cleaning finish time (this becomes work end) - use actual attendance date
      const workEnd = findCleaningFinishTime(machine.id, remoteCredit.timestamp, actualAttendanceDate);
      const workDuration = workEnd ? (workEnd - remoteCredit.timestamp) : null;
      
      const userDetails = findActualUserForCredit(remoteCredit.user_id, remoteCredit.user_name, allUsers);
      
      return {
        machine_id: machine.id,
        machine_name: machine.name,
        date: actualAttendanceDate, // Use actual attendance date, not filter date
        attendance_time: remoteCredit.timestamp,
        user_type: userDetails.type,
        user_name: userDetails.name,
        operator_name: userDetails.name,
        work_start: remoteCredit.timestamp, // Work starts at attendance time
        work_end: workEnd, // Work ends when cleaning finishes
        cleaning_finish_time: workEnd,
        actual_work_duration: workDuration,
        attendance_proven: true,
        remote_credit_id: remoteCredit.id,
        credit_user_name: remoteCredit.user_name,
        credit_amount: remoteCredit.credit_amount,
        power_events_count: powerEventsAfter.length,
        consecutive_events_found: true,
        status: 'confirmed'
      };
    } else {
      console.log(`❌ No consecutive power events found within 3 minutes AFTER remote credit`);
      console.log(`   Credit timestamp: ${remoteCredit.timestamp} (${new Date(remoteCredit.timestamp * 1000).toLocaleString()})`);
      console.log(`   Window: ${windowStart} to ${windowEnd} (${windowEnd - windowStart}s)`);
      return null;
    }
    
  } catch (error) {
    console.error("Error in processAttendanceForCredit:", error);
    return null;
  }
}

// ===== CLEANING DETECTION =====
function processCleaningData(filters, targetMachines) {
  try {
    const { startDate, endDate, machineId } = filters;
    
    // Check cache first
    const cacheKey = `cleaning_data_${machineId || 'all'}_${startDate}_${endDate}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log(`✅ Using cached cleaning data`);
      return cached;
    }
    
    const cleaningRecords = [];
    
    console.log(`Processing cleaning data for ${targetMachines.length} machines from ${startDate} to ${endDate}`);
    
    for (const machine of targetMachines) {
      try {
        console.log(`Checking daily cleaning for machine: ${machine.name}`);
        const dailyCleaning = checkDailyCleaning(machine, startDate, endDate);
        console.log(`Found ${dailyCleaning.length} cleaning records for ${machine.name}`);
        cleaningRecords.push(...dailyCleaning);
      } catch (machineError) {
        console.error(`Error processing cleaning for machine ${machine.id}:`, machineError);
      }
    }
    
    console.log(`Total cleaning records found: ${cleaningRecords.length}`);
    
    // Cache for 10 minutes
    setCachedData(cacheKey, cleaningRecords, 600);
    console.log(`💾 Cached cleaning data`);
    
    return cleaningRecords;
  } catch (error) {
    console.error("Error in processCleaningData:", error);
    return [];
  }
}

function checkDailyCleaning(machine, startDate, endDate) {
  const cleaningRecords = [];
  
  try {
    const startTimestamp = Math.floor(new Date(startDate + "T00:00:00").getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000);
    
    console.log(`Fetching power events for machine ${machine.id} from ${startDate} to ${endDate}`);
    
    const powerEvents = fetchPowerEvents(startTimestamp, endTimestamp, machine.id);
    
    console.log(`Found ${powerEvents.length} power events for machine ${machine.name}`);
    
    if (powerEvents.length < 6) {
      console.log(`Not enough power events (${powerEvents.length}) to detect cleaning patterns`);
      return [];
    }
    
    const eventsByDate = {};
    powerEvents.forEach(event => {
      const eventDate = new Date(event.received_at * 1000).toISOString().split('T')[0];
      if (!eventsByDate[eventDate]) {
        eventsByDate[eventDate] = [];
      }
      eventsByDate[eventDate].push(event);
    });
    
    Object.keys(eventsByDate).forEach(date => {
      const dayEvents = eventsByDate[date];
      console.log(`Processing ${dayEvents.length} events for date ${date}`);
      const dayCleaning = findCleaningPatternsInDay(dayEvents, machine, date);
      cleaningRecords.push(...dayCleaning);
    });
    
  } catch (error) {
    console.error(`Error in checkDailyCleaning for machine ${machine.id}:`, error);
  }
  
  return cleaningRecords;
}

function findCleaningPatternsInDay(events, machine, date) {
  const cleaningRecords = [];
  const sortedEvents = events.sort((a, b) => a.received_at - b.received_at);
  
  let i = 0;
  while (i < sortedEvents.length - 5) {
    const startPattern = findConsecutiveEvents(sortedEvents, i, 3, 180);
    
    if (startPattern) {
      const cleaningStart = startPattern.firstEvent.received_at;
      
      let j = startPattern.lastIndex + 1;
      let endPattern = null;
      
      while (j < sortedEvents.length - 2 && !endPattern) {
        endPattern = findConsecutiveEvents(sortedEvents, j, 3, 180);
        
        if (endPattern) {
          const cleaningEnd = endPattern.lastEvent.received_at;
          const cleaningDuration = cleaningEnd - cleaningStart;
          
          cleaningRecords.push({
            machine_id: machine.id,
            machine_name: machine.name,
            cleaning_start: cleaningStart,
            cleaning_end: cleaningEnd,
            cleaning_duration: cleaningDuration,
            date: date,
            status: 'completed',
            type: 'daily'
          });
          
          i = endPattern.lastIndex + 1;
          break;
        } else {
          j++;
        }
      }
      
      if (!endPattern) {
        cleaningRecords.push({
          machine_id: machine.id,
          machine_name: machine.name,
          cleaning_start: cleaningStart,
          cleaning_end: null,
          cleaning_duration: null,
          date: date,
          status: 'incomplete',
          type: 'daily'
        });
        i = startPattern.lastIndex + 1;
      }
    } else {
      i++;
    }
  }
  
  return cleaningRecords;
}

// ===== GET CLEANING AVERAGES FOR EACH MACHINE (GENERIC RANGE) =====
/**
 * Calculate average cleaning duration for each machine based on data
 * between the provided start and end dates (inclusive).
 * If no dates are provided, defaults to last 1 year.
 */
function getCleaningAveragesForRange(targetMachines, startDateStr, endDateStr) {
  const machineAverages = [];
  
  // If no explicit range passed, default to last 1 year
  if (!startDateStr || !endDateStr) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1);
    startDateStr = startDate.toISOString().split('T')[0];
    endDateStr = endDate.toISOString().split('T')[0];
  }
  
  console.log(`📊 Fetching all-time cleaning data from ${startDateStr} to ${endDateStr} for ${targetMachines.length} machines`);
  
  // Process all machines (already limited by caller if needed)
  const machinesToProcess = targetMachines;
  
  for (let i = 0; i < machinesToProcess.length; i++) {
    const machine = machinesToProcess[i];
    
    // Add small delay between machines to avoid rate limiting
    if (i > 0) {
      Utilities.sleep(200); // 200ms delay
    }
    
    try {
      console.log(`📊 Processing machine ${i+1}/${machinesToProcess.length}: ${machine.name}`);
      
      // Fetch all cleaning data for this machine
      const dailyCleaning = checkDailyCleaning(machine, startDateStr, endDateStr);
      
      // Get general cleaning (Saturdays only) for the same period
      // Limit to avoid processing too many Saturdays at once
      const saturdays = getSaturdaysInRange(startDateStr, endDateStr);
      const generalCleaning = [];
      
      // Process Saturdays in batches to avoid timeout
      const maxSaturdays = 52; // Limit to ~1 year of Saturdays
      const saturdaysToProcess = saturdays.slice(0, maxSaturdays);
      
      for (let j = 0; j < saturdaysToProcess.length; j++) {
        const saturday = saturdaysToProcess[j];
        try {
          const dayCleaning = checkGeneralCleaningForDay(machine, saturday);
          if (dayCleaning) {
            generalCleaning.push(dayCleaning);
          }
        } catch (error) {
          console.error(`Error checking general cleaning for ${machine.name} on ${saturday}:`, error);
        }
        
        // Small delay every 10 Saturdays
        if (j > 0 && j % 10 === 0) {
          Utilities.sleep(100);
        }
      }
      
      // Combine all cleaning records
      const allCleaning = [...dailyCleaning, ...generalCleaning];
      
      // Filter only completed sessions with valid duration
      const completedCleanings = allCleaning.filter(record => 
        record.status === 'completed' && 
        record.cleaning_duration && 
        record.cleaning_duration > 0
      );
      
      if (completedCleanings.length > 0) {
        // Calculate statistics
        const durations = completedCleanings.map(r => r.cleaning_duration).sort((a, b) => a - b);
        const totalDuration = durations.reduce((a, b) => a + b, 0);
        const avg = Math.round(totalDuration / durations.length);
        const min = durations[0];
        const max = durations[durations.length - 1];
        const median = durations[Math.floor(durations.length / 2)];
        
        machineAverages.push({
          machine_id: machine.id,
          machine_name: machine.name,
          avg_duration: avg,
          min_duration: min,
          max_duration: max,
          median_duration: median,
          session_count: completedCleanings.length
        });
        
        console.log(`✅ ${machine.name}: ${completedCleanings.length} sessions, avg: ${formatDuration(avg)}`);
      } else {
        console.log(`⚠️ ${machine.name}: No completed cleaning sessions found between ${startDateStr} and ${endDateStr}`);
      }
    } catch (error) {
      console.error(`❌ Error calculating averages for machine ${machine.id} (${machine.name}):`, error);
      // Continue with other machines even if one fails
    }
  }
  
  console.log(`📊 Calculated averages for ${machineAverages.length} out of ${machinesToProcess.length} machines`);
  return machineAverages;
}

// Backwards-compatible wrapper for existing callers that expect "all-time" (last year)
function getAllTimeCleaningAverages(targetMachines) {
  return getCleaningAveragesForRange(targetMachines, null, null);
}

/**
 * Server-side entry point: calculate averages for ALL machines
 * in a specific date range (used by the "All machines" modal).
 */
function getAllMachinesCleaningAverages(filters) {
  try {
    const { startDate, endDate } = filters || {};
    if (!startDate || !endDate) {
      return {
        success: false,
        error: "Start date and end date are required",
        machineAverages: []
      };
    }

    const allMachines = fetchMachines();
    const machineAverages = getCleaningAveragesForRange(allMachines, startDate, endDate);

    return {
      success: true,
      machineAverages: machineAverages || [],
      startDate: startDate,
      endDate: endDate
    };
  } catch (error) {
    console.error("Error in getAllMachinesCleaningAverages:", error);
    return {
      success: false,
      error: error.toString(),
      machineAverages: []
    };
  }
}

// Helper function to format duration (if not already defined)
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return "< 1m";
  }
}

// ===== INTEGRATE CLEANING FINISH TIMES WITH ATTENDANCE =====
function integrateCleaningFinishTimes(attendanceRecords, cleaningRecords) {
  console.log(`🔗 Integrating cleaning finish times with ${attendanceRecords.length} attendance records`);
  console.log(`🧹 Found ${cleaningRecords.length} cleaning records to match`);
  
  // Debug: Show attendance dates
  console.log(`📅 Attendance dates:`, attendanceRecords.map(a => `${a.machine_name}: ${a.date}`));
  console.log(`📅 Cleaning dates:`, cleaningRecords.map(c => `${c.machine_name}: ${c.date}`));
  
  const enhancedAttendance = attendanceRecords.map(attendance => {
    console.log(`🔍 Looking for cleaning match for ${attendance.machine_name} on ${attendance.date}`);
    
    // Find matching cleaning record for same machine and date
    const matchingCleaning = cleaningRecords.find(cleaning => 
      cleaning.machine_id === attendance.machine_id && 
      cleaning.date === attendance.date &&
      cleaning.status === 'completed' &&
      cleaning.cleaning_end
    );
    
    if (matchingCleaning) {
      console.log(`✅ Found cleaning finish time for ${attendance.machine_name} on ${attendance.date}`);
      console.log(`   Cleaning finished at: ${new Date(matchingCleaning.cleaning_end * 1000).toLocaleString()}`);
      
      // Update work end time to cleaning finish time
      const newWorkEnd = matchingCleaning.cleaning_end;
      const newWorkDuration = newWorkEnd - attendance.work_start;
      
      return {
        ...attendance,
        work_end: newWorkEnd,
        actual_work_duration: newWorkDuration,
        cleaning_finish_time: newWorkEnd,
        cleaning_duration: matchingCleaning.cleaning_duration,
        cleaning_start: matchingCleaning.cleaning_start,
        work_end_source: 'daily_cleaning'
      };
    } else {
      console.log(`❌ No cleaning finish time found for ${attendance.machine_name} on ${attendance.date}`);
      console.log(`   Available cleaning dates for this machine:`, 
        cleaningRecords.filter(c => c.machine_id === attendance.machine_id).map(c => c.date));
      return {
        ...attendance,
        work_end_source: 'power_events'
      };
    }
  });
  
  const recordsWithCleaning = enhancedAttendance.filter(record => record.work_end_source === 'daily_cleaning').length;
  console.log(`📊 Enhanced ${recordsWithCleaning} attendance records with daily cleaning finish times`);
  
  return enhancedAttendance;
}

function processGeneralCleaning(filters, targetMachines) {
  try {
    const { startDate, endDate, machineId } = filters;
    
    // Check cache first
    const cacheKey = `general_cleaning_${machineId || 'all'}_${startDate}_${endDate}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log(`✅ Using cached general cleaning data`);
      return cached;
    }
    
    const generalCleaningRecords = [];
    
    const saturdays = getSaturdaysInRange(startDate, endDate);
    
    for (const machine of targetMachines) {
      for (const saturday of saturdays) {
        try {
          const generalCleaning = checkGeneralCleaningForDay(machine, saturday);
          if (generalCleaning) {
            generalCleaningRecords.push(generalCleaning);
          }
        } catch (error) {
          console.error(`Error checking general cleaning for machine ${machine.id} on ${saturday}:`, error);
        }
      }
    }
    
    // Cache for 10 minutes
    setCachedData(cacheKey, generalCleaningRecords, 600);
    console.log(`💾 Cached general cleaning data`);
    
    return generalCleaningRecords;
  } catch (error) {
    console.error("Error in processGeneralCleaning:", error);
    return [];
  }
}

function checkGeneralCleaningForDay(machine, date) {
  try {
    const startTimestamp = Math.floor(new Date(date + "T00:00:00").getTime() / 1000);
    const endTimestamp = Math.floor(new Date(date + "T23:59:59").getTime() / 1000);
    
    const powerEvents = fetchPowerEvents(startTimestamp, endTimestamp, machine.id);
    
    if (powerEvents.length < 6) {
      return null;
    }
    
    const sortedEvents = powerEvents.sort((a, b) => a.received_at - b.received_at);
    
    for (let i = 0; i < sortedEvents.length - 5; i++) {
      const startPattern = findConsecutiveEvents(sortedEvents, i, 3, 180);
      
      if (startPattern) {
        const cleaningStart = startPattern.firstEvent.received_at;
        
        for (let j = startPattern.lastIndex + 1; j < sortedEvents.length - 2; j++) {
          const endPattern = findConsecutiveEvents(sortedEvents, j, 3, 180);
          
          if (endPattern) {
            const cleaningEnd = endPattern.lastEvent.received_at;
            const cleaningDuration = cleaningEnd - cleaningStart;
            
            return {
              machine_id: machine.id,
              machine_name: machine.name,
              cleaning_start: cleaningStart,
              cleaning_end: cleaningEnd,
              cleaning_duration: cleaningDuration,
              date: date,
              status: 'completed',
              type: 'general'
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error checking general cleaning for machine ${machine.id} on ${date}:`, error);
    return null;
  }
}

// ===== HELPER FUNCTIONS =====
function findActualUserForCredit(userId, userName, allUsers) {
  try {
    console.log(`🔍 Finding actual user for credit - ID: ${userId}, Name: ${userName}`);
    
    if (userId) {
      const user = allUsers.find(u => u.id == userId);
      if (user) {
        console.log(`✅ Found user by ID: ${user.first_name} ${user.last_name}`);
        return {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          type: determineUserType(user)
        };
      }
    }
    
    if (userName && userName !== 'Unknown Operator' && userName !== 'System') {
      console.log(`🔍 Searching for user by name: ${userName}`);
      
      let user = allUsers.find(u => {
        const fullName = `${u.first_name} ${u.last_name}`.trim();
        return fullName.toLowerCase() === userName.toLowerCase();
      });
      
      if (!user) {
        user = allUsers.find(u => {
          const fullName = `${u.first_name} ${u.last_name}`.trim().toLowerCase();
          return userName.toLowerCase().includes(u.first_name.toLowerCase()) || 
                 userName.toLowerCase().includes(u.last_name.toLowerCase()) ||
                 fullName.includes(userName.toLowerCase());
        });
      }
      
      if (user) {
        console.log(`✅ Found user by name: ${user.first_name} ${user.last_name}`);
        return {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          type: determineUserType(user)
        };
      }
    }
    
    console.log(`❌ No matching user found, using credit user name: ${userName}`);
    return {
      id: userId,
      name: userName || 'Unknown User',
      type: 'operator'
    };
    
  } catch (error) {
    console.error("Error finding actual user for credit:", error);
    return {
      id: userId,
      name: userName || 'Unknown User',
      type: 'operator'
    };
  }
}

// Enhanced function to find cleaning finish time
function findCleaningFinishTime(machineId, attendanceTime, date) {
  try {
    const endOfDay = Math.floor(new Date(date + "T23:59:59").getTime() / 1000);
    
    console.log(`🔍 Finding cleaning finish time for machine ${machineId}`);
    console.log(`Attendance time: ${new Date(attendanceTime * 1000).toLocaleString()}`);
    
    const powerEvents = fetchPowerEventsInWindow(machineId, attendanceTime, endOfDay);
    console.log(`Found ${powerEvents.length} power events after attendance time`);
    
    if (powerEvents.length < 3) {
      console.log(`❌ Not enough power events to detect cleaning finish`);
      return null;
    }
    
    // Look for cleaning pattern: 3 consecutive events within 3 minutes
    let cleaningFinishTime = null;
    let cleaningPatterns = [];
    
    for (let i = 0; i <= powerEvents.length - 3; i++) {
      const event1 = powerEvents[i];
      const event2 = powerEvents[i + 1];
      const event3 = powerEvents[i + 2];
      
      const timeDiff1 = event2.received_at - event1.received_at;
      const timeDiff2 = event3.received_at - event2.received_at;
      
      // Check if these are 3 consecutive events within 3 minutes each
      if (timeDiff1 <= 180 && timeDiff2 <= 180) {
        const totalTime = event3.received_at - event1.received_at;
        if (totalTime <= 300) { // All 3 events within 5 minutes total
          cleaningPatterns.push({
            start: event1.received_at,
            end: event3.received_at,
            duration: totalTime
          });
        }
      }
    }
    
    // If we found cleaning patterns, use the one that starts after attendance but closest to it
    if (cleaningPatterns.length > 0) {
      // Filter patterns that start after attendance time
      const validPatterns = cleaningPatterns.filter(pattern => pattern.start > attendanceTime);
      
      if (validPatterns.length > 0) {
        // Use the pattern that starts closest to attendance time (first cleaning session)
        validPatterns.sort((a, b) => a.start - b.start);
        cleaningFinishTime = validPatterns[0].end;
        console.log(`✅ Cleaning finish detected at ${new Date(cleaningFinishTime * 1000).toLocaleString()}`);
        console.log(`⏱️ Cleaning duration: ${formatDurationDetailed(validPatterns[0].duration)}`);
      } else {
        console.log(`❌ No cleaning patterns found after attendance time`);
      }
    } else {
      console.log(`❌ No cleaning finish pattern detected`);
    }
    
    return cleaningFinishTime;
    
  } catch (error) {
    console.error("Error finding cleaning finish time:", error);
    return null;
  }
}

function fetchPowerEvents(startTimestamp, endTimestamp, machineId) {
  // Check cache first
  const startDate = new Date(startTimestamp * 1000).toISOString().split('T')[0];
  const endDate = new Date(endTimestamp * 1000).toISOString().split('T')[0];
  const cacheKey = `power_events_${machineId || 'all'}_${startDate}_${endDate}`;
  const cached = getCachedData(cacheKey);
  if (cached) {
    console.log(`✅ Using cached power events for machine ${machineId || 'all'}`);
    return cached;
  }
  
  const params = {
    from_timestamp: startTimestamp,
    to_timestamp: endTimestamp,
    limit: 1000
  };
  
  if (machineId) {
    params.machine_id = machineId;
  }
  
  const query = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
  
  const url = `${API_BASE}/event?${query}`;
  const res = UrlFetchApp.fetch(url, {
    headers: { "Authorization": "Token " + API_KEY },
    muteHttpExceptions: true
  });
  
  if (res.getResponseCode() !== 200) {
    throw new Error("Failed to fetch power events: " + res.getContentText());
  }
  
  const json = JSON.parse(res.getContentText());
  const allEvents = json.result || [];
  
  const powerEvents = allEvents.filter(event => 
    event.base_code === "Power Supply Interrupted" || 
    event.name === "Power Supply Interrupted"
  );
  
  // Cache for 10 minutes (600 seconds)
  setCachedData(cacheKey, powerEvents, 600);
  console.log(`💾 Cached power events for machine ${machineId || 'all'}`);
  
  return powerEvents;
}

// Fetch power events without cache - used for narrow windows to avoid stale data
function fetchPowerEventsInWindowNoCache(machineId, startTime, endTime) {
  try {
    const params = {
      machine_id: machineId,
      from_timestamp: startTime,
      to_timestamp: endTime,
      limit: 50
    };
    
    const query = Object.keys(params)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");
    
    const url = `${API_BASE}/event?${query}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.warn(`⚠️ Failed to fetch power events: HTTP ${res.getResponseCode()}`);
      return [];
    }
    
    const json = JSON.parse(res.getContentText());
    const allEvents = json.result || [];
    
    const powerEvents = allEvents.filter(event => 
      event.base_code === "Power Supply Interrupted" || 
      event.name === "Power Supply Interrupted"
    );
    
    // Sort by timestamp to ensure consistent ordering
    powerEvents.sort((a, b) => a.received_at - b.received_at);
    
    console.log(`📥 Fetched ${powerEvents.length} power events for machine ${machineId} (no cache, window: ${endTime - startTime}s)`);
    
    return powerEvents;
  } catch (error) {
    console.error("Error fetching power events in window (no cache):", error);
    return [];
  }
}

function fetchPowerEventsInWindow(machineId, startTime, endTime) {
  try {
    // For narrow windows (< 1 hour), use a more specific cache key that includes timestamps
    // For wider windows, use date-based cache key
    const windowDuration = endTime - startTime;
    let cacheKey;
    
    if (windowDuration < 3600) {
      // Narrow window: use timestamp-based cache key for accuracy
      // Round to nearest minute to allow some cache reuse
      const startMinute = Math.floor(startTime / 60) * 60;
      const endMinute = Math.ceil(endTime / 60) * 60;
      cacheKey = `power_events_window_${machineId}_${startMinute}_${endMinute}`;
    } else {
      // Wide window: use date-based cache key
      const startDate = new Date(startTime * 1000).toISOString().split('T')[0];
      const endDate = new Date(endTime * 1000).toISOString().split('T')[0];
      cacheKey = `power_events_window_${machineId}_${startDate}_${endDate}`;
    }
    
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log(`✅ Using cached power events window for machine ${machineId} (window: ${windowDuration}s)`);
      // Filter cached events to match the exact window (cache might be slightly wider)
      return cached.filter(event => 
        event.received_at >= startTime && 
        event.received_at <= endTime
      );
    }
    
    const params = {
      machine_id: machineId,
      from_timestamp: startTime,
      to_timestamp: endTime,
      limit: 100 // Increased limit for wider windows
    };
    
    const query = Object.keys(params)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join("&");
    
    const url = `${API_BASE}/event?${query}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.warn(`⚠️ Failed to fetch power events: HTTP ${res.getResponseCode()}`);
      return [];
    }
    
    const json = JSON.parse(res.getContentText());
    const allEvents = json.result || [];
    
    const powerEvents = allEvents.filter(event => 
      event.base_code === "Power Supply Interrupted" || 
      event.name === "Power Supply Interrupted"
    );
    
    // Sort by timestamp to ensure consistent ordering
    powerEvents.sort((a, b) => a.received_at - b.received_at);
    
    // Cache for 10 minutes (600 seconds)
    // For narrow windows, cache slightly longer to reduce API calls
    const cacheDuration = windowDuration < 3600 ? 900 : 600; // 15 min for narrow, 10 min for wide
    setCachedData(cacheKey, powerEvents, cacheDuration);
    
    console.log(`📥 Fetched ${powerEvents.length} power events for machine ${machineId} (window: ${windowDuration}s)`);
    
    return powerEvents;
  } catch (error) {
    console.error("Error fetching power events in window:", error);
    return [];
  }
}

function checkConsecutiveEvents(events, requiredCount, maxTimeWindow) {
  if (events.length < requiredCount) return false;
  
  const sortedEvents = events.sort((a, b) => a.received_at - b.received_at);
  
  for (let i = 0; i <= sortedEvents.length - requiredCount; i++) {
    const firstEvent = sortedEvents[i];
    const lastEvent = sortedEvents[i + requiredCount - 1];
    const timeDiff = lastEvent.received_at - firstEvent.received_at;
    
    if (timeDiff <= maxTimeWindow) {
      return true;
    }
  }
  
  return false;
}

function findConsecutiveEvents(events, startIndex, requiredCount, maxTimeWindow) {
  if (startIndex + requiredCount > events.length) return null;
  
  const firstEvent = events[startIndex];
  const lastEvent = events[startIndex + requiredCount - 1];
  const timeDiff = lastEvent.received_at - firstEvent.received_at;
  
  if (timeDiff <= maxTimeWindow) {
    return {
      firstEvent: firstEvent,
      lastEvent: lastEvent,
      lastIndex: startIndex + requiredCount - 1
    };
  }
  
  return null;
}

function getSaturdaysInRange(startDate, endDate) {
  const saturdays = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const current = new Date(start);
  while (current <= end) {
    if (current.getDay() === 6) {
      saturdays.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  
  return saturdays;
}

function determineUserType(user) {
  if (!user) return 'operator';
  
  const type = user.type || '';
  const typeTitle = user.type_title || '';
  
  if (type.includes('route') || typeTitle.includes('Route') || 
      type.includes('driver') || typeTitle.includes('Driver')) {
    return 'route_driver';
  }
  
  if (type.includes('operator') || typeTitle.includes('Operator')) {
    return 'operator';
  }
  
  return 'operator';
}

function getUserTypeFromRecord(record) {
  const userName = record.user_name || '';
  
  if (userName.toLowerCase().includes('route') || userName.toLowerCase().includes('driver')) {
    return 'route_driver';
  }
  
  return 'operator';
}

// ===== DEBUG FUNCTIONS =====
function debugSession() {
  try {
    const credentials = getVendonCredentials();
    console.log("Current credentials status:", {
      hasUsername: !!credentials.username,
      hasPassword: !!credentials.password,
      sessionExists: !!VENDON_SESSION.allCookies
    });
    
    if (!credentials.username || !credentials.password) {
      return {
        success: false,
        message: "Credentials not configured"
      };
    }
    
    console.log("Testing Basic Auth login...");
    const loginSuccess = refreshVendonSessionBasicAuth();
    
    if (loginSuccess && VENDON_SESSION.allCookies) {
      const testMachineId = 399885;
      const testStartDate = '2025-10-02';
      const testEndDate = '2025-10-02';
      
      console.log("Testing API endpoint with Basic Auth...");
      const credits = fetchRemoteCreditsFromSettingChangeLog(testMachineId, testStartDate, testEndDate);
      
      return {
        success: true,
        message: `✅ Debug successful! Found ${credits.length} remote credits.`,
        creditsCount: credits.length,
        sessionCookies: VENDON_SESSION.allCookies ? 'Set with Basic Auth' : 'Not set'
      };
    } else {
      return {
        success: false,
        message: "❌ Basic Auth login failed"
      };
    }
    
  } catch (error) {
    console.error("Debug error:", error);
    return {
      success: false,
      message: `❌ Debug failed: ${error.message}`
    };
  }
}

function debugRemoteCreditsData(machineId, startDate, endDate) {
  try {
    console.log(`=== DEBUG REMOTE CREDITS DATA FOR MACHINE ${machineId} ===`);
    
    const startTimestamp = Math.floor(new Date(startDate + "T00:00:00").getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000);
    
    const credentials = getVendonCredentials();
    const authString = Utilities.base64Encode(`${credentials.username}:${credentials.password}`);
    
    const url = `https://cloud.vendon.net/rest/head/machine/settingChangeLog?id=${machineId}&from_timestamp=${startTimestamp}&to_timestamp=${endTimestamp}&user=&limit=200&offset=0`;
    
    console.log("Debug request URL:", url);
    
    const options = {
      'method': 'GET',
      'headers': {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'authorization': `Basic ${authString}`,
        'priority': 'u=1, i',
        'referer': `https://cloud.vendon.net/device/${machineId}/log`,
        'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      },
      'muteHttpExceptions': true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    console.log("Debug response code:", responseCode);
    
    if (responseCode === 200) {
      const data = JSON.parse(responseText);
      const logRecords = data.result?.log_records || [];
      
      console.log(`=== RAW DATA ANALYSIS ===`);
      console.log(`Total log records: ${logRecords.length}`);
      
      const remoteCreditRecords = logRecords.filter(record => record.action === 'Remote credit sent');
      console.log(`Remote credit records: ${remoteCreditRecords.length}`);
      
      remoteCreditRecords.forEach((record, index) => {
        console.log(`\n--- Record ${index + 1} ---`);
        console.log(`ID: ${record.id}`);
        console.log(`User: ${record.user_name} (${record.user_id})`);
        console.log(`Action: ${record.action}`);
        console.log(`Timestamp: ${new Date(record.changed_at * 1000).toLocaleString()}`);
        console.log(`Raw Data: "${record.data}"`);
        
        const parsed = parseRemoteCreditRecord(record, machineId);
        console.log(`Parsed Successfully: ${!!parsed}`);
        if (parsed) {
          console.log(`Parsed Data:`, parsed);
        }
      });
      
      return {
        success: true,
        totalRecords: logRecords.length,
        remoteCreditRecords: remoteCreditRecords.length,
        parsedRecords: remoteCreditRecords.filter(r => parseRemoteCreditRecord(r, machineId)).length,
        sampleData: remoteCreditRecords.length > 0 ? remoteCreditRecords[0] : null
      };
    } else {
      throw new Error(`HTTP ${responseCode}: ${responseText}`);
    }
    
  } catch (error) {
    console.error("Debug error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

function debugAttendanceForMachine(machineId, startDate, endDate) {
  try {
    console.log(`=== DEBUG ATTENDANCE FOR MACHINE ${machineId} ===`);
    
    const remoteCredits = fetchRemoteCreditsFromSettingChangeLog(machineId, startDate, endDate);
    console.log(`Found ${remoteCredits.length} remote credits`);
    
    const startTimestamp = Math.floor(new Date(startDate + "T00:00:00").getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate + "T23:59:59").getTime() / 1000);
    const powerEvents = fetchPowerEvents(startTimestamp, endTimestamp, machineId);
    
    const powerEventDistribution = {};
    powerEvents.forEach(event => {
      const hour = new Date(event.received_at * 1000).getHours();
      if (!powerEventDistribution[hour]) {
        powerEventDistribution[hour] = [];
      }
      powerEventDistribution[hour].push(event);
    });
    
    const allResults = [];
    let firstValidAttendance = null;
    
    for (const credit of remoteCredits) {
      if (credit.status === 'Vend successful') {
        const powerEventsAfter = fetchPowerEventsInWindow(
          machineId, 
          credit.timestamp, 
          credit.timestamp + 180
        );
        
        const hasConsecutive = checkConsecutiveEvents(powerEventsAfter, 2, 180);
        
        const result = {
          creditIndex: remoteCredits.indexOf(credit) + 1,
          creditTime: new Date(credit.timestamp * 1000).toLocaleString(),
          creditAmount: credit.credit_amount,
          creditUser: credit.user_name,
          powerEventsAfter: powerEventsAfter.length,
          hasConsecutive: hasConsecutive,
          consecutiveEvents: hasConsecutive ? '✅ YES' : '❌ NO'
        };
        
        allResults.push(result);
        
        if (hasConsecutive && !firstValidAttendance) {
          firstValidAttendance = result;
        }
      }
    }
    
    return {
      success: true,
      machineId: machineId,
      startDate: startDate,
      endDate: endDate,
      totalCredits: remoteCredits.length,
      credits: remoteCredits.map(c => ({
        time: new Date(c.timestamp * 1000).toLocaleString(),
        user: c.user_name,
        amount: c.credit_amount,
        status: c.status,
        source: c.source
      })),
      powerEvents: powerEvents.length,
      powerEventDistribution: powerEventDistribution,
      allResults: allResults,
      firstValidAttendance: firstValidAttendance,
      message: firstValidAttendance ? 
        `✅ Valid attendance found!` : 
        `❌ No valid attendance patterns detected`
    };
    
  } catch (error) {
    console.error("Debug error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== CREDENTIAL MANAGEMENT =====
function setVendonCredentials(username, password) {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('VENDON_USERNAME', username);
  scriptProperties.setProperty('VENDON_PASSWORD', password);
  
  VENDON_SESSION.allCookies = null;
  VENDON_SESSION.lastRefresh = 0;
  
  return { success: true, message: 'Credentials saved successfully' };
}

function getCredentialStatus() {
  const credentials = getVendonCredentials();
  const hasCredentials = !!(credentials.username && credentials.password);
  
  let sessionStatus = 'Not authenticated';
  if (VENDON_SESSION.allCookies) {
    const sessionAge = Date.now() - VENDON_SESSION.lastRefresh;
    sessionStatus = `Authenticated (${Math.round(sessionAge / 1000 / 60)} minutes ago)`;
  }
  
  return {
    hasCredentials: hasCredentials,
    username: credentials.username ? '***' + credentials.username.slice(-3) : 'Not set',
    isConfigured: hasCredentials,
    sessionStatus: sessionStatus
  };
}

function testVendonCredentials(username, password) {
  try {
    console.log("Testing Vendon credentials...");
    
    const scriptProperties = PropertiesService.getScriptProperties();
    const originalUsername = scriptProperties.getProperty('VENDON_USERNAME');
    const originalPassword = scriptProperties.getProperty('VENDON_PASSWORD');
    
    scriptProperties.setProperty('VENDON_USERNAME', username);
    scriptProperties.setProperty('VENDON_PASSWORD', password);
    
    VENDON_SESSION.allCookies = null;
    VENDON_SESSION.lastRefresh = 0;
    
    const loginResult = refreshVendonSessionBasicAuth();
    
    if (originalUsername) {
      scriptProperties.setProperty('VENDON_USERNAME', originalUsername);
    } else {
      scriptProperties.deleteProperty('VENDON_USERNAME');
    }
    
    if (originalPassword) {
      scriptProperties.setProperty('VENDON_PASSWORD', originalPassword);
    } else {
      scriptProperties.deleteProperty('VENDON_PASSWORD');
    }
    
    if (loginResult) {
      return {
        success: true,
        message: '✅ Credentials are valid! Login successful.'
      };
    } else {
      return {
        success: false,
        message: '❌ Login failed with provided credentials'
      };
    }
    
  } catch (error) {
    console.error("Credential test error:", error);
    
    const scriptProperties = PropertiesService.getScriptProperties();
    const originalUsername = scriptProperties.getProperty('VENDON_USERNAME');
    const originalPassword = scriptProperties.getProperty('VENDON_PASSWORD');
    
    if (originalUsername) {
      scriptProperties.setProperty('VENDON_USERNAME', originalUsername);
    }
    if (originalPassword) {
      scriptProperties.setProperty('VENDON_PASSWORD', originalPassword);
    }
    
    return {
      success: false,
      message: `❌ Error testing credentials: ${error.message}`
    };
  }
}

function clearAttendanceCache() {
  try {
    // Clear all relevant caches
    const cache = CacheService.getScriptCache();
    
    // Clear session
    VENDON_SESSION.allCookies = null;
    VENDON_SESSION.lastRefresh = 0;
    
    // Note: Individual cache keys are cleared automatically on TTL expiry
    // For manual clearing, we'd need to track all keys (not possible without storing them)
    // The cache will automatically expire after 10 minutes (600 seconds)
    
    console.log("✅ Attendance cache and session cleared");
    return { success: true, message: "Attendance cache and session cleared successfully. Cached data will expire automatically after 10 minutes." };
  } catch (error) {
    console.error("Error clearing attendance cache:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Load all-time cleaning averages on demand (optional, for when user needs them)
 * This is separated from the main load to speed up initial data loading
 */
function loadAllTimeCleaningAverages(filters) {
  try {
    const { machineId } = filters;
    const allMachines = fetchMachines();
    
    const targetMachines = machineId 
      ? allMachines.filter(m => m.id == machineId) 
      : allMachines;
    
    // Limit to prevent timeout
    let machinesToProcess = targetMachines;
    if (!machineId && targetMachines.length > 5) {
      machinesToProcess = targetMachines.slice(0, 5);
    }
    
    console.log(`📊 Loading all-time averages for ${machinesToProcess.length} machines...`);
    const allTimeCleaningAverages = getAllTimeCleaningAverages(machinesToProcess);
    
    return {
      success: true,
      allTimeCleaningAverages: allTimeCleaningAverages || []
    };
  } catch (error) {
    console.error("Error loading all-time averages:", error);
    return {
      success: false,
      error: error.message,
      allTimeCleaningAverages: []
    };
  }
}

function debugProgressSystem() {
  const testKey = 'test_progress_' + new Date().getTime();
  console.log("🧪 Testing progress system with key:", testKey);
  
  // Test backend storage
  google.script.run
    .withSuccessHandler(function(result) {
      console.log("✅ Backend storage test:", result);
      
      // Now test retrieval
      google.script.run
        .withSuccessHandler(function(progress) {
          console.log("✅ Backend retrieval test:", progress);
          alert("Progress system test:\n\nStorage: " + JSON.stringify(result) + 
                "\n\nRetrieval: " + JSON.stringify(progress));
        })
        .withFailureHandler(function(error) {
          console.error("❌ Backend retrieval failed:", error);
          alert("❌ Progress retrieval failed: " + error);
        })
        .getAttendanceProgress(testKey);
    })
    .withFailureHandler(function(error) {
      console.error("❌ Backend storage failed:", error);
      alert("❌ Progress storage failed: " + error);
    })
    .testProgressStorage(testKey);
}

function testProgressStorage(progressKey) {
  try {
    updateProgress(progressKey, 50, "Test progress message");
    return { 
      success: true, 
      message: "Progress stored successfully",
      key: progressKey 
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ---------- Intra-Day Checkup (control staff: midday operator readiness) ----------
function getPeopleAnalyticsApiBase() {
  try {
    var base = PropertiesService.getScriptProperties().getProperty('PEOPLE_ANALYTICS_API_BASE');
    if (base && base.trim()) return base.trim().replace(/\/$/, '');
  } catch (e) {}
  return 'https://people-api.theleetclub.com';
}

/**
 * Find operators for a specific machine based on operator type and machine access.
 * Same logic as used in refill-tab.js for consistency.
 * @param {string} machineId - The machine ID to find operators for
 * @param {Array} allUsers - Array of all users from fetchUsers()
 * @returns {Array} Array of operator objects with id, name, email, type
 */
function findUserForMachine(machineId, allUsers) {
  try {
    if (!machineId || !allUsers || !Array.isArray(allUsers)) {
      return [];
    }
    
    // Filter for operators - check both type and type_title
    var operators = allUsers.filter(function(user) {
      return user.type === "operator" || 
             user.type === "custom-type38948" || 
             (user.type && user.type.startsWith("custom-type") && user.type_title === "Operator") ||
             (user.type_title && user.type_title.toLowerCase().includes("operator"));
    });
    
    var assignedUsers = [];
    
    for (var i = 0; i < operators.length; i++) {
      var operator = operators[i];
      try {
        var userDetails = fetchUserDetails(operator.id);
        
        if (!userDetails) {
          continue;
        }
        
        var hasAccess = false;
        
        // Check if user has access to all machines
        if (userDetails.can_access_all_machines === true) {
          hasAccess = true;
        }
        
        // Check if user has specific access to this machine
        if (!hasAccess && userDetails.access_machines) {
          if (Array.isArray(userDetails.access_machines)) {
            hasAccess = userDetails.access_machines.some(function(machine) {
              if (typeof machine === 'object' && machine.id) {
                return String(machine.id) === String(machineId);
              } else {
                return String(machine) === String(machineId);
              }
            });
          }
        }
        
        if (hasAccess) {
          assignedUsers.push({
            id: operator.id,
            name: (operator.first_name + ' ' + operator.last_name).trim(),
            email: operator.email || "",
            type: 'operator'
          });
        }
      } catch (error) {
        console.error('Error processing operator ' + operator.first_name + ' ' + operator.last_name + ':', error);
      }
    }
    
    return assignedUsers;
  } catch (e) {
    console.error('findUserForMachine error:', e);
    return [];
  }
}

/**
 * Returns operators for the given machine using same criteria as attendance/refill (operator type + access).
 * Callable from client for Intra-Day Checkup subtab.
 */
function getOperatorsForMachineForCheckup(machineId) {
  try {
    if (!machineId) return [];
    var allUsers = fetchUsers();
    return findUserForMachine(machineId, allUsers);
  } catch (e) {
    console.error('getOperatorsForMachineForCheckup:', e);
    return [];
  }
}

/**
 * Fetch intra-day checkups from people-api. startDate/endDate YYYY-MM-DD; machineId optional.
 */
function getIntraDayCheckups(startDate, endDate, machineId) {
  try {
    var base = getPeopleAnalyticsApiBase();
    var queryParams = 'start_date=' + encodeURIComponent(startDate) + '&end_date=' + encodeURIComponent(endDate);
    if (machineId) queryParams += '&machine_id=' + encodeURIComponent(machineId);
    
    // Try /api/intra-day-checkups first, then /intra-day-checkups as fallback
    var urls = [
      base + '/api/intra-day-checkups?' + queryParams,
      base + '/intra-day-checkups?' + queryParams
    ];
    
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      var res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      var code = res.getResponseCode();
      var body = res.getContentText();
      
      if (code === 200) {
        try {
          var data = JSON.parse(body);
          return data.success ? { success: true, checkups: data.checkups || [] } : { success: false, error: data.error || 'Unknown', checkups: [] };
        } catch (parseErr) {
          console.error('getIntraDayCheckups JSON parse error:', parseErr);
          return { success: false, error: 'Invalid response format', checkups: [] };
        }
      }
      
      // If 404 and we have another URL to try, continue
      if (code === 404 && i < urls.length - 1) {
        continue;
      }
      
      // For non-404 errors or last URL, return error
      console.warn('getIntraDayCheckups HTTP ' + code + ' at ' + url + ': ' + body);
      return { success: false, error: body || 'HTTP ' + code, checkups: [] };
    }
    
    return { success: false, error: 'Endpoint not found', checkups: [] };
  } catch (e) {
    console.error('getIntraDayCheckups:', e);
    return { success: false, error: e.message, checkups: [] };
  }
}

/**
 * Save or update one intra-day checkup. status: 'ready' | 'not_ready'.
 */
function saveIntraDayCheckup(machineId, operatorId, operatorName, checkDate, status, recordedBy) {
  try {
    var base = getPeopleAnalyticsApiBase();
    var payload = JSON.stringify({
      machine_id: String(machineId),
      operator_id: String(operatorId),
      operator_name: String(operatorName || ''),
      check_date: checkDate,
      status: status === 'not_ready' ? 'not_ready' : 'ready',
      recorded_by: String(recordedBy || '')
    });
    
    // Try /api/intra-day-checkups first, then /intra-day-checkups as fallback
    var urls = [base + '/api/intra-day-checkups', base + '/intra-day-checkups'];
    var lastError = null;
    
    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      console.log('saveIntraDayCheckup trying URL: ' + url);
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: payload,
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = res.getContentText();
      
      if (code === 200) {
        try {
          var data = JSON.parse(body);
          if (data.success) {
            // Send Slack DM notifications after successful save
            var slackResult = sendIntraDayCheckupSlackNotification({
              machineId: machineId,
              machineName: null, // Will be looked up if needed
              operatorId: operatorId,
              operatorName: operatorName,
              checkDate: checkDate,
              status: status
            });
            return { 
              success: true, 
              id: data.id,
              slackNotification: slackResult // Include Slack notification result
            };
          } else {
            return { success: false, error: data.error || 'Unknown' };
          }
        } catch (parseErr) {
          console.error('saveIntraDayCheckup JSON parse error:', parseErr, 'Body:', body);
          return { success: false, error: 'Invalid response format' };
        }
      }
      
      // If 404 and we have another URL to try, continue; otherwise save error
      if (code === 404 && i < urls.length - 1) {
        console.warn('saveIntraDayCheckup HTTP ' + code + ' at ' + url + ', trying alternative endpoint');
        lastError = { code: code, body: body, url: url };
        continue;
      }
      
      // For non-404 errors or last URL, return error immediately
      console.warn('saveIntraDayCheckup HTTP ' + code + ' at ' + url + ': ' + body);
      return { success: false, error: 'HTTP ' + code + (body ? ': ' + body.substring(0, 200) : '') };
    }
    
    // If we get here, all URLs failed
    return { success: false, error: 'Endpoint not found. Please ensure people-api is deployed with intra-day-checkups routes.' };
  } catch (e) {
    console.error('saveIntraDayCheckup exception:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Send Slack DM notification for Intra-Day Checkup
 * Sends to: salem@almaghrebrd.com and mahdi.swaidan1@gmail.com (for testing)
 * Uses same method as Delay Risk strikes - tries to find users by email in user data first
 * @returns {Object} Result with sent/errors arrays
 */
function sendIntraDayCheckupSlackNotification(checkupData) {
  try {
    // Recipients with their Slack user IDs (if you have them)
    // Format: { email: 'user@example.com', slackUserId: 'U1234567890' } or just email
    var recipients = [
      { email: 'salem@almaghrebrd.com', slackUserId: null }, // Will try to lookup if null
      { email: 'mahdi.swaidan1@gmail.com', slackUserId: null } // Testing email lookup - removed hardcoded ID
    ];
    
    // Check Script Properties for Slack user IDs (can be set manually)
    // Format: SLACK_USER_ID_salem@almaghrebrd.com = U1234567890
    try {
      var props = PropertiesService.getScriptProperties();
      recipients.forEach(function(recipient) {
        if (!recipient.slackUserId) {
          var propKey = 'SLACK_USER_ID_' + recipient.email.replace(/[@.]/g, '_');
          var slackId = props.getProperty(propKey);
          if (slackId && slackId.trim()) {
            recipient.slackUserId = slackId.trim();
            console.log('Found Slack user ID for ' + recipient.email + ' from Script Properties: ' + recipient.slackUserId);
          }
        }
      });
    } catch (e) {
      console.warn('Could not check Script Properties for Slack user IDs:', e);
    }
    
    // Try to get Slack user IDs from user data (if available in user records)
    try {
      var allUsers = fetchUsers();
      if (allUsers && Array.isArray(allUsers)) {
        recipients.forEach(function(recipient) {
          if (!recipient.slackUserId) {
            var user = allUsers.find(function(u) {
              return u.email && u.email.toLowerCase() === recipient.email.toLowerCase();
            });
            // Check if user has slack_id or similar field
            if (user && (user.slack_id || user.slack_user_id || user.slackId)) {
              recipient.slackUserId = user.slack_id || user.slack_user_id || user.slackId;
              console.log('Found Slack user ID for ' + recipient.email + ' from user data: ' + recipient.slackUserId);
            }
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch users for Slack ID lookup:', e);
    }
    
    var results = {
      success: false,
      sent: [],
      errors: []
    };
    
    // Get machine name if available
    var machineName = checkupData.machineName;
    if (!machineName && checkupData.machineId) {
      try {
        var machines = fetchMachines();
        if (machines && Array.isArray(machines)) {
          var machine = machines.find(function(m) {
            return String(m.id) === String(checkupData.machineId);
          });
          if (machine) {
            machineName = machine.name;
          }
        }
      } catch (e) {
        console.warn('Could not fetch machine name:', e);
      }
    }
    
    var statusText = checkupData.status === 'not_ready' ? '❌ Not Ready' : '✅ Ready';
    var message = '📋 *Intra-Day Checkup Recorded*\n\n' +
                  '*Machine:* ' + (machineName || checkupData.machineId) + '\n' +
                  '*Operator:* ' + (checkupData.operatorName || checkupData.operatorId) + '\n' +
                  '*Date:* ' + checkupData.checkDate + '\n' +
                  '*Status:* ' + statusText + '\n\n' +
                  '_This is a direct message from the Monitoring App bot._';
    
    // Send DM to each recipient - try Slack user ID first if available, otherwise use email lookup
    recipients.forEach(function(recipient) {
      try {
        var email = recipient.email;
        var slackUserId = recipient.slackUserId;
        var dmResult;
        if (slackUserId) {
          // Use Slack user ID directly (no email lookup needed - avoids missing_scope error)
          console.log('Using Slack user ID for ' + email + ': ' + slackUserId);
          dmResult = sendSlackDMByUserId(slackUserId, message);
        } else {
          // Fall back to email lookup (requires users:read.email scope - will fail if not available)
          console.log('No Slack user ID found for ' + email + ', trying email lookup (may fail if token lacks users:read.email scope)');
          dmResult = sendSlackDMByEmail(email, message);
        }
        if (dmResult && dmResult.success) {
          results.sent.push({ email: email, name: email.split('@')[0] });
          results.success = true;
        } else {
          var errorMsg = dmResult ? dmResult.error : 'Unknown error';
          results.errors.push('Failed to send to ' + email + ': ' + errorMsg);
          // If missing_scope error, suggest setting Slack user ID in Script Properties
          if (errorMsg && errorMsg.indexOf('missing_scope') !== -1) {
            results.errors.push('Tip: Set Slack user ID in Script Properties as SLACK_USER_ID_' + email.replace(/[@.]/g, '_') + ' to avoid scope requirement');
          }
        }
      } catch (e) {
        console.error('Error sending Slack DM to ' + recipient.email + ':', e);
        results.errors.push('Error sending to ' + recipient.email + ': ' + e.toString());
      }
    });
    
    // Log results for debugging
    console.log('Slack notification results:', JSON.stringify({
      sent: results.sent.length,
      errors: results.errors.length,
      details: results
    }));
    
    return results;
  } catch (e) {
    console.error('Error in sendIntraDayCheckupSlackNotification:', e);
    return { success: false, sent: [], errors: ['Notification error: ' + e.toString()] };
  }
}

/**
 * Send Slack DM to a user by Slack user ID (no email lookup needed)
 * Uses same token retrieval method as Delay Risk strikes
 */
function sendSlackDMByUserId(userId, message) {
  try {
    if (!userId || !userId.trim()) {
      return { success: false, error: 'No Slack user ID provided' };
    }
    
    // Get Slack token
    var token = getSlackTokenForDM();
    if (!token || !token.token) {
      return { success: false, error: token ? token.error : 'No Slack token configured' };
    }
    
    return sendSlackDMWithToken(userId, message, token.token, token.type);
  } catch (e) {
    console.error('Error sending Slack DM by user ID:', e);
    return { success: false, error: e.toString() };
  }
}

/**
 * Get Slack token for DM sending (helper function)
 */
function getSlackTokenForDM() {
  try {
    var props = PropertiesService.getScriptProperties();
    // Prefer Bot Token so messages appear as sent by bot (not user's name)
    // Bot Token with im:write scope should work for DMs
    var token = props.getProperty('SLACK_BOT_TOKEN');
    if (token && token.trim()) {
      return { token: token.trim(), type: 'bot' };
    }
    // Fall back to User Token if Bot Token not available
    token = props.getProperty('SLACK_USER_TOKEN');
    if (token && token.trim()) {
      return { token: token.trim(), type: 'user' };
    }
    return { error: 'No Slack token found. Set SLACK_BOT_TOKEN or SLACK_USER_TOKEN in Script Properties.' };
  } catch (e) {
    return { error: 'Error getting Slack token: ' + e.toString() };
  }
}

/**
 * Send Slack DM using token and user ID (shared implementation)
 */
function sendSlackDMWithToken(userId, message, token, tokenType) {
  try {
    // Step 1: Open DM conversation
    // Use conversations.open with users parameter to create/open a DM
    // For bots, explicitly request IM channel and ensure it's a proper DM
    var openUrl = 'https://slack.com/api/conversations.open';
    var openPayloadObj = { 
      users: userId,
      return_im: true  // Always request IM (DM) channel explicitly
    };
    
    var openPayload = JSON.stringify(openPayloadObj);
    var openHeaders = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    
    Logger.log('Opening DM conversation with user: ' + userId + ' using ' + tokenType + ' token');
    Logger.log('Payload: ' + openPayload);
    
    var openResponse = UrlFetchApp.fetch(openUrl, {
      method: 'post',
      headers: openHeaders,
      payload: openPayload,
      muteHttpExceptions: true
    });
    
    if (openResponse.getResponseCode() !== 200) {
      var errorMsg = 'Slack conversations.open failed: HTTP ' + openResponse.getResponseCode();
      console.warn(errorMsg);
      Logger.log(errorMsg);
      Logger.log('Response: ' + openResponse.getContentText());
      return { success: false, error: 'Open conversation failed: HTTP ' + openResponse.getResponseCode() };
    }
    
    var openData = JSON.parse(openResponse.getContentText());
    Logger.log('conversations.open response: ' + JSON.stringify(openData));
    
    if (!openData.ok || !openData.channel || !openData.channel.id) {
      var errorMsg = 'Slack conversation open failed: ' + (openData.error || 'No channel ID');
      console.warn(errorMsg);
      Logger.log(errorMsg + ' | Response: ' + JSON.stringify(openData));
      return { success: false, error: openData.error || 'No channel ID' };
    }
    
    var channelId = openData.channel.id;
    var channelInfo = openData.channel;
    
    // Log channel type to verify it's a DM (channel IDs starting with 'D' are DMs)
    var channelType = channelId.startsWith('D') ? 'DM' : (channelId.startsWith('C') ? 'Public Channel' : (channelId.startsWith('G') ? 'Private Channel' : 'Unknown'));
    var isIm = channelInfo.is_im === true || channelInfo.is_im === 'true';
    Logger.log('Opened conversation: ' + channelType + ' | Channel ID: ' + channelId + ' | User ID: ' + userId + ' | is_im: ' + isIm);
    Logger.log('Channel info: ' + JSON.stringify({
      id: channelId,
      is_im: isIm,
      is_open: channelInfo.is_open,
      is_archived: channelInfo.is_archived,
      user: channelInfo.user
    }));
    
    if (!channelId.startsWith('D') && !isIm) {
      Logger.log('⚠️ WARNING: Channel does not appear to be a DM! Channel type: ' + channelType);
      Logger.log('⚠️ This may cause messages to appear in app instead of DMs');
    }
    
    // Ensure channel is open and active
    if (channelInfo.is_archived) {
      Logger.log('⚠️ WARNING: DM channel is archived! Messages may not be delivered');
    }
    
    // Step 2: Send message
    var postUrl = 'https://slack.com/api/chat.postMessage';
    var postPayloadObj = {
      channel: channelId,
      text: message
    };
    
    // When using Bot Token, messages automatically appear as sent by the bot
    // When using User Token, messages appear as sent by the user
    // For Bot Token, ensure we're sending to a DM channel (channel ID starts with D)
    // This should make messages appear in Direct Messages section, not Apps section
    
    Logger.log('Sending message to channel: ' + channelId + ' (Type: ' + channelType + ', is_im: ' + isIm + ')');
    
    var postPayload = JSON.stringify(postPayloadObj);
    var postHeaders = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    };
    
    var postResponse = UrlFetchApp.fetch(postUrl, {
      method: 'post',
      headers: postHeaders,
      payload: postPayload,
      muteHttpExceptions: true
    });
    
    if (postResponse.getResponseCode() !== 200) {
      var errorMsg = 'Slack chat.postMessage failed: HTTP ' + postResponse.getResponseCode();
      console.warn(errorMsg);
      Logger.log(errorMsg);
      return { success: false, error: 'Post message failed: HTTP ' + postResponse.getResponseCode() };
    }
    
    var postData = JSON.parse(postResponse.getContentText());
    if (!postData.ok) {
      var errorMsg = 'Slack message post failed: ' + (postData.error || 'Unknown error');
      console.warn(errorMsg);
      Logger.log(errorMsg + ' | Response: ' + JSON.stringify(postData));
      return { success: false, error: postData.error || 'Message post failed' };
    }
    
    // Log full response for debugging
    var channelType = channelId.startsWith('D') ? 'DM' : (channelId.startsWith('C') ? 'Public Channel' : (channelId.startsWith('G') ? 'Private Channel' : 'Unknown'));
    var successMsg = 'Slack message sent successfully using ' + tokenType + ' token | Type: ' + channelType + ' | Channel: ' + channelId + ' | TS: ' + (postData.ts || 'N/A');
    console.log(successMsg);
    Logger.log(successMsg);
    Logger.log('Message sent to: ' + channelType + ' (Channel ID: ' + channelId + ')');
    Logger.log('Full postMessage response: ' + JSON.stringify(postData));
    
    // Check if message was sent as bot or user
    if (postData.message) {
      Logger.log('Message sender info: ' + JSON.stringify({
        user: postData.message.user,
        bot_id: postData.message.bot_id,
        username: postData.message.username,
        subtype: postData.message.subtype
      }));
    }
    
    // Check for warnings that might indicate delivery issues
    if (postData.warning) {
      Logger.log('⚠️ Warning from Slack: ' + postData.warning);
    }
    if (postData.response_metadata && postData.response_metadata.warnings) {
      postData.response_metadata.warnings.forEach(function(warning) {
        Logger.log('⚠️ Slack warning: ' + warning);
      });
    }
    
    return { success: true, channelId: channelId, ts: postData.ts, response: postData };
  } catch (e) {
    console.error('Error in sendSlackDMWithToken:', e);
    Logger.log('Error in sendSlackDMWithToken: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Send Slack DM to a user by email address
 * Uses same token retrieval method as Delay Risk strikes (SLACK_BOT_TOKEN or SLACK_USER_TOKEN)
 * Requires users:read.email scope - if not available, use sendSlackDMByUserId instead
 */
function sendSlackDMByEmail(email, message) {
  try {
    if (!email || !email.trim()) {
      console.warn('sendSlackDMByEmail: No email provided');
      return { success: false, error: 'No email provided' };
    }
    
    // Get Slack token
    var token = getSlackTokenForDM();
    if (!token || !token.token) {
      return { success: false, error: token ? token.error : 'No Slack token configured' };
    }
    
    // Step 1: Look up user by email (requires users:read.email scope)
    var lookupUrl = 'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email.trim());
    var lookupHeaders = {
      'Authorization': 'Bearer ' + token.token,
      'Content-Type': 'application/json'
    };
    
    var lookupResponse = UrlFetchApp.fetch(lookupUrl, {
      method: 'get',
      headers: lookupHeaders,
      muteHttpExceptions: true
    });
    
    if (lookupResponse.getResponseCode() !== 200) {
      var errorMsg = 'Slack users.lookupByEmail failed: HTTP ' + lookupResponse.getResponseCode();
      console.warn(errorMsg);
      Logger.log(errorMsg);
      return { success: false, error: 'Lookup failed: HTTP ' + lookupResponse.getResponseCode() };
    }
    
    var lookupData = JSON.parse(lookupResponse.getContentText());
    if (!lookupData.ok || !lookupData.user || !lookupData.user.id) {
      var errorMsg = 'Slack user lookup failed for ' + email + ': ' + (lookupData.error || 'User not found');
      console.warn(errorMsg);
      Logger.log(errorMsg + ' | Response: ' + JSON.stringify(lookupData));
      // If missing_scope error, suggest using user ID instead
      if (lookupData.error === 'missing_scope') {
        return { success: false, error: 'Token missing users:read.email scope. Need Slack user IDs instead of emails.' };
      }
      return { success: false, error: lookupData.error || 'User not found in Slack workspace' };
    }
    
    var userId = lookupData.user.id;
    
    // Step 2 & 3: Open conversation and send message (shared implementation)
    return sendSlackDMWithToken(userId, message, token.token, token.type);
    
  } catch (e) {
    console.error('Error sending Slack DM to ' + email + ':', e);
    Logger.log('Error sending Slack DM to ' + email + ': ' + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Test function to verify Slack token has required scopes for DMs
 * Run this in Apps Script editor and check Execution Log
 */
function testSlackDMScopes() {
  try {
    var props = PropertiesService.getScriptProperties();
    var botToken = props.getProperty('SLACK_BOT_TOKEN');
    var userToken = props.getProperty('SLACK_USER_TOKEN');
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('🔍 Testing Slack Token Scopes for DMs');
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('');
    
    if (userToken) {
      Logger.log('📋 Testing SLACK_USER_TOKEN (xoxp-...)');
      testTokenScopes(userToken, 'user');
      Logger.log('');
    }
    
    if (botToken) {
      Logger.log('📋 Testing SLACK_BOT_TOKEN (xoxb-...)');
      testTokenScopes(botToken, 'bot');
      Logger.log('');
    }
    
    if (!userToken && !botToken) {
      Logger.log('❌ No Slack tokens found in Script Properties');
      Logger.log('Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN');
    }
    
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('✅ Required scopes for DMs:');
    Logger.log('   - im:write (REQUIRED - to open/send DMs)');
    Logger.log('   - chat:write (REQUIRED - to send messages)');
    Logger.log('   - users:read.email (OPTIONAL - for email lookup)');
    Logger.log('═══════════════════════════════════════════════════════');
    
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
  }
}

function testTokenScopes(token, tokenType) {
  try {
    // Test 1: Auth test (shows basic token info)
    var authUrl = 'https://slack.com/api/auth.test';
    var authResponse = UrlFetchApp.fetch(authUrl, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    if (authResponse.getResponseCode() !== 200) {
      Logger.log('❌ Auth test failed: HTTP ' + authResponse.getResponseCode());
      return;
    }
    
    var authData = JSON.parse(authResponse.getContentText());
    if (!authData.ok) {
      Logger.log('❌ Auth test failed: ' + authData.error);
      return;
    }
    
    Logger.log('✅ Token is valid');
    Logger.log('   User/Bot: ' + (authData.user || authData.bot_id || 'Unknown'));
    Logger.log('   Team: ' + (authData.team || 'Unknown'));
    
    // Test 2: Try to open a DM (this will show if im:write works)
    // We'll use your user ID as a test
    var testUserId = 'U086W2G9W3Z'; // Your Slack user ID
    var openUrl = 'https://slack.com/api/conversations.open';
    var openPayload = JSON.stringify({ users: testUserId });
    var openResponse = UrlFetchApp.fetch(openUrl, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: openPayload,
      muteHttpExceptions: true
    });
    
    if (openResponse.getResponseCode() !== 200) {
      Logger.log('❌ conversations.open failed: HTTP ' + openResponse.getResponseCode());
      return;
    }
    
    var openData = JSON.parse(openResponse.getContentText());
    if (openData.ok) {
      Logger.log('✅ im:write scope: WORKING');
      Logger.log('   Can open DMs: YES');
      if (openData.channel) {
        Logger.log('   Channel ID: ' + openData.channel.id);
      }
    } else {
      Logger.log('❌ im:write scope: MISSING');
      Logger.log('   Error: ' + openData.error);
      if (openData.needed) {
        Logger.log('   Needed scopes: ' + openData.needed.join(', '));
      }
      Logger.log('');
      Logger.log('⚠️  ACTION REQUIRED:');
      Logger.log('   1. Go to https://api.slack.com/apps');
      Logger.log('   2. Select your app → OAuth & Permissions');
      Logger.log('   3. Add "im:write" scope');
      Logger.log('   4. Click "Reinstall to Workspace"');
      Logger.log('   5. Copy the NEW token');
      Logger.log('   6. Update Script Properties with the new token');
    }
    
    // Test 3: Try email lookup (to check users:read.email)
    var lookupUrl = 'https://slack.com/api/users.lookupByEmail?email=mahdi.swaidan1@gmail.com';
    var lookupResponse = UrlFetchApp.fetch(lookupUrl, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    if (lookupResponse.getResponseCode() === 200) {
      var lookupData = JSON.parse(lookupResponse.getContentText());
      if (lookupData.ok) {
        Logger.log('✅ users:read.email scope: WORKING');
        Logger.log('   Can lookup by email: YES');
      } else {
        Logger.log('⚠️  users:read.email scope: ' + (lookupData.error === 'missing_scope' ? 'MISSING' : lookupData.error));
      }
    }
    
  } catch (error) {
    Logger.log('❌ Error testing token: ' + error.toString());
  }
}

/**
 * Helper function to get all Slack user IDs for operators
 * Run this function in Apps Script editor and check the Execution Log
 * Copy the Script Property entries and add them to Script Properties
 */
function getAllSlackUserIds() {
  try {
    // Get your Slack token
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('SLACK_USER_TOKEN') || props.getProperty('SLACK_BOT_TOKEN');
    
    if (!token) {
      Logger.log('❌ No Slack token found. Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN in Script Properties.');
      return;
    }
    
    Logger.log('🔍 Fetching all Slack users...');
    
    // Fetch all users from Slack workspace
    var url = 'https://slack.com/api/users.list';
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log('❌ Failed to fetch users: HTTP ' + response.getResponseCode());
      return;
    }
    
    var data = JSON.parse(response.getContentText());
    
    if (!data.ok) {
      Logger.log('❌ Slack API error: ' + data.error);
      return;
    }
    
    // Log all users with their emails and IDs
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('📋 SLACK USER IDs - Copy these to Script Properties');
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('');
    
    var usersWithEmail = [];
    data.members.forEach(function(member) {
      if (member.profile && member.profile.email && !member.deleted && !member.is_bot) {
        var email = member.profile.email;
        var userId = member.id;
        var name = member.real_name || member.profile.display_name || member.name || 'Unknown';
        
        usersWithEmail.push({
          name: name,
          email: email,
          userId: userId
        });
      }
    });
    
    // Sort by name
    usersWithEmail.sort(function(a, b) {
      return a.name.localeCompare(b.name);
    });
    
    Logger.log('Format: Property Name = Slack User ID');
    Logger.log('');
    
    usersWithEmail.forEach(function(user) {
      var propKey = 'SLACK_USER_ID_' + user.email.replace(/[@.]/g, '_');
      Logger.log(propKey + ' = ' + user.userId + '  // ' + user.name + ' (' + user.email + ')');
    });
    
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════');
    Logger.log('✅ Found ' + usersWithEmail.length + ' users with email addresses');
    Logger.log('📝 Copy the lines above and add them to Script Properties');
    Logger.log('═══════════════════════════════════════════════════════');
    
    return usersWithEmail;
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
    return null;
  }
}
