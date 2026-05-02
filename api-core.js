function fetchMachines() {
   const cacheKey = "machines_cache";
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
   
  try {
    const res = UrlFetchApp.fetch(`${API_BASE}/machine`, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error("Failed to fetch machines:", res.getContentText());
      return [];
    }
    
    const json = JSON.parse(res.getContentText());
    const machines = json.result ? json.result.map(m => ({ id: m.id, name: m.name })) : [];
    
    // Sort machines alphabetically by name
    machines.sort((a, b) => a.name.localeCompare(b.name));
    
    setCachedData(cacheKey, machines, 24 * 60 * 60); // 24 hours in seconds
    return machines;
  } catch (error) {
    console.error("Error fetching machines:", error);
    return [];
  }
}

// Force deployment update - HTML changes require .gs file modification
// Added unified loading modal debugging


function fetchEventNames() {
  const cacheKey = "event_names_unique_display";
  const cached = getCachedData(cacheKey);
  
  if (cached) {
    return cached;
  }
  
  console.log("🔄 Creating unique display names for dropdown...");
  
  // Create UNIQUE display names from EVENT_NAME_MAPPING values
  const uniqueDisplayNames = [...new Set(Object.values(EVENT_NAME_MAPPING))];
  
  // Convert to dropdown options
  const eventNames = uniqueDisplayNames.map(displayName => {
    // Find all base_codes that map to this display name
    const baseCodes = Object.entries(EVENT_NAME_MAPPING)
      .filter(([rawName, mappedName]) => mappedName === displayName)
      .map(([rawName]) => rawName);
    
    return {
      id: displayName, // Use display name as ID for the dropdown
      name: displayName,
      base_codes: baseCodes, // Array of all base_codes that map to this display
      display_name: displayName
    };
  });
  
  console.log(`✅ Created ${eventNames.length} unique display names`);
  eventNames.forEach(event => {
    console.log(`   - "${event.display_name}" maps to: ${event.base_codes.join(', ')}`);
  });
  
  setCachedData(cacheKey, eventNames, 24 * 60 * 60); // 24 hours in seconds
  return eventNames;
}





function fetchUsers() {
  try {
    const url = `${API_BASE}/user`;
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error("Failed to fetch users:", res.getContentText());
      return [];
    }
    
    const data = JSON.parse(res.getContentText());
    return data.result || [];
  } catch (error) {
    console.error("Error fetching users:", error);
    return [];
  }
}

function fetchUserDetails(userId) {
  try {
    const url = `${API_BASE}/user/${userId}`;
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error(`Failed to fetch user details for ID ${userId}:`, res.getContentText());
      return null;
    }
    
    const data = JSON.parse(res.getContentText());
    return data.result || null;
  } catch (error) {
    console.error(`Error fetching user details for ID ${userId}:`, error);
    return null;
  }
}

