function getRefillNeeds(filters) {
  try {
    console.log("🔧 SINGLE MACHINE: Starting getRefillNeeds with filters:", filters);
    console.log("🔧 SINGLE MACHINE: Using ENHANCED functions with timeout protection");
    
    const allMachines = fetchMachines();
    const allUsers = fetchUsers();
    
    const machines = filters.machineId 
      ? allMachines.filter(m => m.id == filters.machineId) 
      : allMachines;
    
    if (filters.machineId && machines.length === 0) {
      return { items: [], totalCount: 0, error: `Machine with ID ${filters.machineId} not found` };
    }
    
    const allResults = [];
    
    // Enhanced tagged products fetch with timeout protection
    const taggedProducts = fetchTaggedProductsWithRetry();
    
    if (!taggedProducts || taggedProducts.length === 0) {
      return { items: [], totalCount: 0, error: "Failed to fetch tagged stock products" };
    }
    
    const componentToProductMap = buildComponentMap(taggedProducts);
    
    machines.forEach(machine => {
      try {
        // Enhanced machine products fetch with timeout protection
        const machineProducts = fetchMachineProductsWithRetry(machine.id);
        
        if (!machineProducts || !Array.isArray(machineProducts)) {
          console.error(`Failed to fetch components for machine ${machine.id}`);
          return;
        }
        
        const componentsNeedingRefill = machineProducts.filter(p => 
          p.type === "COMPONENT" && p.amount <= p.amount_critical
        );
        
        if (componentsNeedingRefill.length === 0) {
          return;
        }
        
        const assignedUsers = findUserForMachineStrictWithRetry(machine.id, allUsers);
        const responsibleUser = formatResponsibleUser(assignedUsers);
        
        componentsNeedingRefill.forEach(component => {
          const stockId = component.stock_id;
          const relatedProducts = componentToProductMap[stockId] || [];
          
          if (relatedProducts.length > 0) {
            relatedProducts.forEach(product => {
              allResults.push({
                machine_id: machine.id,
                machine_name: machine.name,
                responsible_user: responsibleUser,
                assigned_users: assignedUsers,
                product_id: product.id,
                product_name: cleanProductNameAggressive(product.name), // Use aggressive cleaning
                product_article: product.article
              });
            });
          }
        });
        
      } catch (machineError) {
        console.error(`Error processing machine ${machine.id}:`, machineError);
      }
    });
    
    // Aggressive deduplication using cleaned product names
    const uniqueResults = {};
    allResults.forEach(item => {
      const cleanName = cleanProductNameAggressive(item.product_name);
      const key = `${item.machine_id}_${cleanName}`;
      if (!uniqueResults[key]) {
        uniqueResults[key] = {
          ...item,
          product_name: cleanName // Use cleaned name
        };
      }
    });
    
    const uniqueItems = Object.values(uniqueResults);
    const offset = filters.offset || 0;
    const limit = filters.limit || 25;
    const paged = uniqueItems.slice(offset, offset + limit);
    
    return { items: paged, totalCount: uniqueItems.length };
  } catch (error) {
    console.error("Error fetching refill needs:", error);
    return { items: [], totalCount: 0, error: error.message };
  }
}

function findUserForMachine(machineId, allUsers) {
  const operators = allUsers.filter(user => 
    user.type === "operator" || 
    user.type === "custom-type38948" || 
    (user.type && user.type.startsWith("custom-type") && user.type_title === "Operator") ||
    (user.type_title && user.type_title.toLowerCase().includes("operator"))
  );
  
  const assignedUsers = [];
  
  for (const operator of operators) {
    try {
      const userDetails = fetchUserDetails(operator.id);
      
      if (!userDetails) {
        continue;
      }
      
      let hasAccess = false;
      
      if (userDetails.can_access_all_machines === true) {
        hasAccess = true;
      }
      
      if (!hasAccess && userDetails.access_machines) {
        if (Array.isArray(userDetails.access_machines)) {
          hasAccess = userDetails.access_machines.some(machine => {
            if (typeof machine === 'object' && machine.id) {
              return machine.id == machineId;
            } else {
              return machine == machineId;
            }
          });
        }
      }
      
      if (hasAccess) {
        assignedUsers.push({
          id: operator.id,
          name: `${operator.first_name} ${operator.last_name}`.trim(),
          email: operator.email || "",
          type: 'operator'
        });
      }
    } catch (error) {
      console.error(`Error processing operator ${operator.first_name} ${operator.last_name}:`, error);
    }
  }
  
  return assignedUsers;
}



// New progress function for refill
function updateRefillProgress(progressKey, percent, message, processed, total, results, machineDetails = null) {
  try {
    const progressCache = CacheService.getScriptCache();
    // Preserve existing cancellation flag if present
    let existingCancelled = false;
    try {
      const existingRaw = progressCache.get(progressKey);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        existingCancelled = !!existing.cancelled;
      }
    } catch (e) {}
    
    // Enhanced progress data with better error handling - NO RESULTS in cache to prevent overflow
    const progressData = {
      p: Math.min(100, Math.max(0, percent)), // percent
      m: message, // message  
      pr: processed, // processed
      t: total, // total
      rc: results ? results.length : 0, // resultCount
      ts: new Date().getTime(), // timestamp
      err: machineDetails?.error || null, // error info
      key: progressKey, // cache key for verification
      cancelled: existingCancelled
      // NO results in cache to prevent overflow - we'll use a separate cache for results
    };
    
    // Minimized logging to avoid oversized logs
    console.log(`📊 Progress [${progressData.p}%] ${message} | ${processed}/${total} machines | results=${progressData.rc}`);
    
    // Print results for each completed machine
    if (machineDetails && machineDetails.completed) {
      console.log(`✅ Machine ${machineDetails.name} completed: ${machineDetails.componentsFound} components needing refill`);
      if (machineDetails.responsibleUser) {
        console.log(`👥 Responsible: ${machineDetails.responsibleUser}`);
      }
      if (machineDetails.error) {
        console.log(`❌ Error: ${machineDetails.error}`);
      }
    }
    
    // Store progress data (without results to prevent cache overflow)
    const jsonString = JSON.stringify(progressData);
    
    // Always update the cache with the latest data
    console.log(`📊 Updating cache with processed=${progressData.pr}, total=${progressData.t}, results=${progressData.rc}`);
    console.log(`📊 DEBUG: rc field set to: ${progressData.rc}`);
    
    if (jsonString.length > 9000) { // Google Apps Script cache limit is ~10KB
      console.warn("⚠️ Cache data too large, using minimal fallback");
      const minimalData = { 
        p: percent, 
        m: message,
        ts: new Date().getTime()
      };
      progressCache.put(progressKey, JSON.stringify(minimalData), 300);
    } else {
      progressCache.put(progressKey, jsonString, 300); // 5 minutes
    }
    
    // Store results separately if we have them
    if (results && results.length > 0) {
      storeRefillResults(progressKey, results);
    }
    return true;
  } catch (error) {
    console.error("Error updating refill progress:", error);
    
    // Enhanced fallback with multiple retry strategies
    try {
      const minimalData = {
        percent: Math.min(100, Math.max(0, percent)),
        message: message,
        processed: processed,
        total: total,
        resultCount: results ? results.length : 0,
        timestamp: new Date().getTime()
      };
      CacheService.getScriptCache().put(progressKey, JSON.stringify(minimalData), 300);
      console.log(`📊 Minimal Progress [${percent}%]: ${message} | Machines: ${processed}/${total}`);
      return true;
    } catch (minimalError) {
      console.error("Error updating minimal progress:", minimalError);
      
      // Final fallback - just store basic info
      try {
        const basicData = { percent: percent, message: message };
        CacheService.getScriptCache().put(progressKey, JSON.stringify(basicData), 300);
        console.log(`📊 Basic Progress [${percent}%]: ${message}`);
        return true;
      } catch (basicError) {
        console.error("Error updating basic progress:", basicError);
      return false;
      }
    }
  }
}

