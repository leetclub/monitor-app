/**
 * Visit Tracking Tab - Safety Culture Integration
 * Fetches and displays inspection reports from Safety Culture API
 */
 
/**
 * Search for audits/inspections by date range and optionally by user
 * @param {Object} filters - Filter object with date range and optional user filter
 * @param {string} filters.modified_after - ISO date string (e.g., "2025-11-16T00:00:00.000Z")
 * @param {string} filters.modified_before - ISO date string (e.g., "2025-11-17T00:00:00.000Z")
 * @param {string} filters.owner_id - Optional user ID to filter by
 * @returns {Object} Search results with audits array
 */
function searchSafetyCultureAudits(filters) {
  try {
    const url = SAFETY_CULTURE_API_BASE + '/audits/search';
    
    // Build query parameters
    // Note: API only accepts: audit_id, modified_at, template_id
    const params = [];
    params.push('field=audit_id');
    params.push('field=modified_at');
    
    if (filters.modified_after) {
      params.push('modified_after=' + encodeURIComponent(filters.modified_after));
    }
    if (filters.modified_before) {
      params.push('modified_before=' + encodeURIComponent(filters.modified_before));
    }
    if (filters.owner_id) {
      params.push('owner_id=' + encodeURIComponent(filters.owner_id));
    }
    
    const fullUrl = url + '?' + params.join('&');
    
    const options = {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + SAFETY_CULTURE_API_TOKEN,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(fullUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      Logger.log('Safety Culture API error: ' + responseCode + ' - ' + responseText);
      throw new Error('API request failed with status ' + responseCode + ': ' + responseText);
    }
    
    const data = JSON.parse(responseText);
    return data;
    
  } catch (error) {
    Logger.log('Error searching Safety Culture audits: ' + error.toString());
    throw error;
  }
}

/**
 * Get detailed audit information by audit ID
 * @param {string} auditId - The audit ID to fetch
 * @returns {Object} Detailed audit data
 */
function getSafetyCultureAudit(auditId) {
  try {
    const url = SAFETY_CULTURE_API_BASE + '/audits/' + auditId;
    
    const options = {
      method: 'get',
      headers: {
        'Authorization': 'Bearer ' + SAFETY_CULTURE_API_TOKEN,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      Logger.log('Safety Culture API error: ' + responseCode + ' - ' + responseText);
      throw new Error('API request failed with status ' + responseCode);
    }
    
    const data = JSON.parse(responseText);
    return data;
    
  } catch (error) {
    Logger.log('Error fetching Safety Culture audit ' + auditId + ': ' + error.toString());
    throw error;
  }
}

/**
 * Get visit tracking data with filters
 * @param {Object} filters - Filter object
 * @param {string} filters.startDate - Start date (YYYY-MM-DD)
 * @param {string} filters.endDate - End date (YYYY-MM-DD)
 * @param {string} filters.userId - Optional user ID filter
 * @returns {Object} Formatted visit tracking data
 */
function getVisitTrackingData(filters) {
  try {
    // Convert date strings to ISO format for API
    const modifiedAfter = filters.startDate ? filters.startDate + 'T00:00:00.000Z' : null;
    const modifiedBefore = filters.endDate ? filters.endDate + 'T23:59:59.999Z' : null;
    
    if (!modifiedAfter || !modifiedBefore) {
      throw new Error('Start date and end date are required');
    }
    
    const searchFilters = {
      modified_after: modifiedAfter,
      modified_before: modifiedBefore,
      owner_id: filters.userId || null
    };
    
    // Search for audits
    const searchResults = searchSafetyCultureAudits(searchFilters);
    
    // Fetch detailed data for each audit
    const audits = [];
    if (searchResults.audits && searchResults.audits.length > 0) {
      for (let i = 0; i < Math.min(searchResults.audits.length, 100); i++) { // Limit to 100 for performance
        try {
          const auditDetail = getSafetyCultureAudit(searchResults.audits[i].audit_id);
          audits.push(auditDetail);
        } catch (error) {
          Logger.log('Error fetching audit ' + searchResults.audits[i].audit_id + ': ' + error.toString());
          // Continue with other audits even if one fails
        }
      }
    }
    
    return {
      audits: audits,
      total: searchResults.total || audits.length,
      count: audits.length
    };
    
  } catch (error) {
    Logger.log('Error getting visit tracking data: ' + error.toString());
    return {
      error: error.toString(),
      audits: [],
      total: 0,
      count: 0
    };
  }
}

/**
 * Extract location name from audit data
 * @param {Object} audit - Audit data object
 * @returns {string} Location name or "Unknown"
 */
function extractLocation(audit) {
  if (audit.audit_data && audit.audit_data.site && audit.audit_data.site.name) {
    return audit.audit_data.site.name;
  }
  
  // Try to find location in header items
  if (audit.header_items) {
    const locationItem = audit.header_items.find(item => 
      item.label && item.label.toLowerCase().includes('location')
    );
    if (locationItem && locationItem.responses && locationItem.responses.selected) {
      // Location might be in selected responses
      return locationItem.responses.selected[0]?.label || "Unknown";
    }
  }
  
  return "Unknown";
}

/**
 * Extract user/author information from audit data
 * @param {Object} audit - Audit data object
 * @returns {Object} User information with name and ID
 */
function extractUser(audit) {
  // Try multiple possible locations for user information
  let userName = null;
  let userId = null;
  
  // Method 1: Check audit_data.authorship
  if (audit.audit_data && audit.audit_data.authorship) {
    userName = audit.audit_data.authorship.author || 
               audit.audit_data.authorship.owner || 
               audit.audit_data.authorship.created_by ||
               null;
    userId = audit.audit_data.authorship.author_id || 
             audit.audit_data.authorship.owner_id || 
             audit.audit_data.authorship.created_by_id ||
             null;
  }
  
  // Method 2: Check top-level authorship
  if (!userName && audit.authorship) {
    userName = audit.authorship.author || 
               audit.authorship.owner || 
               audit.authorship.created_by ||
               null;
    userId = audit.authorship.author_id || 
             audit.authorship.owner_id || 
             audit.authorship.created_by_id ||
             null;
  }
  
  // Method 3: Check audit_data.created_by or modified_by
  if (!userName && audit.audit_data) {
    userName = audit.audit_data.created_by || 
               audit.audit_data.modified_by ||
               null;
    userId = audit.audit_data.created_by_id || 
             audit.audit_data.modified_by_id ||
             null;
  }
  
  // Method 4: Check top-level created_by or modified_by
  if (!userName) {
    userName = audit.created_by || 
               audit.modified_by ||
               null;
    userId = audit.created_by_id || 
             audit.modified_by_id ||
             null;
  }
  
  // Method 5: Check owner field directly
  if (!userName && audit.owner) {
    userName = typeof audit.owner === 'string' ? audit.owner : (audit.owner.name || audit.owner.email || null);
    userId = audit.owner.id || audit.owner.user_id || null;
  }
  
  // Method 6: Check header items for user information
  if (!userName && audit.header_items) {
    const userItem = audit.header_items.find(item => 
      item.label && (
        item.label.toLowerCase().includes('user') ||
        item.label.toLowerCase().includes('inspector') ||
        item.label.toLowerCase().includes('author')
      )
    );
    if (userItem && userItem.responses) {
      if (userItem.responses.selected && userItem.responses.selected.length > 0) {
        userName = userItem.responses.selected[0].label || userItem.responses.selected[0].name || null;
      } else if (userItem.responses.text) {
        userName = userItem.responses.text;
      }
    }
  }
  
  return { 
    name: userName || "Unknown", 
    id: userId || null 
  };
}

/**
 * Extract role from audit data (if available)
 * @param {Object} audit - Audit data object
 * @returns {string} Role or "Unknown"
 */
function extractRole(audit) {
  // Try to find role in header items (Area Manager, Operator, etc.)
  if (audit.header_items) {
    const roleItem = audit.header_items.find(item => 
      item.label && (
        item.label.toLowerCase().includes('area manager') ||
        item.label.toLowerCase().includes('operator') ||
        item.label.toLowerCase().includes('technician') ||
        item.label.toLowerCase().includes('qc')
      )
    );
    if (roleItem) {
      return roleItem.label;
    }
  }
  
  // Check if user name contains role indicators
  const user = extractUser(audit);
  const userName = user.name.toLowerCase();
  
  if (userName.includes('ops') || userName.includes('operator')) return 'Ops';
  if (userName.includes('area') || userName.includes('manager')) return 'Area';
  if (userName.includes('qc') || userName.includes('quality')) return 'QC';
  if (userName.includes('tech') || userName.includes('technician')) return 'Technician';
  
  return "Unknown";
}

/**
 * Extract score from audit data
 * @param {Object} audit - Audit data object
 * @returns {number} Score or null
 */
function extractScore(audit) {
  // Try different possible score fields
  if (audit.audit_data) {
    if (audit.audit_data.score !== undefined && audit.audit_data.score !== null) {
      return audit.audit_data.score;
    }
    if (audit.audit_data.score_percentage !== undefined && audit.audit_data.score_percentage !== null) {
      return audit.audit_data.score_percentage;
    }
    if (audit.audit_data.total_score !== undefined && audit.audit_data.total_score !== null) {
      return audit.audit_data.total_score;
    }
  }
  if (audit.score !== undefined && audit.score !== null) {
    return audit.score;
  }
  if (audit.score_percentage !== undefined && audit.score_percentage !== null) {
    return audit.score_percentage;
  }
  return null;
}

/**
 * Get last visit tracking data - shows last visit date per role for each location
 * @returns {Object} Last visit data grouped by location and role
 */
function getLastVisitTracking() {
  try {
    // Search for audits from last 90 days to get recent visits
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const modifiedAfter = ninetyDaysAgo.toISOString();
    const modifiedBefore = now.toISOString();
    
    Logger.log('Searching for audits from ' + modifiedAfter + ' to ' + modifiedBefore);
    
    const searchFilters = {
      modified_after: modifiedAfter,
      modified_before: modifiedBefore
    };
    
    // Search for audits
    let searchResults;
    try {
      searchResults = searchSafetyCultureAudits(searchFilters);
    } catch (searchError) {
      Logger.log('Error searching for audits: ' + searchError.toString());
      return {
        error: 'Failed to search for audits: ' + searchError.toString(),
        visits: [],
        total: 0
      };
    }
    
    if (!searchResults) {
      Logger.log('Search results is null or undefined');
      return {
        error: 'No search results returned from API',
        visits: [],
        total: 0
      };
    }
    
    // Check if searchResults has the expected structure
    if (!searchResults.audits) {
      Logger.log('Search results does not have audits array. Search results structure: ' + JSON.stringify(Object.keys(searchResults || {})));
      // Try to handle different response structures
      if (Array.isArray(searchResults)) {
        Logger.log('Search results is an array, treating as audits list');
        searchResults = { audits: searchResults };
      } else {
        Logger.log('Search results structure: ' + JSON.stringify(searchResults).substring(0, 500));
        return {
          error: 'Unexpected search results structure from API',
          visits: [],
          total: 0
        };
      }
    }
    
    Logger.log('Found ' + (searchResults.audits ? searchResults.audits.length : 0) + ' audits in search results');
    
    // Group by location, role, and user to show ALL inspectors' last visits
    // Key: "location|role|userId", Value: { location, role, lastVisitDate, user, auditId }
    const locationRoleUserMap = {};
    
    if (searchResults.audits && searchResults.audits.length > 0) {
      // Process ALL audits to ensure no inspector's reports are missed
      // Increased from 500 to ensure Ismail and all other inspectors are included
      const auditIds = searchResults.audits.map(a => a.audit_id);
      Logger.log('Processing ' + auditIds.length + ' audits (all audits to ensure complete coverage)');
      
      let processedCount = 0;
      let skippedCount = 0;
      
      for (let i = 0; i < auditIds.length; i++) {
        try {
          const auditDetail = getSafetyCultureAudit(auditIds[i]);
          const location = extractLocation(auditDetail);
          const role = extractRole(auditDetail);
          const user = extractUser(auditDetail);
          
          // Get user info - use extracted user or fallback
          const userName = (user && user.name) ? user.name : 'Unknown';
          const userId = (user && user.id) ? user.id : null;
          
          // Skip if both location and user are unknown - likely not a valid audit
          if ((!location || location === 'Unknown') && (!userName || userName === 'Unknown')) {
            skippedCount++;
            continue;
          }
          
          // Use location or fallback to "Unknown" if we have a valid user
          const finalLocation = location && location !== 'Unknown' ? location : 'Unknown';
          
          // Log user extraction for debugging (only for first few audits to avoid spam)
          if (processedCount < 5) {
            Logger.log('Audit ' + auditIds[i] + ' - Location: ' + finalLocation + ', User: name=' + userName + ', id=' + userId + ', Role: ' + role);
          }
          
          // Get visit date (use modified_at or created_at)
          let visitDate = null;
          if (auditDetail.modified_at) {
            visitDate = new Date(auditDetail.modified_at);
          } else if (auditDetail.created_at) {
            visitDate = new Date(auditDetail.created_at);
          } else if (auditDetail.audit_data && auditDetail.audit_data.created_at) {
            visitDate = new Date(auditDetail.audit_data.created_at);
          } else if (auditDetail.audit_data && auditDetail.audit_data.date_completed) {
            visitDate = new Date(auditDetail.audit_data.date_completed);
          }
          
          if (!visitDate || isNaN(visitDate.getTime())) {
            skippedCount++;
            continue; // Skip if no valid date
          }
          
          // Include user ID in key to track each inspector separately
          // Use user ID if available, otherwise fall back to user name (normalized), or audit ID as last resort
          // Normalize user name to handle case differences (e.g., "Ismail" vs "ismail")
          // IMPORTANT: Use exact user name (case-insensitive comparison) to ensure Ismail and Harout are tracked separately
          const normalizedUserName = userName ? userName.toLowerCase().trim() : 'unknown';
          // Prefer userId, but if not available, use normalized name + audit_id to ensure uniqueness
          // This ensures Ismail and Harout are tracked separately even if userId is missing
          const userKey = userId || (normalizedUserName + '_' + (auditDetail.audit_id || 'unknown'));
          const key = finalLocation + '|' + role + '|' + userKey;
          
          // Log for debugging Ismail specifically
          if (userName && (userName.toLowerCase().includes('ismail') || userName.toLowerCase().includes('harout'))) {
            Logger.log('Processing inspector: ' + userName + ' (ID: ' + userId + ', Key: ' + userKey + ', Location: ' + finalLocation + ', Role: ' + role + ')');
          }
          
          // If we don't have this location-role-user combo, or this visit is more recent, update it
          if (!locationRoleUserMap[key] || visitDate > locationRoleUserMap[key].lastVisitDate) {
            locationRoleUserMap[key] = {
              location: finalLocation,
              role: role,
              lastVisitDate: visitDate,
              lastVisitDateStr: visitDate.toISOString().split('T')[0],
              user: userName,
              auditId: auditDetail.audit_id || null,
              daysSinceVisit: Math.floor((now - visitDate) / (1000 * 60 * 60 * 24))
            };
            processedCount++;
          }
        } catch (error) {
          Logger.log('Error processing audit ' + auditIds[i] + ' for last visit tracking: ' + error.toString());
          skippedCount++;
          // Continue with other audits
        }
      }
      
      Logger.log('Processed: ' + processedCount + ', Skipped: ' + skippedCount + ', Total location-role-user combos: ' + Object.keys(locationRoleUserMap).length);
    } else {
      Logger.log('No audits found in search results');
    }
    
    // Convert to array and sort by location, then role, then user
    const results = Object.values(locationRoleUserMap).sort((a, b) => {
      if (a.location !== b.location) {
        return a.location.localeCompare(b.location);
      }
      if (a.role !== b.role) {
        return a.role.localeCompare(b.role);
      }
      return a.user.localeCompare(b.user);
    });
    
    Logger.log('Returning ' + results.length + ' visit tracking results');
    
    // Always return a valid object structure, even if empty
    const response = {
      visits: results || [],
      total: results ? results.length : 0
    };
    
    // Log response for debugging
    Logger.log('Last visit tracking response: ' + JSON.stringify({
      total: response.total,
      sampleVisits: results.slice(0, 3).map(v => ({
        location: v.location,
        user: v.user,
        role: v.role,
        date: v.lastVisitDateStr
      }))
    }));
    
    return response;
    
  } catch (error) {
    Logger.log('Error getting last visit tracking: ' + error.toString());
    Logger.log('Error stack: ' + (error.stack || 'No stack trace'));
    return {
      error: error.toString(),
      visits: [],
      total: 0
    };
  }
}

/**
 * Get Safety Culture QA Comparison - compare today's report with the last visit report for each location
 * @returns {Object} Comparison data
 */
function getSafetyCultureQAComparison() {
  try {
    const now = new Date();
    
    // Get all audits from last 180 days to find current and last visit reports for each location
    const oneHundredEightyDaysAgo = new Date(now);
    oneHundredEightyDaysAgo.setDate(oneHundredEightyDaysAgo.getDate() - 180);
    
    const allSearchFilters = {
      modified_after: oneHundredEightyDaysAgo.toISOString(),
      modified_before: now.toISOString()
    };
    
    const allSearchResults = searchSafetyCultureAudits(allSearchFilters);
    
    // Process all audits to find current and last visit reports for each location
    // Group by location+role to show comparisons for each role separately (e.g., Ismail's QC visits vs Harout's QC visits)
    // Key: "location|role", Value: Array of { location, score, date, user, role, auditId } sorted by date (newest first)
    const locationRoleAuditsMap = {};
    
    if (allSearchResults.audits && allSearchResults.audits.length > 0) {
      // Process ALL audits to ensure complete coverage - no limit to ensure Ismail and all inspectors are included
      const auditIds = allSearchResults.audits.map(a => a.audit_id);
      Logger.log('Processing ' + auditIds.length + ' audits for QA comparison (all audits to ensure complete coverage)');
      
      for (let i = 0; i < auditIds.length; i++) {
        try {
          const auditDetail = getSafetyCultureAudit(auditIds[i]);
          const location = extractLocation(auditDetail);
          
          // Skip if location is "Unknown" - likely not a valid location
          if (!location || location === 'Unknown') {
            continue;
          }
          
          const score = extractScore(auditDetail);
          const user = extractUser(auditDetail);
          const role = extractRole(auditDetail);
          
          // Get visit date
          let visitDate = null;
          if (auditDetail.modified_at) {
            visitDate = new Date(auditDetail.modified_at);
          } else if (auditDetail.created_at) {
            visitDate = new Date(auditDetail.created_at);
          } else if (auditDetail.audit_data && auditDetail.audit_data.created_at) {
            visitDate = new Date(auditDetail.audit_data.created_at);
          } else if (auditDetail.audit_data && auditDetail.audit_data.date_completed) {
            visitDate = new Date(auditDetail.audit_data.date_completed);
          }
          
          if (!visitDate || isNaN(visitDate.getTime())) {
            continue;
          }
          
          // Group by location+role to show comparisons for each role separately
          // This ensures Ismail's QC visits are compared separately from Harout's QC visits
          const locationRoleKey = location + '|' + role;
          
          // Initialize array for this location+role combination if needed
          if (!locationRoleAuditsMap[locationRoleKey]) {
            locationRoleAuditsMap[locationRoleKey] = [];
          }
          
          // Add this audit to the location+role's array
          locationRoleAuditsMap[locationRoleKey].push({
              location: location,
              score: score,
              date: visitDate,
              dateStr: visitDate.toISOString().split('T')[0],
              user: user.name,
              role: role,
              auditId: auditDetail.audit_id
          });
        } catch (error) {
          Logger.log('Error processing audit for QA comparison: ' + error.toString());
        }
      }
    }
    
    // For each location+role combination, find current report (most recent) and last visit report (second most recent)
    // This ensures Ismail's reports are compared separately from Harout's reports
    const comparisons = [];
    
    Object.keys(locationRoleAuditsMap).forEach(locationRoleKey => {
      const audits = locationRoleAuditsMap[locationRoleKey];
      // Extract location from key (format: "location|role")
      const location = locationRoleKey.split('|')[0];
      
      // Sort by date descending (newest first)
      audits.sort((a, b) => b.date - a.date);
      
      // Find current report (most recent report - the first one in sorted array)
      let currentReport = audits.length > 0 ? audits[0] : null;
      
      // Find last visit report (second most recent report, if it exists)
      let lastVisitReport = audits.length > 1 ? audits[1] : null;
      
      // Calculate comparison metrics
      let scoreChange = null;
      let scoreChangePercent = null;
      let trend = 'no_change'; // 'improved', 'declined', 'no_change', 'no_previous'
      
      if (currentReport && lastVisitReport) {
        if (currentReport.score !== null && lastVisitReport.score !== null) {
          scoreChange = currentReport.score - lastVisitReport.score;
          if (lastVisitReport.score > 0) {
            scoreChangePercent = ((scoreChange / lastVisitReport.score) * 100);
          }
          
          // Determine trend
          if (scoreChange > 0.1) { // Small threshold to account for rounding
            trend = 'improved';
          } else if (scoreChange < -0.1) {
            trend = 'declined';
          } else {
            trend = 'no_change';
          }
        } else {
          trend = 'no_score';
        }
      } else if (currentReport && !lastVisitReport) {
        trend = 'no_previous';
      } else if (!currentReport && lastVisitReport) {
        trend = 'no_current';
      }
      
      const daysSinceCurrent = currentReport 
        ? Math.floor((now - currentReport.date) / (1000 * 60 * 60 * 24))
        : null;
      
      const daysSinceLastVisit = lastVisitReport
        ? Math.floor((now - lastVisitReport.date) / (1000 * 60 * 60 * 24))
        : null;
      
      comparisons.push({
        location: location,
        role: audits.length > 0 ? audits[0].role : 'Unknown',
        current: currentReport ? {
          score: currentReport.score,
          user: currentReport.user,
          role: currentReport.role,
          date: currentReport.dateStr,
          auditId: currentReport.auditId,
          daysAgo: daysSinceCurrent
        } : null,
        lastVisit: lastVisitReport ? {
          score: lastVisitReport.score,
          user: lastVisitReport.user,
          role: lastVisitReport.role,
          date: lastVisitReport.dateStr,
          auditId: lastVisitReport.auditId,
          daysAgo: daysSinceLastVisit
        } : null,
        comparison: {
          scoreChange: scoreChange,
          scoreChangePercent: scoreChangePercent,
          trend: trend,
          daysSinceCurrent: daysSinceCurrent,
          daysSinceLastVisit: daysSinceLastVisit
        }
      });
    });
    
    // Sort by location, then role, then user
    comparisons.sort((a, b) => {
      if (a.location !== b.location) {
        return a.location.localeCompare(b.location);
      }
      if (a.role !== b.role) {
        return a.role.localeCompare(b.role);
      }
      const aUser = a.current ? a.current.user : (a.lastVisit ? a.lastVisit.user : '');
      const bUser = b.current ? b.current.user : (b.lastVisit ? b.lastVisit.user : '');
      return aUser.localeCompare(bUser);
    });
    
    return {
      comparisons: comparisons,
      totalLocations: comparisons.length,
      locationsWithComparison: comparisons.filter(c => c.current !== null && c.lastVisit !== null).length
    };
    
  } catch (error) {
    Logger.log('Error getting Safety Culture QA comparison: ' + error.toString());
    return {
      error: error.toString(),
      comparisons: [],
      totalLocations: 0,
      locationsWithComparison: 0
    };
  }
}