function fetchSalesReport(params) {
  try {
    // Use Vendon API directly (like waste-tab does with /stats/vends)
    // Convert date range to timestamps
    let fromTimestamp = null;
    let toTimestamp = null;
    
    // Convert dates to timestamps using Kuwait timezone (UTC+3) to match Vendon's daily boundaries
    // Vendon uses Kuwait local time for daily boundaries
    // For date "2026-01-16" in Kuwait: 00:00:00 Kuwait = 2026-01-15 21:00:00 UTC
    // So we create UTC date and subtract 3 hours to get the Kuwait local time timestamp
    if (params.dates) {
      // If dates is comma-separated, use first and last
      const dateArray = params.dates.split(',');
      if (dateArray.length > 0) {
        const startDateStr = dateArray[0];
        const endDateStr = dateArray[dateArray.length - 1];
        
        // Parse date parts
        const startParts = startDateStr.split('-');
        const endParts = endDateStr.split('-');
        
        // Create UTC dates, then adjust for Kuwait timezone (UTC+3)
        // Kuwait 2026-01-16 00:00:00 = UTC 2026-01-15 21:00:00
        const startUTC = new Date(Date.UTC(
          parseInt(startParts[0]),
          parseInt(startParts[1]) - 1,
          parseInt(startParts[2]),
          0, 0, 0, 0
        ));
        // Subtract 3 hours to convert UTC midnight to Kuwait midnight
        fromTimestamp = Math.floor((startUTC.getTime() / 1000) - (3 * 3600));
        
        // Check if the selected date is "today" in Kuwait timezone FIRST
        // Get current date in Kuwait (UTC+3)
        const now = new Date();
        const kuwaitOffsetMs = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
        const kuwaitNow = new Date(now.getTime() + kuwaitOffsetMs);
        const todayKuwaitStr = kuwaitNow.toISOString().split('T')[0];
        
        if (endDateStr === todayKuwaitStr) {
          // For today in Kuwait timezone, use current timestamp (not end of day)
          // This prevents including future vends that haven't happened yet
          // Current UTC time minus 3 hours = current Kuwait time
          const currentKuwaitTimestamp = Math.floor((now.getTime() / 1000) - (3 * 3600));
          
          // Also calculate end of day to ensure we don't exceed it
          const endUTC = new Date(Date.UTC(
            parseInt(endParts[0]),
            parseInt(endParts[1]) - 1,
            parseInt(endParts[2]),
            23, 59, 59, 999
          ));
          const endOfDayKuwaitTimestamp = Math.floor((endUTC.getTime() / 1000) - (3 * 3600));
          
          // Use the earlier of: current time or end of day (safety check)
          toTimestamp = Math.min(currentKuwaitTimestamp, endOfDayKuwaitTimestamp);
          console.log('Today query (dates param) - using current Kuwait timestamp:', toTimestamp);
          console.log('  Selected date:', endDateStr, 'Today Kuwait:', todayKuwaitStr);
          console.log('  Current UTC:', now.toISOString());
          console.log('  Current Kuwait:', kuwaitNow.toISOString());
          console.log('  Current timestamp:', currentKuwaitTimestamp, 'End of day:', endOfDayKuwaitTimestamp);
          console.log('  Using:', toTimestamp, '=', new Date((toTimestamp + 3 * 3600) * 1000).toISOString(), 'Kuwait time');
        } else {
          // For past dates, use end of day in Kuwait timezone
          const endUTC = new Date(Date.UTC(
            parseInt(endParts[0]),
            parseInt(endParts[1]) - 1,
            parseInt(endParts[2]),
            23, 59, 59, 999
          ));
          // Subtract 3 hours to convert UTC end-of-day to Kuwait end-of-day
          // Kuwait 2026-01-22 23:59:59.999 = UTC 2026-01-22 20:59:59.999
          toTimestamp = Math.floor((endUTC.getTime() / 1000) - (3 * 3600));
          console.log('Past date query (dates param) - using end of day Kuwait timestamp:', toTimestamp);
          console.log('  Selected date:', endDateStr, 'Today Kuwait:', todayKuwaitStr);
        }
      }
    } else if (params.from_date && params.to_date) {
      const startParts = params.from_date.split('-');
      const endParts = params.to_date.split('-');
      
      // Create UTC dates, then adjust for Kuwait timezone (UTC+3)
      const startUTC = new Date(Date.UTC(
        parseInt(startParts[0]),
        parseInt(startParts[1]) - 1,
        parseInt(startParts[2]),
        0, 0, 0, 0
      ));
      fromTimestamp = Math.floor((startUTC.getTime() / 1000) - (3 * 3600));
      
      // Check if the selected date is "today" in Kuwait timezone FIRST
      // Get current date in Kuwait (UTC+3)
      const now = new Date();
      const kuwaitOffsetMs = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
      const kuwaitNow = new Date(now.getTime() + kuwaitOffsetMs);
      const todayKuwaitStr = kuwaitNow.toISOString().split('T')[0];
      const selectedDateStr = params.to_date;
      
      if (selectedDateStr === todayKuwaitStr) {
        // For today in Kuwait timezone, use current timestamp (not end of day)
        // This prevents including future vends that haven't happened yet
        // Current UTC time minus 3 hours = current Kuwait time
        const currentKuwaitTimestamp = Math.floor((now.getTime() / 1000) - (3 * 3600));
        
        // Also calculate end of day to ensure we don't exceed it
        const endUTC = new Date(Date.UTC(
          parseInt(endParts[0]),
          parseInt(endParts[1]) - 1,
          parseInt(endParts[2]),
          23, 59, 59, 999
        ));
        const endOfDayKuwaitTimestamp = Math.floor((endUTC.getTime() / 1000) - (3 * 3600));
        
        // Use the earlier of: current time or end of day (safety check)
        toTimestamp = Math.min(currentKuwaitTimestamp, endOfDayKuwaitTimestamp);
        console.log('Today query - using current Kuwait timestamp:', toTimestamp);
        console.log('  Selected date:', selectedDateStr, 'Today Kuwait:', todayKuwaitStr);
        console.log('  Current UTC:', now.toISOString());
        console.log('  Current Kuwait:', kuwaitNow.toISOString());
        console.log('  Current timestamp:', currentKuwaitTimestamp, 'End of day:', endOfDayKuwaitTimestamp);
        console.log('  Using:', toTimestamp, '=', new Date((toTimestamp + 3 * 3600) * 1000).toISOString(), 'Kuwait time');
      } else {
        // For past dates, use end of day in Kuwait timezone
        const endUTC = new Date(Date.UTC(
          parseInt(endParts[0]),
          parseInt(endParts[1]) - 1,
          parseInt(endParts[2]),
          23, 59, 59, 999
        ));
        // Subtract 3 hours to convert UTC end-of-day to Kuwait end-of-day
        // Kuwait 2026-01-22 23:59:59.999 = UTC 2026-01-22 20:59:59.999
        toTimestamp = Math.floor((endUTC.getTime() / 1000) - (3 * 3600));
        console.log('Past date query - using end of day Kuwait timestamp:', toTimestamp);
        console.log('  Selected date:', selectedDateStr, 'Today Kuwait:', todayKuwaitStr);
      }
    }
    
    if (!fromTimestamp || !toTimestamp) {
      return {
        success: false,
        error: "Date range is required"
      };
    }
    
    // Ensure toTimestamp doesn't exceed fromTimestamp + 1 day (safety check)
    // This prevents including vends from the next day
    const maxAllowedTimestamp = fromTimestamp + (24 * 60 * 60) - 1; // 1 day in seconds, minus 1 second
    if (toTimestamp > maxAllowedTimestamp) {
      console.warn('⚠️ toTimestamp exceeds max allowed, capping at end of selected date');
      toTimestamp = maxAllowedTimestamp;
    }
    
    console.log('Final timestamp range:', fromTimestamp, 'to', toTimestamp);
    console.log('  From (Kuwait):', new Date((fromTimestamp + 3 * 3600) * 1000).toISOString());
    console.log('  To (Kuwait):', new Date((toTimestamp + 3 * 3600) * 1000).toISOString());
    
    // Handle multiple machines - Vendon API only accepts single machine_id
    // So we need to make separate calls for each machine and combine results
    let allVends = [];
    const machineIds = params.machine_ids ? params.machine_ids.split(',').map(id => id.trim()) : [];
    
    if (machineIds.length > 0) {
      // Fetch vends for each machine separately
      console.log(`Fetching vends for ${machineIds.length} machine(s):`, machineIds);
      
      for (let i = 0; i < machineIds.length; i++) {
        const machineId = machineIds[i];
        let machineVends = [];
        let offset = 0;
        const limit = 10000;
        let hasMore = true;
        let iteration = 0;
        const maxIterations = 100; // Safety limit
        
        // Fetch all vends for this machine with pagination
        while (hasMore && iteration < maxIterations) {
          iteration++;
          
          // Build query params for this machine
          const queryParams = [];
          queryParams.push(`from_timestamp=${fromTimestamp}`);
          queryParams.push(`to_timestamp=${toTimestamp}`);
          queryParams.push(`machine_id=${encodeURIComponent(machineId)}`);
          queryParams.push(`limit=${limit}`);
          queryParams.push(`offset=${offset}`);
          
          const url = `${API_BASE}/stats/vends?${queryParams.join('&')}`;
          if (iteration === 1) {
            console.log(`Fetching vends for machine ${machineId} (${i + 1}/${machineIds.length}):`, url);
          }
          
          const res = UrlFetchApp.fetch(url, {
            method: "get",
            headers: { 
              "Authorization": "Token " + API_KEY,
              "Accept": "application/json" 
            },
            muteHttpExceptions: true
          });
          
          const responseCode = res.getResponseCode();
          if (responseCode !== 200) {
            const errorText = res.getContentText();
            console.error(`Failed to fetch vends for machine ${machineId}. Status:`, responseCode, "Response:", errorText.substring(0, 500));
            
            // Continue with other machines even if one fails
            hasMore = false;
            break;
          }
          
          const json = JSON.parse(res.getContentText());
          if (json.code === 200 && json.result) {
            machineVends = machineVends.concat(json.result);
            
            // Check if there are more results
            if (json.result.length < limit) {
              hasMore = false;
            } else {
              offset += limit;
              // Small delay to avoid rate limiting
              Utilities.sleep(200);
            }
          } else {
            console.warn(`⚠️ Machine ${machineId} returned code ${json.code || responseCode}`);
            hasMore = false;
          }
        }
        
        if (iteration >= maxIterations) {
          console.warn(`⚠️ Reached max iterations for machine ${machineId}, may have more data`);
        }
        
        allVends = allVends.concat(machineVends);
        console.log(`✅ Fetched ${machineVends.length} total vends for machine ${machineId}`);
        
        // Small delay between machines to avoid rate limiting
        if (i < machineIds.length - 1) {
          Utilities.sleep(200);
        }
      }
    } else {
      // No machine filter - fetch all machines with pagination
      let offset = 0;
      const limit = 10000;
      let hasMore = true;
      let iteration = 0;
      const maxIterations = 100; // Safety limit
      
      while (hasMore && iteration < maxIterations) {
        iteration++;
        
        const queryParams = [];
        queryParams.push(`from_timestamp=${fromTimestamp}`);
        queryParams.push(`to_timestamp=${toTimestamp}`);
        queryParams.push(`limit=${limit}`);
        queryParams.push(`offset=${offset}`);
        
        const url = `${API_BASE}/stats/vends?${queryParams.join('&')}`;
        if (iteration === 1) {
          console.log('Fetching sales report from Vendon API (all machines):', url);
        }
        
        const res = UrlFetchApp.fetch(url, {
          method: "get",
          headers: { 
            "Authorization": "Token " + API_KEY,
            "Accept": "application/json" 
          },
          muteHttpExceptions: true
        });
        
        const responseCode = res.getResponseCode();
        if (responseCode !== 200) {
          const errorText = res.getContentText();
          console.error("Failed to fetch sales report. Status:", responseCode, "Response:", errorText.substring(0, 500));
          
          // Provide more helpful error messages
          let errorMsg = "Failed to fetch sales report: HTTP " + responseCode;
          if (responseCode === 404) {
            errorMsg = "Vendon API endpoint not found (404). Please check if the API endpoint /stats/vends is available.";
          } else if (responseCode === 401) {
            errorMsg = "Authentication failed (401). Please check your API credentials.";
          } else if (responseCode === 403) {
            errorMsg = "Access forbidden (403). Please check your API permissions.";
          } else if (errorText) {
            errorMsg += " - " + errorText.substring(0, 200);
          }
          
          return {
            success: false,
            error: errorMsg
          };
        }
        
        const json = JSON.parse(res.getContentText());
        if (json.code === 200 && json.result) {
          allVends = allVends.concat(json.result);
          
          // Check if there are more results
          if (json.result.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
            // Small delay to avoid rate limiting
            Utilities.sleep(200);
          }
        } else {
          console.error("API returned error code:", json.code || responseCode);
          return {
            success: false,
            error: "API error: " + (json.message || "Unknown error")
          };
        }
      }
      
      if (iteration >= maxIterations) {
        console.warn("⚠️ Reached max iterations, may have more data");
      }
    }
    
    console.log(`✅ Total vends collected: ${allVends.length} from ${machineIds.length || 'all'} machine(s)`);
    
    // Apply product filter if specified
    let filteredVends = allVends;
    if (params.products) {
      const productFilter = params.products.split(',').map(p => p.trim().toLowerCase());
      filteredVends = allVends.filter(vend => {
        const product = (vend.name || vend.product_name || vend.product || vend.stock_name || '').toLowerCase();
        return productFilter.includes(product);
      });
      console.log(`Filtered to ${filteredVends.length} vends matching products:`, params.products);
    }
    
    const vends = filteredVends;
    
    // Aggregate vends by product
    const productMap = {};
    const productSet = new Set();
    
    vends.forEach(vend => {
      // Vendon API uses 'name' field for product name (confirmed in analytics-tab.js and vendon-sync/api_service.py)
      const product = vend.name || vend.product_name || vend.product || vend.stock_name || 'Unknown';
      // Article can be in article, product_id, selection, or id fields
      const article = vend.article || vend.product_id || vend.selection || String(vend.id || '') || '-';
      const quantity = parseFloat(vend.quantity || 1);
      const vatPercent = parseFloat(vend.vat || 0);
      const withVat = parseFloat(vend.price || 0) * quantity;
      
      productSet.add(product);
      
      const key = `${product}|||${article}`;
      if (!productMap[key]) {
        productMap[key] = {
          product: product,
          article: article,
          quantity: 0,
          vatPercent: vatPercent,
          withVat: 0
        };
      }
      
      productMap[key].quantity += quantity;
      productMap[key].withVat += withVat;
    });
    
    // Convert to array
    const summary = Object.values(productMap);
    
    return {
      success: true,
      summary: summary,
      availableProducts: Array.from(productSet).sort()
    };
  } catch (error) {
    console.error("Error fetching sales report:", error);
    return {
      success: false,
      error: error.message || "Unknown error"
    };
  }
}

