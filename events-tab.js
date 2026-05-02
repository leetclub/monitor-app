

function shouldCacheResults(filters) {
  // Don't cache very large date ranges
  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Only cache date ranges up to 7 days
    if (diffDays > 7) {
      console.log(`⚠️ Not caching ${diffDays} day range (too long)`);
      return false;
    }
  }
  
  return true;
}
 



 // events-tab.gs - FIX CACHE RETRIEVAL
function fetchEvents(filters = {}) {
  // Extract pagination parameters
  const clientLimit = filters.limit || 100;
  const clientOffset = filters.offset || 0;
  
  // Remove pagination from cache key (so we cache the full dataset)
  const cacheFilters = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    machineId: filters.machineId,
    eventName: filters.eventName
  };
  
  // Check cache for the FULL dataset (without pagination)
  const cachedResult = getFilteredEventsCache(cacheFilters);
  if (cachedResult) {
    console.log("✅ Using cached events data for pagination");
    console.log(`📊 Cache contains ${cachedResult.events ? cachedResult.events.length : 'no'} events`);
    return applyPagination(cachedResult, { limit: clientLimit, offset: clientOffset });
  } else {
    console.log("🔄 No cache found, fetching from API");
  }
  
  try {
    function isExcludedEvent(e) {
      if (EXCLUDED_EVENT_NAMES.includes(e.name)) return true;
      if (EXCLUDED_EVENT_NAMES.includes(e.base_code)) return true;
      let dur = e.duration;
      if (!dur && e.received_at && e.resolved_at) {
        dur = e.resolved_at - e.received_at;
      }
      return dur && dur <= 600;
    }

    const baseParams = {};
    if (filters.startDate)
      baseParams.from_timestamp = Math.floor(new Date(filters.startDate+"T00:00:00").getTime()/1000);
    if (filters.endDate)
      baseParams.to_timestamp = Math.floor(new Date(filters.endDate+"T23:59:59").getTime()/1000);
    if (filters.machineId)
      baseParams.machine_id = filters.machineId;

    const pageLimit = 500;
    let offset = 0;
    const allEvents = [];

    console.log(`📅 Fetching events from ${filters.startDate} to ${filters.endDate}`);

    while (true) {
      const params = { ...baseParams, limit: pageLimit, offset };
      const query = Object.keys(params).map(k => `${k}=${params[k]}`).join("&");
      const url = `${API_BASE}/event?${query}`;
      const res = UrlFetchApp.fetch(url, { 
        headers: { Authorization: "Token "+API_KEY } 
      });

      if (res.getResponseCode() !== 200) {
        return { events: [], totalCount: 0, error: "API error " + res.getResponseCode() };
      }

      const json = JSON.parse(res.getContentText());
      const pageResults = Array.isArray(json.result) ? json.result : [];
      allEvents.push(...pageResults);

      if (json.paging && allEvents.length >= json.paging.total) break;
      if (pageResults.length < pageLimit) break;
      offset += pageLimit;
      
      // Safety limit - don't fetch more than 5000 events
      if (allEvents.length >= 5000) {
        console.log("⚠️ Reached safety limit of 5000 events");
        break;
      }
    }

    let filtered = allEvents.filter(e => !isExcludedEvent(e));
    
    // Apply event name filtering if specified
    if (filters.eventName && filters.eventName !== "") {
      console.log(`🔍 Filtering events by: "${filters.eventName}"`);
      
      const eventNamesData = fetchEventNames();
      const selectedEvent = eventNamesData.find(e => e.id === filters.eventName);
      
      if (selectedEvent && selectedEvent.base_codes) {
        console.log(`   Looking for base_codes: ${selectedEvent.base_codes.join(', ')}`);
        
        filtered = filtered.filter(e => selectedEvent.base_codes.includes(e.name));
        console.log(`   Found ${filtered.length} events after filtering`);
      }
    }

    // Apply mapping for display
    const mapped = filtered.map(e => {
      const friendly = EVENT_NAME_MAPPING[e.name] || EVENT_NAME_MAPPING[e.base_code] || e.name;
      return { 
        ...e, 
        display_name: friendly || "Unknown Event",
        original_name: e.name,
        original_base_code: e.base_code
      };
    });

    // Cache the FULL dataset (without pagination)
    const fullResults = {
      events: mapped,
      totalCount: mapped.length,
      timestamp: new Date().getTime()
    };
    
    // Only cache if results aren't too large
    if (mapped.length <= 2000) {
      setFilteredEventsCache(cacheFilters, fullResults);
      console.log(`✅ Cached ${mapped.length} events for pagination`);
    } else {
      console.log(`⚠️ Not caching ${mapped.length} events (too many for cache)`);
    }

    // Apply pagination to the full dataset
    return applyPagination(fullResults, { limit: clientLimit, offset: clientOffset });

  } catch (err) {
    console.error("Error in fetchEvents:", err);
    return { events: [], totalCount: 0, error: err.message };
  }
}