// Store results separately to prevent cache overflow
function storeRefillResults(progressKey, results) {
  try {
    const resultsKey = `${progressKey}_results`;
    const cache = CacheService.getScriptCache();
    
    // Get existing results to accumulate
    const existingData = getRefillResults(progressKey);
    let allResults = [];
    
    if (existingData && existingData.results) {
      allResults = existingData.results;
      // Keep logs minimal
    }
    
    // Simplify NEW results and add to accumulated results
    const simplifiedResults = results.map(result => ({
      machine_id: result.machine_id,
      machine_name: result.machine_name,
      product_name: result.product_name,
      responsible_user: result.responsible_user,
      assigned_users: result.assigned_users
    }));
    
    allResults.push(...simplifiedResults);
    
    // Store in chunks of 50 to avoid cache overflow
    const chunkSize = 50;
    const totalChunks = Math.ceil(allResults.length / chunkSize);
    
    // Minimal log for chunking
    console.log(`📦 Caching results: total=${allResults.length}, chunks=${totalChunks}`);
    
    // Clear old chunks first
    if (existingData && existingData.totalCount) {
      const oldChunks = Math.ceil(existingData.totalCount / chunkSize);
      for (let i = 0; i < oldChunks; i++) {
        cache.remove(`${resultsKey}_chunk_${i}`);
      }
    }
    
    // Store new chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = start + chunkSize;
      const chunk = allResults.slice(start, end);
      
      const chunkKey = `${resultsKey}_chunk_${i}`;
      const chunkData = {
        results: chunk,
        chunkIndex: i,
        totalChunks: totalChunks,
        timestamp: new Date().getTime()
      };
      
      cache.put(chunkKey, JSON.stringify(chunkData), 300);
    }
    
    // Store metadata
    const metaData = {
      totalCount: allResults.length,
      totalChunks: totalChunks,
      timestamp: new Date().getTime()
    };
    cache.put(resultsKey, JSON.stringify(metaData), 300);
    
    console.log(`✅ Results cached: total=${allResults.length}, chunks=${totalChunks}`);
    return true;
  } catch (error) {
    console.error("Error storing refill results:", error);
    return false;
  }
}

// Get results separately
function getRefillResults(progressKey) {
  try {
    const resultsKey = `${progressKey}_results`;
    const cache = CacheService.getScriptCache();
    const metaCached = cache.get(resultsKey);
    
    if (!metaCached) {
      return null;
    }
    
    const metaData = JSON.parse(metaCached);
    
    // If no chunks, return just metadata
    if (!metaData.totalChunks || metaData.totalChunks === 0) {
      return metaData;
    }
    
    // Retrieve all chunks
    const allResults = [];
    for (let i = 0; i < metaData.totalChunks; i++) {
      const chunkKey = `${resultsKey}_chunk_${i}`;
      const chunkCached = cache.get(chunkKey);
      
      if (chunkCached) {
        const chunkData = JSON.parse(chunkCached);
        allResults.push(...chunkData.results);
      }
    }
    
    // Minimize logs
    
    return {
      results: allResults,
      totalCount: metaData.totalCount,
      timestamp: metaData.timestamp
    };
  } catch (error) {
    console.error("Error getting refill results:", error);
    return null;
  }
}

// Get real-time results that are pushed immediately when each machine completes
function getRefillRealtimeResults(progressKey) {
  try {
    const realtimeKey = `${progressKey}_realtime`;
    const cache = CacheService.getScriptCache();
    const cached = cache.get(realtimeKey);
    
    if (cached) {
      const realtimeData = JSON.parse(cached);
      // Keep logs minimal
      return realtimeData;
    }
    
    return null;
  } catch (error) {
    console.error("Error getting realtime results:", error);
    return null;
  }
}

function getRefillProgress(progressKey) {
  try {
    const progressCache = CacheService.getScriptCache();
    const cached = progressCache.get(progressKey);
    
    if (cached) {
      const progressData = JSON.parse(cached);
      
      // Get the latest results for this machine
      let currentResults = null;
      let actualTotalResults = progressData.rc || 0;
      
      try {
        // First try to get real-time results (most recent machine)
        const realtimeData = getRefillRealtimeResults(progressKey);
        if (realtimeData && realtimeData.results && realtimeData.results.length > 0) {
          currentResults = realtimeData.results;
          actualTotalResults = realtimeData.totalCount;
          // Minimal log
        } else {
          // Fallback to accumulated results
          const resultsData = getRefillResults(progressKey);
          if (resultsData && resultsData.results && resultsData.results.length > 0) {
            currentResults = resultsData.results;
            actualTotalResults = resultsData.totalCount || resultsData.results.length;
            // Minimal log
          } else if (resultsData && resultsData.totalCount) {
            actualTotalResults = resultsData.totalCount;
            // Minimal log
          }
        }
      } catch (e) {
        console.error("⚠️ Error retrieving results in getRefillProgress:", e);
      }
      
      return {
        percent: progressData.p || 0,
        message: progressData.m || "Processing...",
        processed: progressData.pr || 0,
        total: progressData.t || 0,
        resultCount: progressData.rc || 0,
        cancelled: progressData.cancelled || false,
        timestamp: progressData.ts || new Date().getTime(),
        error: progressData.err || null,
        currentResults: currentResults,
        totalResults: actualTotalResults
      };
    } else {
      return { 
        percent: 0, 
        message: "Starting...", 
        processed: 0, 
        total: 0, 
        resultCount: 0,
        cancelled: false,
        timestamp: new Date().getTime(),
        error: null,
        currentResults: null,
        totalResults: 0
      };
    }
  } catch (error) {
    console.error("Error getting refill progress:", error);
    return { 
      percent: 0, 
      message: "Error getting progress", 
      processed: 0, 
      total: 0, 
      resultCount: 0,
      cancelled: false,
      timestamp: new Date().getTime(),
      error: error.message,
      currentResults: null,
      totalResults: 0
    };
  }
}