function fetchProductsAndTags() {
  try {
    // Fetch products from Vendon stock API
    const url = `${API_BASE}/stock`;
    console.log('Fetching products from Vendon API:', url);
    
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { 
        "Authorization": "Token " + API_KEY,
        "Accept": "application/json" 
      },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error("Failed to fetch products:", res.getContentText());
      return {
        success: false,
        products: [],
        tags: []
      };
    }
    
    const json = JSON.parse(res.getContentText());
    const stockItems = json.result || [];
    
    // Extract unique product names
    const productSet = new Set();
    stockItems.forEach(item => {
      if (item.name) {
        productSet.add(item.name);
      }
    });
    
    const products = Array.from(productSet).sort();
    
    console.log('✅ Fetched', products.length, 'products from Vendon stock API');
    
    return {
      success: true,
      products: products,
      tags: [] // Tags not available from stock API
    };
  } catch (error) {
    console.error("Error fetching products:", error);
    return {
      success: false,
      products: [],
      tags: []
    };
  }
}

function fixEventFiltering() {
  console.log("=== FIXING EVENT FILTERING ===");
  
  // Clear ALL event name caches
  clearCache("event_names_unique_display");
  clearCache("event_names_mapped");
  clearCache("event_names_cache");
  clearCache("event_names_final");
  clearCache("event_names_clean");
  
  console.log("✅ Cleared all event name caches");
  
  // Test the updated mapping
  const dropdownOptions = fetchEventNames();
  console.log("Updated dropdown options:");
  dropdownOptions.forEach(opt => {
    if (opt.display_name === "REFILL") {
      console.log(`   REFILL now maps to: [${opt.base_codes.join(', ')}]`);
    }
  });
  
  // Test filtering again
  const testFilters = {
    startDate: "2025-10-05",
    endDate: "2025-10-05", 
    eventName: "REFILL"
  };
  
  console.log(`\nTesting REFILL filter with updated mapping...`);
  const result = fetchEvents(testFilters);
  console.log(`✅ Found ${result.events.length} REFILL events`);
  
  return result;
}