function applyPagination(fullResults, pagination) {
  const clientLimit = pagination.limit || 100;
  const clientOffset = pagination.offset || 0;
  
  const paginatedEvents = fullResults.events.slice(clientOffset, clientOffset + clientLimit);
  
  const source = fullResults.timestamp ? 'CACHE' : 'API';
  console.log(`📄 Pagination: Showing ${paginatedEvents.length} events (offset: ${clientOffset}, limit: ${clientLimit}) from ${fullResults.totalCount} total - USING ${source}`);
  
  return {
    events: paginatedEvents,
    totalCount: fullResults.totalCount
  };
}

function debugCacheForFilters(filters) {
  const cacheFilters = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    machineId: filters.machineId,
    eventName: filters.eventName
  };
  
  const cacheKey = generateFilterCacheKey(cacheFilters);
  const cached = getFilteredEventsCache(cacheFilters);
  
  console.log(`🔍 CACHE DEBUG for key: ${cacheKey}`);
  console.log(`   - Has cache: ${!!cached}`);
  console.log(`   - Events in cache: ${cached ? cached.events.length : 0}`);
  console.log(`   - Requested page: ${filters.offset / (filters.limit || 100) + 1}`);
  
  return {
    cacheKey: cacheKey,
    hasCache: !!cached,
    eventCount: cached ? cached.events.length : 0,
    cacheExists: !!cached
  };
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
    console.log(`🔍 BACKEND: Retrieving progress for key: ${progressKey}`);
    
    const progressCache = CacheService.getScriptCache();
    const cached = progressCache.get(progressKey);
    
    console.log(`🔍 BACKEND: Cache result for key ${progressKey}:`, cached ? 'FOUND' : 'NOT FOUND');
    
    if (cached) {
      const progressData = JSON.parse(cached);
      console.log(`✅ BACKEND: Progress retrieved: ${progressData.percent}% - ${progressData.message}`);
      return progressData;
    } else {
      console.log("❌ BACKEND: No progress found for key:", progressKey);
      return { percent: 0, message: "No progress data found", processed: 0, total: 0 };
    }
  } catch (error) {
    console.error("❌ BACKEND: Error getting progress:", error);
    return { percent: 0, message: "Error getting progress: " + error.message, processed: 0, total: 0 };
  }
}