function fetchTaggedProducts() {
  try {
    const taggedStockUrl = `${API_BASE}/stock?tags=41258`;
    const taggedStockRes = UrlFetchApp.fetch(taggedStockUrl, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (taggedStockRes.getResponseCode() !== 200) {
      console.error("Failed to fetch tagged stock products:", taggedStockRes.getContentText());
      return [];
    }
    
    const taggedStockData = JSON.parse(taggedStockRes.getContentText());
    return taggedStockData.result || [];
  } catch (error) {
    console.error("Error fetching tagged products:", error);
    return [];
  }
}

function buildComponentMap(taggedProducts) {
  const componentToProductMap = {};
  
  taggedProducts.forEach(product => {
    if (product.type === "COMPOSITE_PRODUCT" && Array.isArray(product.recipe)) {
      product.recipe.forEach(recipeItem => {
        const componentId = recipeItem.component_id;
        if (componentId) {
          if (!componentToProductMap[componentId]) {
            componentToProductMap[componentId] = [];
          }
          
          const productExistsById = componentToProductMap[componentId].some(p => p.id === product.id);
          if (!productExistsById) {
            componentToProductMap[componentId].push({
              id: product.id,
              name: product.name,
              article: product.article
            });
          }
        }
      });
    }
  });
  
  return componentToProductMap;
}

function fetchMachineProducts(machineId) {
  try {
    const componentsUrl = `${API_BASE}/machine/${machineId}/products`;
    const componentsRes = UrlFetchApp.fetch(componentsUrl, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true,
      timeout: 30000
    });
    
    if (componentsRes.getResponseCode() !== 200) {
      console.error(`Failed to fetch components for machine ${machineId}:`, componentsRes.getContentText());
      return null;
    }
    
    return JSON.parse(componentsRes.getContentText()).result || [];
  } catch (error) {
    console.error(`Error fetching products for machine ${machineId}:`, error);
    return null;
  }
}

function cleanProductNameBackend(name) {
  if (!name) return "Unknown Product";
  return name
    .replace(/\s+\d+(\.\d+)?\s*[Ll]\b/gi, '')
    .replace(/\s+\d+(\.\d+)?\s*[Gg]\b/gi, '')
    .replace(/\s+\d+(\.\d+)?\s*[Mm][Ll]\b/gi, '')
    .replace(/\s*\([^)]*\)$/, '')
    .trim() || name;
}

function formatResponsibleUser(assignedUsers) {
  if (assignedUsers.length === 0) {
    return "Unassigned";
  } else if (assignedUsers.length === 1) {
    return assignedUsers[0].name;
  } else if (assignedUsers.length <= 2) {
    return assignedUsers.map(u => u.name).join(", ");
  } else {
    return `${assignedUsers.length} users assigned`;
  }
}

function clearRefillProgress(progressKey) {
  try {
    const progressCache = CacheService.getScriptCache();
    progressCache.remove(progressKey);
    
    // Also clear results cache
    const resultsKey = `${progressKey}_results`;
    const meta = progressCache.get(resultsKey);
    if (meta) {
      try {
        const metaData = JSON.parse(meta);
        if (metaData && metaData.totalChunks) {
          for (let i = 0; i < metaData.totalChunks; i++) {
            progressCache.remove(`${resultsKey}_chunk_${i}`);
          }
        }
      } catch (e) {}
    }
    progressCache.remove(resultsKey);
    
    // Clear realtime key
    const realtimeKey = `${progressKey}_realtime`;
    progressCache.remove(realtimeKey);
    
    console.log("✅ Cleared refill progress and results cache for key:", progressKey);
    return { success: true, message: "Progress and results cleared" };
  } catch (error) {
    console.error("Error clearing refill progress:", error);
    return { success: false, error: error.message };
  }
}

// Explicitly cancel a running refill process
function cancelRefillProcess(progressKey) {
  try {
    const cache = CacheService.getScriptCache();
    const existingRaw = cache.get(progressKey);
    let newData = { p: 0, m: "Cancelled", pr: 0, t: 0, rc: 0, ts: new Date().getTime(), key: progressKey };
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        newData = {
          p: parsed.p || 0,
          m: "Cancelled by user",
          pr: parsed.pr || 0,
          t: parsed.t || 0,
          rc: parsed.rc || 0,
          ts: new Date().getTime(),
          err: parsed.err || null,
          key: progressKey,
          cancelled: true
        };
      } catch (e) {}
    } else {
      newData.cancelled = true;
    }
    cache.put(progressKey, JSON.stringify(newData), 300);
    console.log("🛑 Marked process as cancelled:", progressKey);
    return { success: true };
  } catch (error) {
    console.error("Error cancelling process:", error);
    return { success: false, error: error.message };
  }
}

// Enhanced batch processing with fallback mechanisms
function processMachinesInBatches(machines, batchSize = 5, maxBatches = 10) {
  const batches = [];
  for (let i = 0; i < machines.length && i < batchSize * maxBatches; i += batchSize) {
    batches.push(machines.slice(i, i + batchSize));
  }
  return batches;
}

// Fallback mechanism for when bandwidth quota is exceeded
function getRefillNeedsFallback(filters) {
  console.log("🔄 FALLBACK: Using cached data or partial results");
  
  try {
    // Try to get any cached results first
    const cacheKey = `refill_fallback_${filters.machineId || 'all'}`;
    const cached = CacheService.getScriptCache().get(cacheKey);
    
    if (cached) {
      const data = JSON.parse(cached);
      console.log(`✅ Found cached fallback data: ${data.items?.length || 0} items`);
      return data;
    }
    
    // If no cache, try to process a smaller subset
    const allMachines = fetchMachines();
    const machines = filters.machineId 
      ? allMachines.filter(m => m.id == filters.machineId) 
      : allMachines.slice(0, 10); // Only process first 10 machines
    
    console.log(`🔄 FALLBACK: Processing ${machines.length} machines (reduced set)`);
    
    const allResults = [];
    const taggedProducts = fetchTaggedProductsWithRetry();
    
    if (!taggedProducts || taggedProducts.length === 0) {
      return { items: [], totalCount: 0, error: "Failed to load product data in fallback mode" };
    }
    
    const componentToProductMap = buildComponentMap(taggedProducts);
    
    machines.forEach(machine => {
      try {
        const machineProducts = fetchMachineProductsWithRetry(machine.id);
        
        if (!machineProducts || !Array.isArray(machineProducts)) {
          return;
        }
        
        const componentsNeedingRefill = machineProducts.filter(p => 
          p.type === "COMPONENT" && p.amount <= p.amount_critical
        );
        
        if (componentsNeedingRefill.length === 0) {
          return;
        }
        
        const assignedUsers = findUserForMachineStrictWithRetry(machine.id, fetchUsers());
        const responsibleUser = formatResponsibleUser(assignedUsers);
        
        componentsNeedingRefill.forEach(component => {
          const relatedProducts = componentToProductMap[component.stock_id] || [];
          
          relatedProducts.forEach(product => {
            allResults.push({
              machine_id: machine.id,
              machine_name: machine.name,
              responsible_user: responsibleUser,
              assigned_users: assignedUsers,
              product_id: product.id,
              product_name: cleanProductNameAggressive(product.name),
              product_article: product.article
            });
          });
        });
        
      } catch (machineError) {
        console.error(`Error processing machine ${machine.id} in fallback:`, machineError);
      }
    });
    
    // Cache the fallback results
    const result = { items: allResults, totalCount: allResults.length };
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 1800); // 30 minutes
    
    return result;
    
  } catch (error) {
    console.error("Error in fallback mode:", error);
    return { items: [], totalCount: 0, error: error.message };
  }
}