// Add to api-core.gs
function getFilteredEventsCache(filters) {
  const cacheKey = generateFilterCacheKey(filters);
  
  // Try regular cache first
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  
  // Try chunked cache
  return getChunkedCacheData(cacheKey);
}

function setFilteredEventsCache(filters, data, duration = 300) {
  const cacheKey = generateFilterCacheKey(filters);
  setCachedData(cacheKey, data, duration);
}

function generateFilterCacheKey(filters) {
  const keyParts = [
    'filtered_events',
    filters.startDate || 'no_start',
    filters.endDate || 'no_end', 
    filters.machineId || 'all_machines',
    filters.eventName || 'all_events'
  ];
  return keyParts.join('_');
}

/**
 * Fetch order ratings from the external API
 * @param {Object} params - Query parameters: page, limit, min_rating, machine_id
 * @returns {Object} Response with data and pagination
 */
function fetchOrderRatings(params) {
  try {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const minRating = params.min_rating || null;
    const machineId = params.machine_id || null;
    
    let url = `${ORDER_RATINGS_API_BASE}/order-ratings?page=${page}&limit=${limit}`;
    
    if (minRating !== null && minRating !== undefined) {
      url += `&min_rating=${minRating}`;
    }
    
    if (machineId) {
      url += `&machine_id=${machineId}`;
    }
    
    console.log('Fetching order ratings from:', url);
    
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${ORDER_RATINGS_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      console.error('Failed to fetch order ratings:', responseText);
      return {
        success: false,
        error: `API error ${responseCode}: ${responseText}`,
        data: [],
        pagination: null
      };
    }
    
    const data = JSON.parse(responseText);
    
    if (data.status !== 'success') {
      console.error('API returned non-success status:', data);
      return {
        success: false,
        error: data.message || 'Unknown error',
        data: [],
        pagination: null
      };
    }
    
    return {
      success: true,
      data: data.data || [],
      pagination: data.pagination || null
    };
    
  } catch (error) {
    console.error('Error fetching order ratings:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
      data: [],
      pagination: null
    };
  }
}