function fetchEventsWithProgress(filters = {}) {
  console.log("🔄 BACKEND: STARTING EVENTS LOADING WITH PROGRESS");
  console.log("📋 BACKEND: Filters received:", filters);
  
  // Use the progress key from frontend, or create a fallback
  const progressKey = filters.progressKey || 'events_progress_' + new Date().getTime();
  
  console.log("🔑 BACKEND: Using progress key:", progressKey);
  
  try {
    // Update progress immediately
    console.log("📊 Setting initial progress...");
    updateProgress(progressKey, 5, "Starting events loading...");
    
    // Extract pagination parameters
    const clientLimit = filters.limit || 100;
    const clientOffset = filters.offset || 0;
    
    // Remove pagination from cache key (so we cache the full dataset)
    const cacheFilters = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      machineId: filters.machineId,
      eventName: filters.eventName
    };
    
    // Check cache for the FULL dataset (without pagination)
    updateProgress(progressKey, 10, "Checking cache...");
    const cachedResult = getFilteredEventsCache(cacheFilters);
    if (cachedResult) {
      console.log("✅ Using cached events data for pagination");
      console.log(`📊 Cache contains ${cachedResult.events ? cachedResult.events.length : 'no'} events`);
      updateProgress(progressKey, 100, "✅ Complete! Using cached data");
      return applyPagination(cachedResult, { limit: clientLimit, offset: clientOffset });
    } else {
      console.log("🔄 No cache found, fetching from API");
    }
    
    updateProgress(progressKey, 15, "Fetching events from API...");
    
    function isExcludedEvent(e) {
      if (EXCLUDED_EVENT_NAMES.includes(e.name)) return true;
      if (EXCLUDED_EVENT_NAMES.includes(e.base_code)) return true;
      let dur = e.duration;
      if (!dur && e.received_at && e.resolved_at) {
        dur = e.resolved_at - e.received_at;
      }
      return dur && dur <= 600;
    }

    const baseParams = {};
    if (filters.startDate)
      baseParams.from_timestamp = Math.floor(new Date(filters.startDate+"T00:00:00").getTime()/1000);
    if (filters.endDate)
      baseParams.to_timestamp = Math.floor(new Date(filters.endDate+"T23:59:59").getTime()/1000);
    if (filters.machineId)
      baseParams.machine_id = filters.machineId;

    const pageLimit = 500;
    let offset = 0;
    const allEvents = [];

    console.log(`📅 Fetching events from ${filters.startDate} to ${filters.endDate}`);

    updateProgress(progressKey, 20, "Fetching events from API...");

    while (true) {
      const params = { ...baseParams, limit: pageLimit, offset };
      const query = Object.keys(params).map(k => `${k}=${params[k]}`).join("&");
      const url = `${API_BASE}/event?${query}`;
      
      const progressPercent = 20 + Math.floor((offset / 5000) * 60); // Assume max 5000 events
      updateProgress(progressKey, progressPercent, `Fetching page ${Math.floor(offset/pageLimit) + 1}...`);
      
      const res = UrlFetchApp.fetch(url, { 
        headers: { Authorization: "Token "+API_KEY } 
      });

      if (res.getResponseCode() !== 200) {
        updateProgress(progressKey, 0, `❌ API error ${res.getResponseCode()}`);
        return { events: [], totalCount: 0, error: "API error " + res.getResponseCode() };
      }

      const json = JSON.parse(res.getContentText());
      const pageResults = Array.isArray(json.result) ? json.result : [];
      allEvents.push(...pageResults);

      if (json.paging && allEvents.length >= json.paging.total) break;
      if (pageResults.length < pageLimit) break;
      offset += pageLimit;
      
      // Safety limit - don't fetch more than 5000 events
      if (allEvents.length >= 5000) {
        console.log("⚠️ Reached safety limit of 5000 events");
        break;
      }
    }

    updateProgress(progressKey, 85, "Filtering events...");
    let filtered = allEvents.filter(e => !isExcludedEvent(e));
    
    // Apply event name filtering if specified
    if (filters.eventName && filters.eventName !== "") {
      console.log(`🔍 Filtering events by: "${filters.eventName}"`);
      
      const eventNamesData = fetchEventNames();
      const selectedEvent = eventNamesData.find(e => e.id === filters.eventName);
      
      if (selectedEvent && selectedEvent.base_codes) {
        console.log(`   Looking for base_codes: ${selectedEvent.base_codes.join(', ')}`);
        
        filtered = filtered.filter(e => selectedEvent.base_codes.includes(e.name));
        console.log(`   Found ${filtered.length} events after filtering`);
      }
    }

    updateProgress(progressKey, 90, "Mapping event names...");
    // Apply mapping for display
    const mapped = filtered.map(e => {
      const friendly = EVENT_NAME_MAPPING[e.name] || EVENT_NAME_MAPPING[e.base_code] || e.name;
      return { 
        ...e, 
        display_name: friendly || "Unknown Event",
        original_name: e.name,
        original_base_code: e.base_code
      };
    });

    // Cache the FULL dataset (without pagination)
    const fullResults = {
      events: mapped,
      totalCount: mapped.length,
      timestamp: new Date().getTime()
    };
    
    // Only cache if results aren't too large
    if (mapped.length <= 2000) {
      setFilteredEventsCache(cacheFilters, fullResults);
      console.log(`✅ Cached ${mapped.length} events for pagination`);
    } else {
      console.log(`⚠️ Not caching ${mapped.length} events (too many for cache)`);
    }

    updateProgress(progressKey, 95, "Applying pagination...");
    // Apply pagination to the full dataset
    const result = applyPagination(fullResults, { limit: clientLimit, offset: clientOffset });
    
    updateProgress(progressKey, 100, "✅ Complete!");
    
    return result;

  } catch (err) {
    console.error("Error in fetchEventsWithProgress:", err);
    updateProgress(progressKey, 0, `❌ Error: ${err.message}`);
    return { events: [], totalCount: 0, error: err.message };
  }
}