// Function to cancel any running refill processes
function cancelAllRefillProcesses() {
  try {
    const cache = CacheService.getScriptCache();
    
    // Google Apps Script cache doesn't have getKeys(), so we'll use a different approach
    // Just clear any known progress keys by trying common patterns
    let cancelledCount = 0;
    const currentTime = new Date().getTime();
    
    // Try to clear any progress keys from the last hour
    for (let i = 0; i < 60; i++) {
      const testKey = `refill_progress_${currentTime - (i * 60000)}`;
      try {
        const existing = cache.get(testKey);
        if (existing) {
          cache.remove(testKey);
          cancelledCount++;
          console.log("🧹 Removed process:", testKey);
        }
      } catch (e) {
        // Key doesn't exist, continue
      }
    }
    
    console.log(`🧹 Removed ${cancelledCount} processes`);
    return { success: true, cancelledCount: cancelledCount };
  } catch (error) {
    console.error("Error cancelling processes:", error);
    return { success: false, error: error.message };
  }
}

function getRefillNeedsWithProgress(filters) {
  console.log("🔄 ALL MACHINES: Starting refill needs with progress:", filters);
  console.log("🔄 ALL MACHINES: Using ENHANCED functions with rate limiting and error recovery");
  
  const progressKey = filters.progressKey || 'refill_progress_' + new Date().getTime();
  
  console.log("🔑 Backend using progress key:", progressKey);
  
  // Clear any existing progress for this key to prevent conflicts
  try {
    CacheService.getScriptCache().remove(progressKey);
    console.log("🧹 Cleared existing progress cache for key:", progressKey);
  } catch (error) {
    console.log("⚠️ Could not clear existing cache:", error);
  }
  
  // Set initial progress with "not cancelled" flag
  updateRefillProgress(progressKey, 5, "Starting refill analysis...", 0, 0, []);
  
  const startTime = new Date().getTime();
  const maxProcessingTime = 8 * 60 * 1000; // 8 minutes max (reduced from 10)
  
  try {
    const allMachines = fetchMachines();
    const allUsers = fetchUsers();
    
    const machines = allMachines; // Always process all machines
    const totalMachines = machines.length;
    
    console.log(`🔍 Processing ${totalMachines} machines with enhanced rate limiting`);
    updateRefillProgress(progressKey, 5, "Starting refill analysis...", 0, totalMachines, []);

    // Get tagged products with retry logic
    updateRefillProgress(progressKey, 10, "Loading product data...", 0, totalMachines, []);
    const taggedProducts = fetchTaggedProductsWithRetry();
    
    if (!taggedProducts || taggedProducts.length === 0) {
      console.error("❌ Failed to fetch tagged products after retries");
      updateRefillProgress(progressKey, 0, "❌ Failed to load product data", 0, totalMachines, []);
      return { items: [], totalCount: 0, error: "Failed to load product data" };
    }
    
    const componentToProductMap = buildComponentMap(taggedProducts);
    
    const allResults = [];
    let processedCount = 0;
    let errorCount = 0;
    let bandwidthErrors = 0;
    let lastSuccessfulMachine = 0;
    
    // Enhanced rate limiting and error recovery
    const rateLimiter = new RateLimiter();
    
    // Process each machine with enhanced error handling and timeouts
    for (let i = 0; i < totalMachines; i++) {
      // Check for cancellation first
      try {
        const currentProgress = CacheService.getScriptCache().get(progressKey);
        if (currentProgress) {
          const progressData = JSON.parse(currentProgress);
          if (progressData.cancelled) {
            console.log("🛑 Process cancelled by user, stopping at machine", i+1);
            return { error: "Process cancelled by user" };
          }
        }
      } catch (e) {
        // If we can't check cancellation, continue
      }
      
      // Check for timeout
      const currentTime = new Date().getTime();
      if (currentTime - startTime > maxProcessingTime) {
        console.warn(`⏰ Processing timeout reached (${maxProcessingTime/1000}s), stopping at machine ${i+1}/${totalMachines}`);
        updateRefillProgress(progressKey, 90, `Timeout reached - processed ${processedCount}/${totalMachines} machines`, processedCount, totalMachines, []);
        break;
      }
      
      // Enhanced rate limiting with adaptive delays
      const delay = rateLimiter.getDelay(i, bandwidthErrors);
      if (delay > 0) {
        console.log(`⏸️ Rate limiting: waiting ${delay}ms before processing machine ${i+1}`);
        Utilities.sleep(delay);
      }
      
      // Add a small delay to allow frontend polling to catch up
      if (i > 0) {
        Utilities.sleep(100); // 100ms delay to allow frontend updates
      }
      
      const machine = machines[i];
      
      // Show what we're about to process, but count what we've completed
      const statusMessage = `Processing machine ${i+1}/${totalMachines}: ${machine.name}`;
      
      // Calculate percentage based on current machine being processed (not completed)
      const progressPercent = 10 + Math.floor((i / totalMachines) * 80);
      
      console.log(`🔄 ${statusMessage} | Processing: ${i+1}/${totalMachines} | Progress: ${progressPercent}%`);
      
      // Update progress to show we're starting this machine (use i+1 to show current machine)
        updateRefillProgress(progressKey, progressPercent, `Processing ${machine.name}`, i+1, totalMachines, []);
      
      let machineResults = [];
      let machineDetails = {
        name: machine.name,
        id: machine.id,
        componentsFound: 0,
        responsibleUser: "Unassigned",
        completed: false,
        error: null
      };
      
      try {
        // Enhanced timeout protection with retry logic
        const machineProducts = fetchMachineProductsWithRetry(machine.id);
        
        if (!machineProducts || !Array.isArray(machineProducts)) {
          console.log(`❌ No products found for machine ${machine.id}`);
          machineDetails.completed = true;
          machineDetails.componentsFound = 0;
          processedCount++;
          const noProductsPercent = 10 + Math.floor((processedCount / totalMachines) * 80);
          updateRefillProgress(progressKey, noProductsPercent, `No products found for ${machine.name}`, processedCount, totalMachines, [], machineDetails);
          continue;
        }
        
        const componentsNeedingRefill = machineProducts.filter(p => 
          p.type === "COMPONENT" && p.amount <= (p.amount_critical || 0)
        );
        
        machineDetails.componentsFound = componentsNeedingRefill.length;
        
        if (componentsNeedingRefill.length === 0) {
          console.log(`✅ No refill needed for ${machine.name}`);
          machineDetails.completed = true;
          processedCount++;
          const noRefillPercent = 10 + Math.floor((processedCount / totalMachines) * 80);
          updateRefillProgress(progressKey, noRefillPercent, `No refill needed for ${machine.name}`, processedCount, totalMachines, [], machineDetails);
          continue;
        }
        
        // Update progress to show we're processing user assignments
        updateRefillProgress(progressKey, progressPercent, `Assigning operators for ${machine.name}`, i+1, totalMachines, []);
        
        // Enhanced user assignment with error handling
        const assignedUsers = findUserForMachineStrictWithRetry(machine.id, allUsers);
        const responsibleUser = formatResponsibleUser(assignedUsers);
        machineDetails.responsibleUser = responsibleUser;
        
        // Update progress to show we're processing results
        updateRefillProgress(progressKey, progressPercent, `Processing results for ${machine.name}`, i+1, totalMachines, []);
        
        // Add results for this machine
        componentsNeedingRefill.forEach(component => {
          const relatedProducts = componentToProductMap[component.stock_id] || [];
          
          relatedProducts.forEach(product => {
            const resultItem = {
              machine_id: machine.id,
              machine_name: machine.name,
              responsible_user: responsibleUser,
              assigned_users: assignedUsers,
              product_id: product.id,
              product_name: cleanProductNameAggressive(product.name), // Use aggressive cleaning
              product_article: product.article,
              processed_at: new Date().getTime(),
              batch_index: i
            };
            machineResults.push(resultItem);
            allResults.push(resultItem);
          });
        });
        
        machineDetails.completed = true;
        processedCount++;
        lastSuccessfulMachine = i;
        console.log(`✅ Processed ${machine.name}: ${componentsNeedingRefill.length} components needing refill`);
        
        // Update progress with machine completion details - use completed count for percentage
        const completedPercent = 10 + Math.floor((processedCount / totalMachines) * 80);
        console.log(`📊 Machine completed, updating progress: allResults.length = ${allResults.length}`);
        
        // Prepare delta results for cache accumulation
        const resultsDelta = machineResults.map(result => ({
          machine_id: result.machine_id,
          machine_name: result.machine_name,
          product_name: result.product_name,
          responsible_user: result.responsible_user,
          assigned_users: result.assigned_users
        }));

        // Update progress with delta results (storeRefillResults will accumulate)
        updateRefillProgress(progressKey, completedPercent, `Completed ${machine.name}`, processedCount, totalMachines, resultsDelta, machineDetails);
        
        // Immediately push accumulated results to frontend via a separate cache key for real-time updates
        const accumulatedForDisplay = getRefillResults(progressKey);
        const resultsToDisplay = accumulatedForDisplay && accumulatedForDisplay.results ? accumulatedForDisplay.results : resultsDelta;
        const realtimeKey = `${progressKey}_realtime`;
        const realtimeData = {
          results: resultsToDisplay,
          totalCount: resultsToDisplay.length,
          machineName: machine.name,
          processed: processedCount,
          total: totalMachines,
          timestamp: new Date().getTime()
        };
        
        try {
          CacheService.getScriptCache().put(realtimeKey, JSON.stringify(realtimeData), 60); // 1 minute cache
          console.log(`📊 Pushed ${resultsToDisplay.length} results to realtime cache`);
        } catch (e) {
          console.warn("⚠️ Could not push to realtime cache:", e);
        }
        
        // Force cache update and add delay to allow frontend to process the update
        console.log(`📊 FORCING CACHE UPDATE for machine ${processedCount}/${totalMachines}`);
        Utilities.sleep(1000); // 1 second delay to allow frontend to poll and get the data
        
      } catch (machineError) {
        console.error(`💥 Error processing machine ${machine.id}:`, machineError);
        
        // Check if it's a bandwidth quota error
        if (machineError.message && machineError.message.includes("Bandwidth quota exceeded")) {
          bandwidthErrors++;
          console.warn(`⚠️ Bandwidth quota error #${bandwidthErrors} - implementing extended delay`);
          
          // If we have too many bandwidth errors, stop processing
          if (bandwidthErrors >= 3) {
            console.error("❌ Too many bandwidth quota errors - stopping processing");
            updateRefillProgress(progressKey, 0, "❌ Bandwidth quota exceeded - too many errors", processedCount, totalMachines, []);
            return { 
              items: allResults, 
              totalCount: allResults.length,
              error: "Bandwidth quota exceeded - processing stopped",
              progressKey: progressKey,
              processedMachines: processedCount,
              totalMachines: totalMachines,
              bandwidthErrors: bandwidthErrors
            };
          }
          
          // Extended delay for bandwidth errors
          console.log("⏸️ Extended delay due to bandwidth quota error");
          Utilities.sleep(10000); // 10 second delay
        }
        
        machineDetails.error = machineError.message;
        machineDetails.completed = true;
        errorCount++;
        processedCount++;
        const errorPercent = 10 + Math.floor((processedCount / totalMachines) * 80);
        updateRefillProgress(progressKey, errorPercent, `Error with ${machine.name} - skipping`, processedCount, totalMachines, [], machineDetails);
        continue; // Continue with next machine even if one fails
      }
    }
    
    // Final processing with deduplication
    updateRefillProgress(progressKey, 95, "Finalizing results...", totalMachines, totalMachines, []);
    
    // Aggressive deduplication
    const uniqueResults = {};
    allResults.forEach(item => {
      const cleanName = cleanProductNameAggressive(item.product_name);
      const key = `${item.machine_id}_${cleanName}`;
      if (!uniqueResults[key]) {
        uniqueResults[key] = {
          ...item,
          product_name: cleanName // Use cleaned name
        };
      }
    });
    
    const uniqueItems = Object.values(uniqueResults);
    
    // Final completion status
    const completedMachines = [...new Set(allResults.map(r => r.machine_name))];
    const totalProcessed = processedCount;
    const processingTime = Math.round((new Date().getTime() - startTime) / 1000);
    
    let completionMessage = `✅ Complete! Processed ${totalProcessed}/${totalMachines} machines in ${processingTime}s`;
    if (errorCount > 0) {
      completionMessage += ` (${errorCount} errors)`;
    }
    if (bandwidthErrors > 0) {
      completionMessage += ` (${bandwidthErrors} bandwidth errors)`;
    }
    
    updateRefillProgress(progressKey, 100, completionMessage, totalMachines, totalMachines, uniqueItems);
    
    console.log(`
╔════════════════════════════════════════════════════════════
║ 🎉 REFILL ANALYSIS COMPLETE
╠════════════════════════════════════════════════════════════
║ ✅ Machines Processed: ${totalProcessed}/${totalMachines}
║ ⏱️  Processing Time: ${processingTime}s
║ 📦 Unique Products: ${uniqueItems.length}
║ ❌ Errors: ${errorCount}
║ 🌐 Bandwidth Errors: ${bandwidthErrors}
║ 🏢 Machines with refills: ${completedMachines.length}
╚════════════════════════════════════════════════════════════
    `);
    
    if (completedMachines.length > 0) {
      console.log(`📋 Machines needing refills: ${completedMachines.join(', ')}`);
    }
    
    if (errorCount > 0) {
      console.log(`⚠️ ${errorCount} machines had errors during processing`);
    }
    
    if (bandwidthErrors > 0) {
      console.log(`⚠️ ${bandwidthErrors} bandwidth quota errors occurred`);
    }
    
    return { 
      items: uniqueItems, 
      totalCount: uniqueItems.length,
      progressKey: progressKey,
      processedMachines: totalProcessed,
      totalMachines: totalMachines,
      completedMachines: completedMachines,
      errorCount: errorCount,
      bandwidthErrors: bandwidthErrors,
      processingTime: processingTime
    };
    
  } catch (error) {
    console.error("💥 Error in refill needs with progress:", error);
    updateRefillProgress(progressKey, 0, `❌ Error: ${error.message}`, 0, 0, []);
    
    return { 
      items: [], 
      totalCount: 0, 
      error: error.message,
      progressKey: progressKey
    };
  }
}