function fetchInstagramAccounts() {
  try {
    const apiBase = 'https://subapi.theleetclub.com';
    const apiKey = 'aea311e286dc84f4a93c7d9f947cca14d47294f0e1ed3f45efc52a4d7244b6df';
    
    const url = `${apiBase}/api/external/instagram-accounts`;
    console.log('Fetching Instagram accounts from:', url);
    
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { 
        "X-API-Key": apiKey,
        "Accept": "application/json" 
      },
      muteHttpExceptions: true
    });
    
    const responseCode = res.getResponseCode();
    const responseText = res.getContentText();
    
    if (responseCode !== 200) {
      console.error("Failed to fetch Instagram accounts:", responseCode, responseText);
      return {
        status: 'error',
        error: "Failed to fetch accounts: HTTP " + responseCode
      };
    }
    
    const data = JSON.parse(responseText);
    console.log('Parsed Instagram accounts data:', data);
    console.log('Data type:', typeof data);
    console.log('Data keys:', data ? Object.keys(data) : 'null');
    console.log('Full response text (first 500 chars):', responseText.substring(0, 500));
    
    // Ensure we return the data in the expected format
    if (data && data.status === 'success' && Array.isArray(data.data)) {
      console.log('Returning data with status success, data array length:', data.data.length);
      console.log('First few accounts:', data.data.slice(0, 3));
      return data;
    } else if (data && Array.isArray(data.data) && data.data.length > 0) {
      console.log('Returning data.data array, length:', data.data.length);
      console.log('First few accounts:', data.data.slice(0, 3));
      return {
        status: 'success',
        data: data.data,
        total: data.data.length
      };
    } else if (Array.isArray(data)) {
      // If API returns array directly, wrap it
      console.log('Returning direct array, length:', data.length);
      console.log('First few accounts:', data.slice(0, 3));
      return {
        status: 'success',
        data: data,
        total: data.length
      };
    } else {
      console.error('Unexpected response format. Full data:', JSON.stringify(data));
      return {
        status: 'error',
        error: 'Unexpected response format',
        data: []
      };
    }
  } catch (error) {
    console.error("Error fetching Instagram accounts:", error);
    return {
      status: 'error',
      error: error.message || "Unknown error",
      data: []
    };
  }
}

