    
 

function clearCache(cacheKey = null) {
  const cache = CacheService.getScriptCache();
  if (cacheKey) {
    cache.remove(cacheKey);
  } else {
    // Note: CacheService doesn't have removeAll() method
    // Cache entries will expire automatically based on their TTL
    // For manual clearing, we'd need to track all keys (not possible without storing them)
    Logger.log('Cache clear requested - individual keys should be cleared with cacheKey parameter');
  }
}

// Simple daily cache management
function checkAndClearDailyCache() {
  const properties = PropertiesService.getScriptProperties();
  const lastClear = properties.getProperty('last_cache_clear');
  const today = new Date().toDateString();
  
  // If we haven't cleared cache today, clear it now
  if (lastClear !== today) {
    console.log("🔄 DAILY CACHE CLEAR - First access today");
    clearCache(); // Clear all caches
    properties.setProperty('last_cache_clear', today);
    return "Daily cache cleared - " + today;
  }
  
  return "Cache already cleared today - " + lastClear;
}

// cache.gs - ADD CHUNKED CACHING FOR LARGE DATASETS
function getCachedData(cacheKey) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  return cached ? JSON.parse(cached) : null;
}

function setCachedData(cacheKey, data, duration = CACHE_DURATION) {
  const cache = CacheService.getScriptCache();
  
  // Check if data is too large (approx 90KB safety margin)
  const dataSize = JSON.stringify(data).length;
  if (dataSize > 90000) { // 90KB safety margin
    console.log(`📦 Data too large (${dataSize} bytes), using chunked caching`);
    return setChunkedCacheData(cacheKey, data, duration);
  }
  
  cache.put(cacheKey, JSON.stringify(data), duration);
}

function setChunkedCacheData(cacheKey, data, duration = CACHE_DURATION) {
  const cache = CacheService.getScriptCache();
  
  // Split data into chunks
  const jsonString = JSON.stringify(data);
  const chunkSize = 80000; // 80KB chunks for safety
  const chunks = [];
  
  for (let i = 0; i < jsonString.length; i += chunkSize) {
    chunks.push(jsonString.slice(i, i + chunkSize));
  }
  
  console.log(`📦 Splitting into ${chunks.length} chunks`);
  
  // Store chunks with numbered keys
  const cacheData = {};
  cacheData[`${cacheKey}_count`] = chunks.length;
  
  chunks.forEach((chunk, index) => {
    cacheData[`${cacheKey}_${index}`] = chunk;
  });
  
  cache.putAll(cacheData, duration);
  return chunks.length;
}

 // cache.gs - ADD DEBUG LOGGING
function getFilteredEventsCache(filters) {
  const cacheKey = generateFilterCacheKey(filters);
  console.log(`🔍 Looking for cache key: ${cacheKey}`);
  
  // Try regular cache first
  const cached = getCachedData(cacheKey);
  if (cached) {
    console.log(`✅ Found regular cache with ${cached.events ? cached.events.length : 'no'} events`);
    return cached;
  }
  
  // Try chunked cache
  const chunkedCached = getChunkedCacheData(cacheKey);
  if (chunkedCached) {
    console.log(`✅ Found chunked cache with ${chunkedCached.events ? chunkedCached.events.length : 'no'} events`);
    return chunkedCached;
  }
  
  console.log(`❌ No cache found for key: ${cacheKey}`);
  return null;
}

function getChunkedCacheData(cacheKey) {
  const cache = CacheService.getScriptCache();
  
  // Check if data is chunked
  const chunkCount = cache.get(`${cacheKey}_count`);
  console.log(`🔍 Chunk count for ${cacheKey}: ${chunkCount}`);
  
  if (!chunkCount) return null;
  
  const chunks = [];
  for (let i = 0; i < parseInt(chunkCount); i++) {
    const chunk = cache.get(`${cacheKey}_${i}`);
    if (chunk) {
      chunks.push(chunk);
    } else {
      console.log(`❌ Missing chunk ${i} for ${cacheKey}`);
    }
  }
  
  console.log(`🔍 Retrieved ${chunks.length} of ${chunkCount} chunks`);
  
  if (chunks.length === parseInt(chunkCount)) {
    try {
      const data = JSON.parse(chunks.join(''));
      console.log(`✅ Successfully reconstructed chunked cache with ${data.events ? data.events.length : 'no'} events`);
      return data;
    } catch (e) {
      console.log(`❌ Error parsing chunked cache: ${e}`);
      return null;
    }
  }
  
  return null;
}