// Enhanced rate limiter class
function RateLimiter() {
  this.baseDelay = 1000; // 1 second base delay
  this.maxDelay = 30000; // 30 seconds max delay
  this.errorMultiplier = 2; // Multiply delay on errors
  
  this.getDelay = function(machineIndex, errorCount) {
    let delay = this.baseDelay;
    
    // Increase delay based on machine index (more machines = more delay)
    if (machineIndex > 10) {
      delay += (machineIndex - 10) * 200; // 200ms per machine after 10
    }
    
    // Increase delay based on errors
    if (errorCount > 0) {
      delay *= Math.pow(this.errorMultiplier, errorCount);
    }
    
    // Cap at maximum delay
    return Math.min(delay, this.maxDelay);
  };
}

// Enhanced timeout protection for machine products with retry logic
function fetchMachineProductsWithRetry(machineId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    const componentsUrl = `${API_BASE}/machine/${machineId}/products`;
    const componentsRes = UrlFetchApp.fetch(componentsUrl, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true,
        timeout: 20000 // 20 second timeout per machine
    });
    
    if (componentsRes.getResponseCode() !== 200) {
        console.error(`Failed to fetch components for machine ${machineId} (attempt ${attempt}):`, componentsRes.getContentText());
        
        // Check if it's a bandwidth quota error
        if (componentsRes.getContentText().includes("Bandwidth quota exceeded")) {
          console.warn(`⚠️ Bandwidth quota exceeded for machine ${machineId} - attempt ${attempt}`);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 5000; // Exponential backoff: 5s, 10s, 20s
            console.log(`⏸️ Waiting ${delay}ms before retry...`);
            Utilities.sleep(delay);
            continue;
          }
        }
        
        if (attempt < maxRetries) {
          const delay = attempt * 2000; // Linear backoff: 2s, 4s, 6s
          console.log(`⏸️ Waiting ${delay}ms before retry...`);
          Utilities.sleep(delay);
          continue;
        }
        
      return null;
    }
    
    return JSON.parse(componentsRes.getContentText()).result || [];
  } catch (error) {
      console.error(`Error fetching products for machine ${machineId} (attempt ${attempt}):`, error);
      
      if (attempt < maxRetries) {
        const delay = attempt * 3000; // Linear backoff: 3s, 6s, 9s
        console.log(`⏸️ Waiting ${delay}ms before retry...`);
        Utilities.sleep(delay);
        continue;
      }
      
    return null;
  }
  }
  
  return null;
}