function fetchInstagramPosts(page, limit, accountName) {
  try {
    const apiBase = 'https://subapi.theleetclub.com';
    const apiKey = 'aea311e286dc84f4a93c7d9f947cca14d47294f0e1ed3f45efc52a4d7244b6df';
    
    let url = `${apiBase}/api/external/instagram-posts?page=${page}&limit=${limit}`;
    
    // Only add account_name if a specific account is selected (not "All")
    if (accountName && accountName.trim() !== '') {
      url += `&account_name=${encodeURIComponent(accountName)}`;
    }
    
    console.log('Fetching Instagram posts from:', url);
    
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { 
        "X-API-Key": apiKey,
        "Accept": "application/json" 
      },
      muteHttpExceptions: true
    });
    
    const responseCode = res.getResponseCode();
    const responseText = res.getContentText();
    
    if (responseCode !== 200) {
      console.error("Failed to fetch Instagram posts:", responseCode, responseText);
      return {
        status: 'error',
        error: "Failed to fetch posts: HTTP " + responseCode + " - " + responseText.substring(0, 200)
      };
    }
    
    const data = JSON.parse(responseText);
    return data;
  } catch (error) {
    console.error("Error fetching Instagram posts:", error);
    return {
      status: 'error',
      error: error.message || "Unknown error"
    };
  }
}