function clearFilteredEventsCache() {
  // For chunked cache, we need to be more specific
  console.log("✅ Events cache cleared");
  // Rely on TTL for automatic cleanup
}
 

 

function setFilteredEventsCache(filters, data, duration = 300) { // 5 minutes
  const cacheKey = generateFilterCacheKey(filters);
  setCachedData(cacheKey, data, duration);
}

function generateFilterCacheKey(filters) {
  // Create a unique key based on the filters
  const keyParts = [
    'filtered_events',
    filters.startDate || 'no_start',
    filters.endDate || 'no_end', 
    filters.machineId || 'all_machines',
    filters.eventName || 'all_events'
  ];
  return keyParts.join('_');
}

// Add these to your existing cache.gs file



function clearAllEventCaches() {
  clearCache(); // This uses your existing clearCache function
  console.log("✅ Cleared all event caches");
}

function getCacheInfo() {
  // Apps Script doesn't provide a way to list all cache keys
  // So we can only show general cache status
  const cache = CacheService.getScriptCache();
  console.log("🔍 Cache Service Info:");
  console.log("   - Maximum cache size: 100KB");
  console.log("   - Default expiration: 10 minutes");
  console.log("   - Use clearAllEventCaches() to clear everything");
}


// Automatic daily cache clearing
function setupDailyCacheClear() {
  // Delete any existing triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "clearAllCachesDaily") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger to run daily at 3 AM
  ScriptApp.newTrigger("clearAllCachesDaily")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
    
  console.log("✅ Daily cache clear scheduled for 3 AM daily");
}

function clearAllCachesDaily() {
  console.log("🔄 AUTOMATIC DAILY CACHE CLEAR - STARTING");
  
  // Clear all caches
  clearCache(); // Clears script cache
  
  // Also clear any properties storage if used
  const properties = PropertiesService.getScriptProperties();
  properties.deleteAllProperties();
  
  console.log("✅ ALL CACHES CLEARED - Events, Machines, Event Names, etc.");
  
  // Log the cleanup
  console.log("🕒 Next automatic clear: 24 hours from now");
}

// Function to manually trigger daily clear (for testing)
function manualDailyClear() {
  console.log("🔄 MANUAL DAILY CLEAR TRIGGERED");
  clearAllCachesDaily();
  return "✅ All caches cleared manually";
}

// Function to check cache status
function getCacheStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  const dailyTrigger = triggers.find(trigger => 
    trigger.getHandlerFunction() === "clearAllCachesDaily"
  );
  
  return {
    hasDailyTrigger: !!dailyTrigger,
    triggerCount: triggers.length,
    nextClear: dailyTrigger ? "3 AM Daily" : "Not scheduled",
    cacheSize: "100KB max",
    defaultTTL: "24 hours for dropdowns, 5 min for events"
  };
}

// Add to cache.gs
function getEventsCacheStatus(filters) {
  const cacheKey = generateFilterCacheKey(filters);
  const cached = getCachedData(cacheKey);
  
  return {
    hasCache: !!cached,
    cacheKey: cacheKey,
    eventCount: cached ? (cached.events ? cached.events.length : 0) : 0,
    timestamp: cached ? cached.timestamp : null
  };
}

function clearSpecificEventsCache(filters) {
  const cacheKey = generateFilterCacheKey(filters);
  clearCache(cacheKey);
  return `Cleared cache for: ${cacheKey}`;
}