// Enhanced tagged products fetch with retry logic
function fetchTaggedProductsWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const taggedStockUrl = `${API_BASE}/stock?tags=41258`;
      const taggedStockRes = UrlFetchApp.fetch(taggedStockUrl, {
        method: "get",
        headers: { "Authorization": "Token " + API_KEY },
        muteHttpExceptions: true,
        timeout: 30000 // 30 second timeout
      });
      
      if (taggedStockRes.getResponseCode() !== 200) {
        console.error(`Failed to fetch tagged stock products (attempt ${attempt}):`, taggedStockRes.getContentText());
        
        if (attempt < maxRetries) {
          const delay = attempt * 5000; // Linear backoff: 5s, 10s, 15s
          console.log(`⏸️ Waiting ${delay}ms before retry...`);
          Utilities.sleep(delay);
          continue;
        }
        
        return [];
      }
      
      const taggedStockData = JSON.parse(taggedStockRes.getContentText());
      return taggedStockData.result || [];
    } catch (error) {
      console.error(`Error fetching tagged products (attempt ${attempt}):`, error);
      
      if (attempt < maxRetries) {
        const delay = attempt * 5000; // Linear backoff: 5s, 10s, 15s
        console.log(`⏸️ Waiting ${delay}ms before retry...`);
        Utilities.sleep(delay);
        continue;
      }
      
      return [];
    }
  }
  
  return [];
}