function fetchInstagramImage(imageUrl) {
  // Proxy function to fetch Instagram images through backend to avoid CORS
  try {
    if (!imageUrl) {
      return { success: false, error: 'No image URL provided' };
    }
    
    // Try to decode proxy URL if it's a pixnoy proxy
    let actualUrl = imageUrl;
    if (imageUrl.includes('sp1.pixnoy.com') && imageUrl.includes('?o=')) {
      try {
        const urlParts = imageUrl.split('?');
        if (urlParts.length > 1) {
          const queryString = urlParts[1];
          const params = {};
          queryString.split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key === 'o' && value) {
              try {
                // Decode base64 URL
                const decodedBytes = Utilities.base64Decode(value);
                const decodedStr = Utilities.newBlob(decodedBytes).getDataAsString();
                if (decodedStr && decodedStr.startsWith('http')) {
                  actualUrl = decodedStr;
                }
              } catch (e) {
                console.warn('Could not decode base64:', e);
              }
            }
          });
        }
      } catch (e) {
        console.warn('Could not parse proxy URL:', e);
      }
    }
    
    console.log('Fetching image from:', actualUrl);
    
    // Fetch image
    const res = UrlFetchApp.fetch(actualUrl, {
      method: "get",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/*",
        "Referer": "https://www.instagram.com/"
      },
      muteHttpExceptions: true
    });
    
    const responseCode = res.getResponseCode();
    if (responseCode === 200) {
      const blob = res.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      const contentType = blob.getContentType() || 'image/jpeg';
      const dataUrl = `data:${contentType};base64,${base64}`;
      return {
        success: true,
        dataUrl: dataUrl
      };
    }
    
    console.error('Failed to fetch image:', responseCode, res.getContentText().substring(0, 200));
    return {
      success: false,
      error: 'Failed to fetch image: HTTP ' + responseCode
    };
  } catch (error) {
    console.error("Error fetching image:", error);
    return {
      success: false,
      error: error.message || "Unknown error"
    };
  }
}