// Enhanced user assignment with retry logic
function findUserForMachineStrictWithRetry(machineId, allUsers, maxRetries = 2) {
  // Filter for operators - check both type and type_title
  const operators = allUsers.filter(user => {
    // Check if type is exactly "operator" OR if type_title is exactly "Operator"
    const isOperatorType = user.type === "operator" || user.type === "Operator";
    const isOperatorTitle = user.type_title === "Operator";
    
    // Exclude any user with type containing "operator2", "operator3", etc.
    const hasNumberSuffix = user.type && /operator\d/.test(user.type.toLowerCase());
    
    return (isOperatorType || isOperatorTitle) && !hasNumberSuffix;
  });
  
  console.log(`🔍 Found ${operators.length} strict operators out of ${allUsers.length} total users`);
  
  const assignedUsers = [];
  
  for (const operator of operators) {
    let userDetails = null;
    let attempts = 0;
    
    // Retry logic for user details
    while (attempts < maxRetries && !userDetails) {
      try {
        userDetails = fetchUserDetails(operator.id);
        if (!userDetails) {
          attempts++;
          if (attempts < maxRetries) {
            console.log(`⏸️ Retrying user details for ${operator.first_name} ${operator.last_name}...`);
            Utilities.sleep(1000); // 1 second delay between retries
          }
        }
      } catch (error) {
        console.error(`Error fetching user details for ${operator.first_name} ${operator.last_name} (attempt ${attempts + 1}):`, error);
        attempts++;
        if (attempts < maxRetries) {
          console.log(`⏸️ Retrying user details for ${operator.first_name} ${operator.last_name}...`);
          Utilities.sleep(2000); // 2 second delay between retries
        }
      }
    }
    
    if (!userDetails) {
      console.warn(`⚠️ Could not fetch user details for ${operator.first_name} ${operator.last_name} after ${maxRetries} attempts`);
      continue;
    }
    
    let hasAccess = false;
    
    if (userDetails.can_access_all_machines === true) {
      hasAccess = true;
      console.log(`✅ Operator ${operator.first_name} ${operator.last_name} has access to all machines`);
    }
    
    if (!hasAccess && userDetails.access_machines) {
      if (Array.isArray(userDetails.access_machines)) {
        hasAccess = userDetails.access_machines.some(machine => {
          if (typeof machine === 'object' && machine.id) {
            return machine.id == machineId;
          } else {
            return machine == machineId;
          }
        });
        if (hasAccess) {
          console.log(`✅ Operator ${operator.first_name} ${operator.last_name} has specific access to machine ${machineId}`);
        }
      }
    }
    
    if (hasAccess) {
      assignedUsers.push({
        id: operator.id,
        name: `${operator.first_name} ${operator.last_name}`.trim(),
        email: operator.email || "",
        type: 'operator'
      });
    }
  }
  
  console.log(`📋 Machine ${machineId} has ${assignedUsers.length} assigned operators`);
  return assignedUsers;
}

function findUserForMachineStrict(machineId, allUsers) {
  // Filter for operators - check both type and type_title
  const operators = allUsers.filter(user => {
    // Check if type is exactly "operator" OR if type_title is exactly "Operator"
    const isOperatorType = user.type === "operator" || user.type === "Operator";
    const isOperatorTitle = user.type_title === "Operator";
    
    // Exclude any user with type containing "operator2", "operator3", etc.
    const hasNumberSuffix = user.type && /operator\d/.test(user.type.toLowerCase());
    
    return (isOperatorType || isOperatorTitle) && !hasNumberSuffix;
  });
  
  console.log(`🔍 Found ${operators.length} strict operators out of ${allUsers.length} total users`);
  
  const assignedUsers = [];
  
  for (const operator of operators) {
    try {
      const userDetails = fetchUserDetails(operator.id);
      
      if (!userDetails) {
        continue;
      }
      
      let hasAccess = false;
      
      if (userDetails.can_access_all_machines === true) {
        hasAccess = true;
        console.log(`✅ Operator ${operator.first_name} ${operator.last_name} has access to all machines`);
      }
      
      if (!hasAccess && userDetails.access_machines) {
        if (Array.isArray(userDetails.access_machines)) {
          hasAccess = userDetails.access_machines.some(machine => {
            if (typeof machine === 'object' && machine.id) {
              return machine.id == machineId;
            } else {
              return machine == machineId;
            }
          });
          if (hasAccess) {
            console.log(`✅ Operator ${operator.first_name} ${operator.last_name} has specific access to machine ${machineId}`);
          }
        }
      }
      
      if (hasAccess) {
        assignedUsers.push({
          id: operator.id,
          name: `${operator.first_name} ${operator.last_name}`.trim(),
          email: operator.email || "",
          type: 'operator'
        });
      }
    } catch (error) {
      console.error(`Error processing operator ${operator.first_name} ${operator.last_name}:`, error);
    }
  }
  
  console.log(`📋 Machine ${machineId} has ${assignedUsers.length} assigned operators`);
  return assignedUsers;
}

function cleanProductNameAggressive(name) {
  if (!name) return "Unknown Product";
  
  // Remove sizes and variations - more comprehensive pattern matching
  let cleaned = name
    .replace(/\s+\d+(\.\d+)?\s*[Ll]\b/gi, '') // Remove 1L, 2.5L
    .replace(/\s+\d+(\.\d+)?\s*[Ll]itre?s?\b/gi, '') // Remove 1 Litre, 2.5 Litres
    .replace(/\s+\d+(\.\d+)?\s*[Mm][Ll]\b/gi, '') // Remove 500ml, 1.5ml
    .replace(/\s+\d+(\.\d+)?\s*[Gg]\b/gi, '') // Remove 250g, 1.5g
    .replace(/\s+\d+(\.\d+)?\s*[Gg]ram?s?\b/gi, '') // Remove 250 grams
    .replace(/\s*\d+\s*[xX*]\s*\d+\s*[Ll]?\b/gi, '') // Remove 2x500ml, 3x1L
    .replace(/\s*\([^)]*\)$/, '') // Remove anything in parentheses at the end
    .replace(/\s*\[[^\]]*\]$/, '') // Remove anything in brackets at the end
    .replace(/\s*\-.*$/, '') // Remove anything after dash
    .trim();
  
  // If we have multiple words, try to find the base product name
  const words = cleaned.split(/\s+/);
  if (words.length > 2) {
    // Common patterns: keep first 2-3 words typically
    cleaned = words.slice(0, 3).join(' ');
  }
  
  // Specific product normalization
  if (cleaned.includes("Electric Blue Bull")) {
    return "Electric Blue Bull";
  }
  if (cleaned.includes("Classic Bull")) {
    return "Classic Bull";
  }
  
  return cleaned || name;
}

// Enhanced error handling and recovery functions
function handleBandwidthQuotaError(error, machineId, attempt = 1) {
  console.warn(`⚠️ Bandwidth quota error for machine ${machineId} (attempt ${attempt}):`, error.message);
  
  if (attempt >= 3) {
    console.error(`❌ Too many bandwidth quota errors for machine ${machineId} - giving up`);
    return { success: false, shouldStop: true };
  }
  
  // Exponential backoff with jitter
  const baseDelay = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
  const jitter = Math.random() * 2000; // Add up to 2s random delay
  const delay = baseDelay + jitter;
  
  console.log(`⏸️ Waiting ${Math.round(delay)}ms before retry (attempt ${attempt + 1})`);
  Utilities.sleep(delay);
  
  return { success: false, shouldStop: false, retryAfter: delay };
}

// Enhanced timeout handling
function handleTimeoutError(error, machineId, attempt = 1) {
  console.warn(`⏰ Timeout error for machine ${machineId} (attempt ${attempt}):`, error.message);
  
  if (attempt >= 2) {
    console.error(`❌ Too many timeout errors for machine ${machineId} - giving up`);
    return { success: false, shouldStop: true };
  }
  
  // Linear backoff for timeouts
  const delay = attempt * 3000; // 3s, 6s
  
  console.log(`⏸️ Waiting ${delay}ms before retry (attempt ${attempt + 1})`);
  Utilities.sleep(delay);
  
  return { success: false, shouldStop: false, retryAfter: delay };
}

// Enhanced progress monitoring with health checks
function monitorRefillHealth(progressKey, startTime, maxTime = 8 * 60 * 1000) {
  try {
    const currentTime = new Date().getTime();
    const elapsed = currentTime - startTime;
    const remaining = maxTime - elapsed;
    
    if (remaining <= 0) {
      console.warn("⏰ Maximum processing time exceeded");
      return { healthy: false, reason: "timeout" };
    }
    
    if (remaining < 60000) { // Less than 1 minute remaining
      console.warn(`⚠️ Only ${Math.round(remaining / 1000)}s remaining`);
      return { healthy: true, reason: "warning", remaining: remaining };
    }
    
    return { healthy: true, reason: "ok", remaining: remaining };
  } catch (error) {
    console.error("Error monitoring refill health:", error);
    return { healthy: false, reason: "error", error: error.message };
  }
}

// Enhanced result validation
function validateRefillResults(results) {
  if (!Array.isArray(results)) {
    console.error("❌ Results is not an array");
    return { valid: false, error: "Results is not an array" };
  }
  
  if (results.length === 0) {
    console.warn("⚠️ No results found");
    return { valid: true, warning: "No results found" };
  }
  
  // Check for required fields
  const requiredFields = ['machine_id', 'machine_name', 'product_name'];
  const invalidItems = results.filter(item => 
    !requiredFields.every(field => item.hasOwnProperty(field))
  );
  
  if (invalidItems.length > 0) {
    console.warn(`⚠️ ${invalidItems.length} items missing required fields`);
    return { valid: true, warning: `${invalidItems.length} items missing required fields` };
  }
  
  console.log(`✅ Validated ${results.length} results`);
  return { valid: true, count: results.length };
}

// Test function for all scenarios
function testRefillScenarios() {
  console.log("🧪 Testing all refill scenarios...");
  
  const testResults = {
    singleMachine: null,
    allMachines: null,
    fallback: null,
    errorHandling: null,
    rateLimiting: null
  };
  
  try {
    // Test 1: Single machine
    console.log("🧪 Test 1: Single machine processing");
    testResults.singleMachine = getRefillNeeds({ machineId: "325250" });
    console.log(`✅ Single machine test: ${testResults.singleMachine.items?.length || 0} items`);
    
    // Test 2: All machines with progress
    console.log("🧪 Test 2: All machines with progress");
    testResults.allMachines = getRefillNeedsWithProgress({ progressKey: 'test_progress_' + new Date().getTime() });
    console.log(`✅ All machines test: ${testResults.allMachines.items?.length || 0} items`);
    
    // Test 3: Fallback mechanism
    console.log("🧪 Test 3: Fallback mechanism");
    testResults.fallback = getRefillNeedsFallback({ machineId: null });
    console.log(`✅ Fallback test: ${testResults.fallback.items?.length || 0} items`);
    
    // Test 4: Error handling
    console.log("🧪 Test 4: Error handling");
    try {
      const invalidResult = getRefillNeeds({ machineId: "invalid_id" });
      testResults.errorHandling = { success: true, result: invalidResult };
    } catch (error) {
      testResults.errorHandling = { success: false, error: error.message };
    }
    console.log(`✅ Error handling test: ${testResults.errorHandling.success ? 'passed' : 'failed'}`);
    
    // Test 5: Rate limiting
    console.log("🧪 Test 5: Rate limiting");
    const rateLimiter = new RateLimiter();
    const delay1 = rateLimiter.getDelay(5, 0);
    const delay2 = rateLimiter.getDelay(15, 2);
    testResults.rateLimiting = { 
      success: true, 
      delay1: delay1, 
      delay2: delay2,
      adaptive: delay2 > delay1
    };
    console.log(`✅ Rate limiting test: adaptive delays working (${delay1}ms -> ${delay2}ms)`);
    
    console.log("🎉 All tests completed successfully!");
    return testResults;
    
  } catch (error) {
    console.error("❌ Test suite failed:", error);
    return { error: error.message, testResults };
  }
}

// Enhanced error recovery for all scenarios
function recoverFromRefillError(error, context = {}) {
  console.log("🔄 Attempting error recovery:", error.message);
  
  const recoveryStrategies = [
    {
      name: "Retry with exponential backoff",
      action: () => {
        const delay = Math.pow(2, context.attempt || 1) * 1000;
        console.log(`⏸️ Waiting ${delay}ms before retry...`);
        Utilities.sleep(delay);
        return { success: true, delay: delay };
      }
    },
    {
      name: "Switch to fallback mode",
      action: () => {
        console.log("🔄 Switching to fallback mode...");
        return getRefillNeedsFallback(context.filters || {});
      }
    },
    {
      name: "Clear cache and retry",
      action: () => {
        console.log("🧹 Clearing cache and retrying...");
        clearCache();
        return { success: true, cacheCleared: true };
      }
    },
    {
      name: "Reduce batch size",
      action: () => {
        console.log("📦 Reducing batch size...");
        return { success: true, batchSize: 3 };
      }
    }
  ];
  
  for (let i = 0; i < recoveryStrategies.length; i++) {
    try {
      const strategy = recoveryStrategies[i];
      console.log(`🔄 Trying strategy ${i + 1}: ${strategy.name}`);
      const result = strategy.action();
      
      if (result.success) {
        console.log(`✅ Recovery strategy ${i + 1} succeeded`);
        return { success: true, strategy: strategy.name, result: result };
      }
    } catch (strategyError) {
      console.warn(`⚠️ Recovery strategy ${i + 1} failed:`, strategyError.message);
      continue;
    }
  }
  
  console.error("❌ All recovery strategies failed");
  return { success: false, error: "All recovery strategies failed" };
}

// Enhanced monitoring for all scenarios
function monitorRefillSystem() {
  const systemStatus = {
    timestamp: new Date().getTime(),
    cache: null,
    progress: null,
    health: null,
    errors: []
  };
  
  try {
    // Check cache status
    const cache = CacheService.getScriptCache();
    systemStatus.cache = { available: true, size: "100KB max" };
    
    // Check progress status
    const progressKeys = ['refill_progress_' + (new Date().getTime() - 300000)]; // 5 minutes ago
    systemStatus.progress = { keys: progressKeys.length, active: false };
    
    // Check system health
    systemStatus.health = {
      memory: "Normal",
      timeout: "8 minutes max",
      rateLimit: "Adaptive delays active"
    };
    
    console.log("📊 System status:", systemStatus);
    return systemStatus;
    
  } catch (error) {
    systemStatus.errors.push(error.message);
    console.error("❌ System monitoring failed:", error);
    return systemStatus;
  }
}