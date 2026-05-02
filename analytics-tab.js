function fetchProductAnalytics(filters) {
  const machineId = filters && filters.machineId ? filters.machineId : null;
  const startDate = filters && filters.startDate ? filters.startDate : null;
  const endDate = filters && filters.endDate ? filters.endDate : null;
  
  // Default to today if no dates provided
  // Vendon uses clock from 00:00 to 23:59, so we need to set proper day boundaries
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  let fromTimestamp = Math.floor(todayStart.getTime() / 1000);
  let toTimestamp = Math.floor(todayEnd.getTime() / 1000);
  
  // Convert date strings to timestamps if provided
  // Match the approach used in fetchHistoricalPerformanceData for consistency
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    fromTimestamp = Math.floor(start.getTime() / 1000);
  }
  if (endDate) {
    // Use start of next day as exclusive end timestamp to match Vendon's day boundaries
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1); // Next day
    end.setHours(0, 0, 0, 0); // Start of next day
    toTimestamp = Math.floor(end.getTime() / 1000);
  }
  
  // Log timestamps for debugging
  console.log("📅 Product Analytics - Date range:", startDate || "today", "to", endDate || "today");
  console.log("📅 Timestamps:", fromTimestamp, "to", toTimestamp);
  console.log("📅 Date objects:", new Date(fromTimestamp * 1000), "to", new Date(toTimestamp * 1000));
  
  // Fetch all vends with pagination to handle cases with more than 10,000 records
  const limit = 10000;
  let offset = 0;
  let hasMore = true;
  const allVends = [];
  const maxIterations = 50; // Safety limit
  let iteration = 0;
  
  while (hasMore && iteration < maxIterations) {
    iteration++;
    let url = `${API_BASE}/stats/vends?from_timestamp=${fromTimestamp}&to_timestamp=${toTimestamp}&limit=${limit}&offset=${offset}`;
    if (machineId) {
      url += `&machine_id=${machineId}`;
    }
    
    const options = {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const text = response.getContentText();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Vendon response not JSON: " + text);
    }
    
    if (json.code !== 200) {
      throw new Error("API error " + json.code + ": " + text);
    }
    
    if (!json.result || json.result.length === 0) {
      hasMore = false;
      break;
    }
    
    allVends.push(...json.result);
    
    // Check if there's more data
    if (json.result.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
      // Small delay to avoid rate limiting
      Utilities.sleep(200);
    }
  }
  
  if (iteration >= maxIterations) {
    console.warn("⚠️ Reached max iterations in fetchProductAnalytics, may have more data");
  }
  
  if (allVends.length === 0) {
    return {
      byRevenue: [],
      byQuantity: [],
      lowestByRevenue: [],
      lowestByQuantity: [],
      totalRevenue: 0,
      totalQuantity: 0,
      uniqueProducts: 0,
      insights: {
        avgRevenuePerProduct: 0,
        avgQuantityPerProduct: 0,
        topProductRevenue: 0,
        topProductQuantity: 0,
        lowestProductRevenue: 0,
        lowestProductQuantity: 0,
        revenueConcentration: 0,
        quantityConcentration: 0
      }
    };
  }
  
  // Aggregate products by name
  // Filter to match Vendon's sales report: exclude zero/negative prices and verify datetime is within range
  const productStats = {};
  // Use the same date boundaries we used for the API call
  const startDateObj = new Date(fromTimestamp * 1000);
  const endDateObj = new Date(toTimestamp * 1000);
  
  allVends.forEach(vend => {
    const productName = vend.name || "Unknown Product";
    const price = vend.price || 0;
    
    // Exclude zero or negative prices (returns, refunds, test transactions)
    if (price <= 0) {
      return;
    }
    
    // Verify transaction datetime is within the selected date range
    // Vendon's API might return some records slightly outside the range
    let vendDate = null;
    if (vend.datetime) {
      vendDate = typeof vend.datetime === 'number' ? new Date(vend.datetime * 1000) : new Date(vend.datetime);
    } else if (vend.time) {
      vendDate = new Date(vend.time);
    } else if (vend.timestamp) {
      vendDate = typeof vend.timestamp === 'number' ? new Date(vend.timestamp * 1000) : new Date(vend.timestamp);
    }
    
    if (vendDate && (vendDate < startDateObj || vendDate >= endDateObj)) {
      // Transaction is outside the date range, skip it (endDateObj is exclusive - start of next day)
      return;
    }
    
    if (!productStats[productName]) {
      productStats[productName] = {
        name: productName,
        revenue: 0,
        quantity: 0
      };
    }
    
    productStats[productName].revenue += price;
    productStats[productName].quantity += 1;
  });
  
  // Log summary for debugging
  const totalVends = allVends.length;
  const debugTotalRevenue = Object.values(productStats).reduce((sum, p) => sum + p.revenue, 0);
  const debugTotalQuantity = Object.values(productStats).reduce((sum, p) => sum + p.quantity, 0);
  console.log("📊 Product Analytics - Total vends:", totalVends, "Total revenue:", debugTotalRevenue.toFixed(2), "Total quantity:", debugTotalQuantity);
  
  // Convert to arrays and sort
  const productsArray = Object.values(productStats);
  
  // Sort by revenue (descending)
  const byRevenue = productsArray
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      revenue: p.revenue,
      quantity: p.quantity
    }));
  
  // Sort by quantity (descending)
  const byQuantity = productsArray
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      revenue: p.revenue,
      quantity: p.quantity
    }));
  
  // Sort by revenue (ascending) - lowest selling
  const lowestByRevenue = productsArray
    .sort((a, b) => a.revenue - b.revenue)
    .slice(0, 10)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      revenue: p.revenue,
      quantity: p.quantity
    }));
  
  // Sort by quantity (ascending) - lowest selling
  const lowestByQuantity = productsArray
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 10)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      revenue: p.revenue,
      quantity: p.quantity
    }));
  
  // Calculate totals and insights
  const totalRevenue = productsArray.reduce((sum, p) => sum + p.revenue, 0);
  const totalQuantity = productsArray.reduce((sum, p) => sum + p.quantity, 0);
  const uniqueProducts = productsArray.length;
  
  // Calculate insights
  const avgRevenuePerProduct = uniqueProducts > 0 ? totalRevenue / uniqueProducts : 0;
  const avgQuantityPerProduct = uniqueProducts > 0 ? totalQuantity / uniqueProducts : 0;
  const topProductRevenue = byRevenue.length > 0 ? byRevenue[0].revenue : 0;
  const topProductQuantity = byQuantity.length > 0 ? byQuantity[0].quantity : 0;
  const lowestProductRevenue = lowestByRevenue.length > 0 ? lowestByRevenue[0].revenue : 0;
  const lowestProductQuantity = lowestByQuantity.length > 0 ? lowestByQuantity[0].quantity : 0;
  
  // Calculate revenue concentration (top 10 products as % of total)
  const top10Revenue = byRevenue.reduce((sum, p) => sum + p.revenue, 0);
  const revenueConcentration = totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0;
  
  // Calculate quantity concentration
  const top10Quantity = byQuantity.reduce((sum, p) => sum + p.quantity, 0);
  const quantityConcentration = totalQuantity > 0 ? (top10Quantity / totalQuantity) * 100 : 0;
  
  // Calculate performance scores (revenue per transaction = efficiency)
  productsArray.forEach(p => {
    p.performanceScore = p.quantity > 0 ? (p.revenue / p.quantity) : 0;
    p.revenuePerTransaction = p.performanceScore;
  });
  
  // Sort by performance score (descending) - highest efficiency
  const byPerformance = productsArray
    .filter(p => p.quantity > 0) // Only products with sales
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, 10)
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      revenue: p.revenue,
      quantity: p.quantity,
      performanceScore: p.performanceScore,
      revenuePerTransaction: p.performanceScore
    }));
  
  // Find top performance product and best-selling product
  const topPerformanceProduct = byPerformance.length > 0 ? byPerformance[0] : null;
  const bestSellingProduct = byRevenue.length > 0 ? byRevenue[0] : null;
  
  // Calculate comparison metrics
  let performanceVsSales = null;
  if (topPerformanceProduct && bestSellingProduct) {
    const isSameProduct = topPerformanceProduct.name === bestSellingProduct.name;
    const revenueGap = bestSellingProduct.revenue - topPerformanceProduct.revenue;
    const quantityGap = bestSellingProduct.quantity - topPerformanceProduct.quantity;
    const performanceGap = topPerformanceProduct.performanceScore - (bestSellingProduct.revenue / bestSellingProduct.quantity);
    
    performanceVsSales = {
      isSameProduct: isSameProduct,
      topPerformance: {
        name: topPerformanceProduct.name,
        revenue: topPerformanceProduct.revenue,
        quantity: topPerformanceProduct.quantity,
        performanceScore: topPerformanceProduct.performanceScore
      },
      bestSelling: {
        name: bestSellingProduct.name,
        revenue: bestSellingProduct.revenue,
        quantity: bestSellingProduct.quantity,
        performanceScore: bestSellingProduct.quantity > 0 ? (bestSellingProduct.revenue / bestSellingProduct.quantity) : 0
      },
      gaps: {
        revenueGap: revenueGap,
        quantityGap: quantityGap,
        performanceGap: performanceGap
      },
      insights: {
        revenueGapPercent: bestSellingProduct.revenue > 0 ? ((revenueGap / bestSellingProduct.revenue) * 100) : 0,
        performanceGapPercent: topPerformanceProduct.performanceScore > 0 ? ((performanceGap / topPerformanceProduct.performanceScore) * 100) : 0
      }
    };
  }
  
  return {
    byRevenue: byRevenue,
    byQuantity: byQuantity,
    byPerformance: byPerformance,
    lowestByRevenue: lowestByRevenue,
    lowestByQuantity: lowestByQuantity,
    totalRevenue: totalRevenue,
    totalQuantity: totalQuantity,
    uniqueProducts: uniqueProducts,
    performanceVsSales: performanceVsSales,
    insights: {
      avgRevenuePerProduct: avgRevenuePerProduct,
      avgQuantityPerProduct: avgQuantityPerProduct,
      topProductRevenue: topProductRevenue,
      topProductQuantity: topProductQuantity,
      lowestProductRevenue: lowestProductRevenue,
      lowestProductQuantity: lowestProductQuantity,
      revenueConcentration: revenueConcentration,
      quantityConcentration: quantityConcentration
    },
    dateRange: {
      from: fromTimestamp,
      to: toTimestamp
    }
  };
}

function fetchLocationRevenue(filters) {
  const startDate = filters && filters.startDate ? filters.startDate : null;
  const endDate = filters && filters.endDate ? filters.endDate : null;
  
  // Default to today if no dates provided
  // Vendon uses clock from 00:00 to 23:59, so we need to set proper day boundaries
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  let fromTimestamp = Math.floor(todayStart.getTime() / 1000);
  let toTimestamp = Math.floor(todayEnd.getTime() / 1000);
  
  // Convert date strings to timestamps if provided
  // Match the approach used in fetchHistoricalPerformanceData for consistency
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    fromTimestamp = Math.floor(start.getTime() / 1000);
  }
  if (endDate) {
    // Use start of next day as exclusive end timestamp to match Vendon's day boundaries
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1); // Next day
    end.setHours(0, 0, 0, 0); // Start of next day
    toTimestamp = Math.floor(end.getTime() / 1000);
  }
  
  // Log timestamps for debugging
  console.log("📅 Product Analytics - Date range:", startDate || "today", "to", endDate || "today");
  console.log("📅 Timestamps:", fromTimestamp, "to", toTimestamp);
  console.log("📅 Date objects:", new Date(fromTimestamp * 1000), "to", new Date(toTimestamp * 1000));
  
  // Fetch all machines to get names
  const machines = fetchMachines();
  const machineMap = {};
  machines.forEach(m => {
    machineMap[m.id] = m.name;
  });
  
  // Fetch all vends for the date range
  const url = `${API_BASE}/stats/vends?from_timestamp=${fromTimestamp}&to_timestamp=${toTimestamp}&limit=10000`;
  
  const options = {
    method: "get",
    headers: { "Authorization": "Token " + API_KEY },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const text = response.getContentText();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("Vendon response not JSON: " + text);
  }
  
  if (json.code !== 200) {
    throw new Error("API error " + json.code + ": " + text);
  }
  
  if (!json.result || json.result.length === 0) {
    return {
      locations: []
    };
  }
  
  // Aggregate by machine_id (location)
  const locationStats = {};
  
  json.result.forEach(vend => {
    const machineId = vend.machine_id;
    const locationName = machineMap[machineId] || vend.machine_name || `Machine ${machineId}`;
    const price = vend.price || 0;
    
    if (!locationStats[locationName]) {
      locationStats[locationName] = {
        name: locationName,
        machine_id: machineId,
        revenue: 0,
        quantity: 0,
        transactions: 0
      };
    }
    
    locationStats[locationName].revenue += price;
    locationStats[locationName].quantity += 1;
    locationStats[locationName].transactions += 1;
  });
  
  // Convert to array and sort by revenue (descending)
  const locationsArray = Object.values(locationStats)
    .sort((a, b) => b.revenue - a.revenue)
    .map((loc, index) => ({
      ...loc,
      rank: index + 1
    }));
  
  return {
    locations: locationsArray,
    dateRange: {
      from: fromTimestamp,
      to: toTimestamp
    }
  };
}

function fetchWeeklySalesComparison(filters) {
  try {
    // Get all machines to get names
    const machines = fetchMachines();
    const machineMap = {};
    machines.forEach(m => {
      machineMap[m.id] = m.name;
    });
    
    // Calculate this week and last week date ranges
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // This week: Monday to Sunday (or today if it's earlier in the week)
    const thisWeekStart = new Date(today);
    const dayOfWeek = today.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 6 days from Monday
    thisWeekStart.setDate(today.getDate() - daysFromMonday);
    thisWeekStart.setHours(0, 0, 0, 0);
    
    const thisWeekEnd = new Date(now);
    
    // Last week: same days but 7 days earlier
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    
    const lastWeekEnd = new Date(thisWeekEnd);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);
    lastWeekEnd.setHours(23, 59, 59, 999);
    
    // Convert to timestamps
    const thisWeekStartTs = Math.floor(thisWeekStart.getTime() / 1000);
    const thisWeekEndTs = Math.floor(thisWeekEnd.getTime() / 1000);
    const lastWeekStartTs = Math.floor(lastWeekStart.getTime() / 1000);
    const lastWeekEndTs = Math.floor(lastWeekEnd.getTime() / 1000);
    
    // Fetch sales for this week
    const thisWeekUrl = `${API_BASE}/stats/vends?from_timestamp=${thisWeekStartTs}&to_timestamp=${thisWeekEndTs}&limit=10000`;
    const thisWeekResponse = UrlFetchApp.fetch(thisWeekUrl, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    let thisWeekData = { result: [] };
    if (thisWeekResponse.getResponseCode() === 200) {
      try {
        thisWeekData = JSON.parse(thisWeekResponse.getContentText());
        if (thisWeekData.code !== 200) {
          thisWeekData = { result: [] };
        }
      } catch (e) {
        console.error("Error parsing this week data:", e);
      }
    }
    
    // Fetch sales for last week
    const lastWeekUrl = `${API_BASE}/stats/vends?from_timestamp=${lastWeekStartTs}&to_timestamp=${lastWeekEndTs}&limit=10000`;
    const lastWeekResponse = UrlFetchApp.fetch(lastWeekUrl, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    let lastWeekData = { result: [] };
    if (lastWeekResponse.getResponseCode() === 200) {
      try {
        lastWeekData = JSON.parse(lastWeekResponse.getContentText());
        if (lastWeekData.code !== 200) {
          lastWeekData = { result: [] };
        }
      } catch (e) {
        console.error("Error parsing last week data:", e);
      }
    }
    
    // Aggregate by location for this week
    const thisWeekStats = {};
    if (thisWeekData.result && Array.isArray(thisWeekData.result)) {
      thisWeekData.result.forEach(vend => {
        const machineId = vend.machine_id;
        const locationName = machineMap[machineId] || vend.machine_name || `Machine ${machineId}`;
        const price = vend.price || 0;
        
        if (!thisWeekStats[locationName]) {
          thisWeekStats[locationName] = {
            name: locationName,
            machine_id: machineId,
            revenue: 0,
            quantity: 0
          };
        }
        
        thisWeekStats[locationName].revenue += price;
        thisWeekStats[locationName].quantity += 1;
      });
    }
    
    // Aggregate by location for last week
    const lastWeekStats = {};
    if (lastWeekData.result && Array.isArray(lastWeekData.result)) {
      lastWeekData.result.forEach(vend => {
        const machineId = vend.machine_id;
        const locationName = machineMap[machineId] || vend.machine_name || `Machine ${machineId}`;
        const price = vend.price || 0;
        
        if (!lastWeekStats[locationName]) {
          lastWeekStats[locationName] = {
            name: locationName,
            machine_id: machineId,
            revenue: 0,
            quantity: 0
          };
        }
        
        lastWeekStats[locationName].revenue += price;
        lastWeekStats[locationName].quantity += 1;
      });
    }
    
    // Combine and calculate comparisons
    const allLocations = new Set([
      ...Object.keys(thisWeekStats),
      ...Object.keys(lastWeekStats)
    ]);
    
    const comparisons = Array.from(allLocations).map(locationName => {
      const thisWeek = thisWeekStats[locationName] || { revenue: 0, quantity: 0 };
      const lastWeek = lastWeekStats[locationName] || { revenue: 0, quantity: 0 };
      
      const revenueChange = thisWeek.revenue - lastWeek.revenue;
      const quantityChange = thisWeek.quantity - lastWeek.quantity;
      
      const revenueChangePercent = lastWeek.revenue > 0 
        ? ((revenueChange / lastWeek.revenue) * 100) 
        : (thisWeek.revenue > 0 ? 100 : 0);
      
      const quantityChangePercent = lastWeek.quantity > 0 
        ? ((quantityChange / lastWeek.quantity) * 100) 
        : (thisWeek.quantity > 0 ? 100 : 0);
      
      return {
        name: locationName,
        machine_id: thisWeek.machine_id || lastWeek.machine_id,
        thisWeek: {
          revenue: thisWeek.revenue,
          quantity: thisWeek.quantity
        },
        lastWeek: {
          revenue: lastWeek.revenue,
          quantity: lastWeek.quantity
        },
        change: {
          revenue: revenueChange,
          quantity: quantityChange,
          revenuePercent: revenueChangePercent,
          quantityPercent: quantityChangePercent
        }
      };
    });
    
    // Sort by revenue change (descending)
    comparisons.sort((a, b) => b.change.revenuePercent - a.change.revenuePercent);
    
    // Calculate summary
    const totalThisWeekRevenue = Object.values(thisWeekStats).reduce((sum, loc) => sum + loc.revenue, 0);
    const totalLastWeekRevenue = Object.values(lastWeekStats).reduce((sum, loc) => sum + loc.revenue, 0);
    const totalRevenueChange = totalThisWeekRevenue - totalLastWeekRevenue;
    const totalRevenueChangePercent = totalLastWeekRevenue > 0 
      ? ((totalRevenueChange / totalLastWeekRevenue) * 100) 
      : 0;
    
    const totalThisWeekQuantity = Object.values(thisWeekStats).reduce((sum, loc) => sum + loc.quantity, 0);
    const totalLastWeekQuantity = Object.values(lastWeekStats).reduce((sum, loc) => sum + loc.quantity, 0);
    const totalQuantityChange = totalThisWeekQuantity - totalLastWeekQuantity;
    const totalQuantityChangePercent = totalLastWeekQuantity > 0 
      ? ((totalQuantityChange / totalLastWeekQuantity) * 100) 
      : 0;
    
    return {
      comparisons: comparisons,
      summary: {
        thisWeek: {
          revenue: totalThisWeekRevenue,
          quantity: totalThisWeekQuantity
        },
        lastWeek: {
          revenue: totalLastWeekRevenue,
          quantity: totalLastWeekQuantity
        },
        change: {
          revenue: totalRevenueChange,
          quantity: totalQuantityChange,
          revenuePercent: totalRevenueChangePercent,
          quantityPercent: totalQuantityChangePercent
        }
      },
      dateRanges: {
        thisWeek: {
          start: thisWeekStartTs,
          end: thisWeekEndTs,
          startDate: thisWeekStart.toISOString().split('T')[0],
          endDate: thisWeekEnd.toISOString().split('T')[0]
        },
        lastWeek: {
          start: lastWeekStartTs,
          end: lastWeekEndTs,
          startDate: lastWeekStart.toISOString().split('T')[0],
          endDate: lastWeekEnd.toISOString().split('T')[0]
        }
      }
    };
  } catch (error) {
    console.error("Error fetching weekly sales comparison:", error);
    return {
      comparisons: [],
      summary: null,
      error: error.toString()
    };
  }
}

function fetchComparisonData(filters) {
  try {
    const machineRanges = filters && filters.machineRanges ? filters.machineRanges : [];
    
    if (!machineRanges || machineRanges.length === 0) {
      return {
        comparisons: [],
        summary: null,
        error: "No machines with date ranges provided"
      };
    }
    
    // Get all machines to get names
    const machines = fetchMachines();
    const machineMap = {};
    machines.forEach(m => {
      machineMap[m.id] = m.name;
    });
    
    // Convert date strings to timestamps
    const convertToTimestamp = (dateStr, isEnd = false) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      if (isEnd) {
        date.setHours(23, 59, 59, 999);
      } else {
        date.setHours(0, 0, 0, 0);
      }
      return Math.floor(date.getTime() / 1000);
    };
    
    // Fetch data for each machine with its date range
    const fetchVendsForMachine = (machineId, fromTs, toTs, retryCount = 0) => {
      let url = `${API_BASE}/stats/vends?from_timestamp=${fromTs}&to_timestamp=${toTs}&machine_id=${machineId}&limit=10000`;
      
      const options = {
        method: "get",
        headers: { "Authorization": "Token " + API_KEY },
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const text = response.getContentText();
      
      // Handle rate limiting (429)
      if (responseCode === 429) {
        if (retryCount < 3) {
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          Utilities.sleep(waitTime);
          return fetchVendsForMachine(machineId, fromTs, toTs, retryCount + 1);
        } else {
          throw new Error("Rate limit exceeded. Please try again in a few moments.");
        }
      }
      
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("Error parsing response for machine " + machineId + ": " + text);
        if (responseCode !== 200) {
          throw new Error("API returned status " + responseCode + ": " + text.substring(0, 200));
        }
        return [];
      }
      
      if (json.code === 200 && json.result) {
        return json.result;
      } else if (json.code) {
        throw new Error("API error " + json.code + ": " + (json.message || text.substring(0, 200)));
      }
      return [];
    };
    
    // Fetch and aggregate data for each machine
    // Use index as key to handle same machine multiple times (self-comparison)
    const machineStats = {};
    
    for (let index = 0; index < machineRanges.length; index++) {
      const machineRange = machineRanges[index];
      const machineId = String(machineRange.machineId);
      const fromTs = convertToTimestamp(machineRange.startDate);
      const toTs = convertToTimestamp(machineRange.endDate, true);
      
      if (!fromTs || !toTs) {
        console.error("Invalid date range for machine " + machineId);
        continue;
      }
      
      try {
        // Add delay between requests to avoid rate limiting (except for first request)
        if (index > 0) {
          Utilities.sleep(500); // 500ms delay between requests
        }
        
        const vends = fetchVendsForMachine(machineId, fromTs, toTs);
        const machineName = machineMap[machineId] || `Machine ${machineId}`;
        
        // Use index as key to allow same machine multiple times
        const statKey = `${machineId}_${index}`;
        
        machineStats[statKey] = {
          machine_id: machineId,
          machine_name: machineName,
          revenue: 0,
          quantity: 0,
          products: {},
          startDate: machineRange.startDate,
          endDate: machineRange.endDate,
          index: index
        };
        
        vends.forEach(vend => {
          const price = vend.price || 0;
          const productName = vend.name || "Unknown Product";
          
          machineStats[statKey].revenue += price;
          machineStats[statKey].quantity += 1;
          
          if (!machineStats[statKey].products[productName]) {
            machineStats[statKey].products[productName] = {
              name: productName,
              revenue: 0,
              quantity: 0
            };
          }
          machineStats[statKey].products[productName].revenue += price;
          machineStats[statKey].products[productName].quantity += 1;
        });
      } catch (error) {
        console.error("Error fetching data for machine " + machineId + ": " + error.toString());
        // Continue with other machines even if one fails
        const machineName = machineMap[machineId] || `Machine ${machineId}`;
        const statKey = `${machineId}_${index}`;
        machineStats[statKey] = {
          machine_id: machineId,
          machine_name: machineName,
          revenue: 0,
          quantity: 0,
          products: {},
          startDate: machineRange.startDate,
          endDate: machineRange.endDate,
          index: index,
          error: error.toString()
        };
      }
    }
    
    // Get top products for each machine
    const getTopProducts = (products, limit = 10) => {
      const productsArray = Object.values(products);
      return productsArray
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit)
        .map((p, index) => ({
          rank: index + 1,
          name: p.name,
          revenue: p.revenue,
          quantity: p.quantity
        }));
    };
    
    // Build comparison results - preserve order from machineRanges
    const comparisons = machineRanges.map((mr, index) => {
      const statKey = `${String(mr.machineId)}_${index}`;
      const stat = machineStats[statKey];
      if (!stat) {
        return {
          machine_id: mr.machineId,
          machine_name: machineMap[mr.machineId] || `Machine ${mr.machineId}`,
          revenue: 0,
          quantity: 0,
          topProducts: [],
          dateRange: {
            startDate: mr.startDate,
            endDate: mr.endDate
          }
        };
      }
      return {
        machine_id: stat.machine_id,
        machine_name: stat.machine_name,
        revenue: stat.revenue,
        quantity: stat.quantity,
        topProducts: getTopProducts(stat.products),
        dateRange: {
          startDate: stat.startDate,
          endDate: stat.endDate
        }
      };
    });
    
    // Sort by revenue (descending)
    comparisons.sort((a, b) => b.revenue - a.revenue);
    
    // Calculate totals
    const totalRevenue = comparisons.reduce((sum, c) => sum + c.revenue, 0);
    const totalQuantity = comparisons.reduce((sum, c) => sum + c.quantity, 0);
    
    return {
      comparisons: comparisons,
      summary: {
        totalRevenue: totalRevenue,
        totalQuantity: totalQuantity,
        machineCount: comparisons.length
      }
    };
  } catch (error) {
    console.error("Error fetching comparison data:", error);
    return {
      comparisons: [],
      summary: null,
      error: error.toString()
    };
  }
}

function fetchTargetsData(filters) {
  try {
    const machineId = filters && filters.machineId ? String(filters.machineId) : null;
    const yesterday = filters && filters.yesterday ? filters.yesterday : null;
    const searchStartDate = filters && filters.searchStartDate ? filters.searchStartDate : null; // Optional: for period best day
    const searchEndDate = filters && filters.searchEndDate ? filters.searchEndDate : null; // Optional: for period best day
    
    if (!machineId || !yesterday) {
      return {
        error: "Missing required parameters: machineId, yesterday"
      };
    }
    
    // Check cache first (cache for 5 minutes - targets data changes daily)
    const cacheKey = `targets_data_${machineId}_${yesterday}`;
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log(`✅ Using cached targets data for machine ${machineId} on ${yesterday}`);
      return cached;
    }
    
    // Get all machines
    const machines = fetchMachines();
    const machineMap = {};
    machines.forEach(m => {
      machineMap[m.id] = m.name;
    });

    // Load fixed all‑time best day baseline from JSON file
    const baselineMap = getBestDayBaselineMap();
    const baselineForMachine = baselineMap[String(machineId)] || null;
    
    // Diagnostic logging
    const baselineEntryCount = Object.keys(baselineMap).length;
    console.log(`📊 Baseline diagnostic for machine ${machineId}:`);
    console.log(`  - Baseline map has ${baselineEntryCount} entries`);
    console.log(`  - Looking for machine ID: "${String(machineId)}"`);
    console.log(`  - Available machine IDs in baseline: ${Object.keys(baselineMap).join(', ') || '(none)'}`);
    
    if (baselineEntryCount === 0) {
      console.error(`❌ CRITICAL: Baseline file is empty or doesn't exist!`);
      console.error(`   → Solution: Use the "Baseline Builder" tab to build the baseline data first.`);
    } else if (!baselineForMachine) {
      console.warn(`⚠️ No baseline data found for machine ${machineId}.`);
      console.warn(`   → This machine hasn't been added to the baseline yet.`);
      console.warn(`   → Solution: Use the "Baseline Builder" tab to add this machine to the baseline.`);
    } else {
      console.log(`  ✅ Found baseline: ${baselineForMachine.bestDate} - ${baselineForMachine.bestRevenue} KWD`);
    }
    
    // Find best machine overall (highest revenue in baseline)
    let bestMachineOverall = null;
    let bestMachineRevenue = 0;
    Object.keys(baselineMap).forEach(mId => {
      const entry = baselineMap[mId];
      const revenue = Number(entry.bestRevenue) || 0;
      if (revenue > bestMachineRevenue) {
        bestMachineRevenue = revenue;
        bestMachineOverall = entry;
      }
    });
    
    // SIMPLE: Get 2nd largest number from baseline JSON file
    // Get all best day values, sort them, take the 2nd largest
    let secondBestDayForBestMachine = null;
    
    try {
      // Get all best day revenues from baseline
      const allBestDays = [];
      Object.keys(baselineMap).forEach(mId => {
        const entry = baselineMap[mId];
        const revenue = Number(entry.bestRevenue) || 0;
        if (revenue > 0) {
          allBestDays.push({
            machineId: mId,
            machineName: entry.machineName || machineMap[mId] || `Machine ${mId}`,
            date: entry.bestDate,
            revenue: revenue
          });
        }
      });
      
      // Sort by revenue descending
      allBestDays.sort((a, b) => b.revenue - a.revenue);
      
      console.log(`📊 Found ${allBestDays.length} machines with best day data in baseline`);
      console.log(`📊 Top 5 best days from baseline (BEFORE filtering buggy value):`);
      allBestDays.slice(0, 5).forEach((day, idx) => {
        console.log(`  ${idx + 1}. ${day.machineName} - ${day.date}: ${day.revenue.toFixed(2)} KWD`);
      });
      
      // CRITICAL: Filter out the buggy value (725.60 on 2025-03-23) BEFORE taking 2nd largest
      const filteredBestDays = allBestDays.filter(day => {
        const isBuggy = (day.date === '2025-03-23' && day.revenue === 725.60) || day.revenue === 725.60;
        if (isBuggy) {
          console.log(`🗑️ Filtering out buggy value: ${day.machineName} - ${day.date}: ${day.revenue.toFixed(2)} KWD`);
        }
        return !isBuggy;
      });
      
      console.log(`📊 After filtering buggy value: ${filteredBestDays.length} valid entries (removed ${allBestDays.length - filteredBestDays.length})`);
      console.log(`📊 Top 5 best days from baseline (AFTER filtering):`);
      filteredBestDays.slice(0, 5).forEach((day, idx) => {
        console.log(`  ${idx + 1}. ${day.machineName} - ${day.date}: ${day.revenue.toFixed(2)} KWD`);
      });
      
      // Get the 2nd largest (index 1) AFTER filtering out buggy value
      if (filteredBestDays.length > 1) {
        const secondBest = filteredBestDays[1]; // Index 1 = 2nd largest number (excluding buggy value)
        secondBestDayForBestMachine = {
          date: secondBest.date,
          revenue: secondBest.revenue,
          machineId: secondBest.machineId,
          machineName: secondBest.machineName
        };
        
        console.log(`✅ Found 2nd largest from baseline (after filtering buggy value): ${secondBest.machineName} - ${secondBest.date} with ${secondBest.revenue.toFixed(2)} KWD`);
      } else if (filteredBestDays.length === 1) {
        // Only one valid entry after filtering, use it
        const best = filteredBestDays[0];
        secondBestDayForBestMachine = {
          date: best.date,
          revenue: best.revenue,
          machineId: best.machineId,
          machineName: best.machineName
        };
        console.log(`✅ Only 1 valid entry in baseline (after filtering), using it: ${best.machineName} - ${best.date} with ${best.revenue.toFixed(2)} KWD`);
      } else {
        console.error(`❌ No valid best day data found in baseline after filtering buggy value`);
        console.error(`   → Baseline has ${allBestDays.length} entries, but all were filtered out as buggy`);
        console.error(`   → Solution: Use the "Baseline Builder" tab to rebuild the baseline with valid data.`);
      }
    } catch (e) {
      console.error("❌ Error getting 2nd largest from baseline:", e.toString());
    }
    
    // Use 2nd best day revenue from baseline JSON
    let bestMachineRevenueValue = 0;
    let bestMachineDate = null;
    let bestMachineId = null;
    let bestMachineName = null;
    
    if (secondBestDayForBestMachine && secondBestDayForBestMachine.revenue > 0) {
      bestMachineRevenueValue = secondBestDayForBestMachine.revenue;
      bestMachineDate = secondBestDayForBestMachine.date;
      bestMachineId = secondBestDayForBestMachine.machineId;
      bestMachineName = secondBestDayForBestMachine.machineName;
      console.log(`✅ Using 2nd largest from baseline: ${bestMachineDate} with ${bestMachineRevenueValue.toFixed(2)} KWD`);
    } else {
      console.error(`❌ No 2nd best day found in baseline - will show N/A`);
      console.error(`   → Baseline has ${baselineEntryCount} entries`);
      if (baselineEntryCount === 0) {
        console.error(`   → Solution: Use the "Baseline Builder" tab to build the baseline data first.`);
      } else if (baselineEntryCount === 1) {
        console.error(`   → Only 1 entry in baseline (may be the buggy one). Need at least 2 valid entries.`);
      } else {
        console.error(`   → All entries may have been filtered out as buggy.`);
      }
    }
    
    // FINAL CHECK: Never use the buggy baseline value (725.60 on 2025-03-23)
    if (bestMachineDate === '2025-03-23' || bestMachineRevenueValue === 725.60) {
      console.log(`🚫 BLOCKED: Attempted to use buggy baseline value, forcing to null`);
      bestMachineRevenueValue = 0;
      bestMachineDate = null;
      bestMachineId = null;
      bestMachineName = null;
    }
    
    // Convert dates to timestamps (Kuwait timezone - matches vendon-sync and People Analytics)
    const convertToTimestamp = (dateStr, isEnd = false) => {
      if (!dateStr) return null;
      // Use Kuwait timezone boundaries (UTC+3) to match vendon-sync
      const date = isEnd 
        ? new Date(dateStr + "T23:59:59.999+03:00")
        : new Date(dateStr + "T00:00:00+03:00");
      return Math.floor(date.getTime() / 1000);
    };
    
    // Fetch yesterday's revenue from database (cron-synced cache)
    let yesterdayRevenue = 0;
    
    try {
      const apiBase = PropertiesService.getScriptProperties().getProperty('VENDON_API_BASE') || 
                      'https://vendon-api.theleetclub.com';
      const cacheUrl = `${apiBase}/api/vendon-sales?machine_ids=${encodeURIComponent(machineId)}&date=${yesterday}`;
      console.log(`📡 Fetching yesterday revenue from database (cron cache): ${cacheUrl}`);
      
      const cacheResponse = UrlFetchApp.fetch(cacheUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        muteHttpExceptions: true
      });
      
      const cacheResponseCode = cacheResponse.getResponseCode();
      const cacheResponseText = cacheResponse.getContentText();
      
      if (cacheResponseCode === 200) {
        const cacheData = JSON.parse(cacheResponseText);
        if (cacheData.success && cacheData.data && cacheData.data.length > 0) {
          yesterdayRevenue = cacheData.data[0].totalRevenue || 0;
          const transactions = cacheData.data[0].totalTransactions || 0;
          console.log(`✅ Got revenue from database: ${yesterdayRevenue} KWD, ${transactions} transactions for machine ${machineId} on ${yesterday}`);
          
          // Log if value seems suspiciously low (for debugging cron issues)
          const baselineMachineRevenue = baselineForMachine ? (Number(baselineForMachine.bestRevenue) || 0) : 0;
          if (baselineMachineRevenue > 0 && yesterdayRevenue < baselineMachineRevenue * 0.1) {
            console.warn(`⚠️ Database value ${yesterdayRevenue} KWD seems low compared to baseline ${baselineMachineRevenue} KWD - check cron sync logs for machine ${machineId} on ${yesterday}`);
          }
        } else {
          console.warn(`⚠️ No cached data in database for machine ${machineId} on ${yesterday} - cron may not have synced this date yet`);
        }
      } else {
        console.error(`❌ Database API returned ${cacheResponseCode}: ${cacheResponseText}`);
      }
    } catch (e) {
      console.error("Error fetching yesterday revenue from database:", e);
    }
    
    // Calculate percentages and comparisons
    const baselineMachineRevenue = baselineForMachine ? (Number(baselineForMachine.bestRevenue) || 0) : 0;
    
    const percentVsMachineBest = baselineMachineRevenue > 0 
      ? ((yesterdayRevenue / baselineMachineRevenue) * 100) 
      : 0;
    
    const percentVsBestMachine = bestMachineRevenueValue > 0 
      ? ((yesterdayRevenue / bestMachineRevenueValue) * 100) 
      : 0;
    
    // Determine trend: compare yesterday with all-time best of this machine
    let trend = null;
    if (baselineMachineRevenue > 0) {
      if (yesterdayRevenue > baselineMachineRevenue) {
        trend = 'up'; // New record!
      } else if (yesterdayRevenue < baselineMachineRevenue * 0.8) {
        trend = 'down'; // Significantly below best
      } else {
        trend = 'stable'; // Close to best
      }
    }
    
    // Build helpful error messages for missing baseline data
    let baselineError = null;
    if (baselineEntryCount === 0) {
      baselineError = "Baseline file is empty or doesn't exist. Use the 'Baseline Builder' tab to build the baseline data first.";
    } else if (!baselineForMachine) {
      baselineError = `No baseline data found for this machine. Use the 'Baseline Builder' tab to add this machine to the baseline.`;
    } else if (!bestMachineDate || bestMachineRevenueValue === 0) {
      baselineError = "No valid 'best machine' data found in baseline. Use the 'Baseline Builder' tab to rebuild with valid data.";
    }
    
    return {
      yesterdayRevenue: yesterdayRevenue,
      yesterdayDate: yesterday,
      machineId: machineId,
      machineName: machineMap[machineId] || `Machine ${machineId}`,
      
      // All-time best day of selected machine (from baseline JSON)
      bestDayMachineAllTime: baselineForMachine ? {
        date: baselineForMachine.bestDate,
        revenue: baselineMachineRevenue,
        machineName: baselineForMachine.machineName || machineMap[machineId] || ''
      } : null,
      
      // All-time best day of best machine overall (using 2nd best day as workaround for bug)
      // IMPORTANT: We NEVER use baseline value (725.60 on 2025-03-23 is buggy)
      // Only return data if we successfully queried the 2nd best day
      // CRITICAL: Check that we're NOT using the buggy baseline date
      bestDayBestMachineAllTime: (bestMachineDate && bestMachineRevenueValue > 0 && 
                                   bestMachineDate !== '2025-03-23' &&
                                   bestMachineDate !== (bestMachineOverall ? bestMachineOverall.bestDate : null)) ? {
        date: bestMachineDate,
        revenue: bestMachineRevenueValue,
        machineId: bestMachineId,
        machineName: bestMachineName
      } : null,
      
      // Percentages
      percentVsMachineBest: percentVsMachineBest,
      percentVsBestMachine: percentVsBestMachine,
      
      // Trend indicator
      trend: trend,
      
      // Error message for missing baseline
      baselineError: baselineError,
      
      targetsVersion: "v4-baseline-comparison"
    };
    
    // Cache the result for 5 minutes (300 seconds)
    setCachedData(cacheKey, result, 300);
    console.log(`💾 Cached targets data for machine ${machineId} on ${yesterday}`);
    
    return result;
  } catch (error) {
    console.error("Error fetching targets data:", error);
    return {
      error: error.toString()
    };
  }
}

/**
 * Fetch lowest performing machine from yesterday using cached database API
 * This is much faster than scanning all machines individually
 */
/**
 * Fetch best performing machine from yesterday (for historical preload)
 */
function fetchBestMachineYesterdayFromCache(excludeIds) {
  try {
    // Get Historical API URL from PropertiesService or use default
    const apiBase = PropertiesService.getScriptProperties().getProperty('HISTORICAL_API_BASE') || 
                    'https://historical-api.theleetclub.com';
    
    // Build exclude_ids parameter if provided
    let url = `${apiBase}/api/historical-performance/best-yesterday`;
    if (excludeIds && excludeIds.length > 0) {
      url += `?exclude_ids=${encodeURIComponent(excludeIds.join(','))}`;
    }
    
    console.log(`📡 Fetching best machine from historical cache: ${url}`);
    
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      console.error(`❌ Historical API error ${responseCode}: ${responseText}`);
      return {
        success: false,
        error: `API error ${responseCode}`,
        bestMachine: null
      };
    }
    
    try {
      const data = JSON.parse(responseText);
      if (data.success && data.bestMachine) {
        console.log(`✅ Found best machine from historical cache: ${data.bestMachine.machineName} (${data.bestMachine.revenue} KWD)`);
        return data;
      } else {
        console.warn(`⚠️ No best machine found in cache: ${data.message || 'Unknown'}`);
        return {
          success: true,
          bestMachine: null,
          message: data.message || 'No data found'
        };
      }
    } catch (e) {
      console.error(`❌ Failed to parse cache response: ${e}`);
      return {
        success: false,
        error: `Failed to parse response: ${e}`,
        bestMachine: null
      };
    }
  } catch (error) {
    console.error("Error fetching best machine from cache:", error);
    return {
      success: false,
      error: error.toString(),
      bestMachine: null
    };
  }
}

function fetchLowestMachineYesterdayFromCache(excludeIds) {
  try {
    // Get Vendon API URL from PropertiesService or use default
    const apiBase = PropertiesService.getScriptProperties().getProperty('VENDON_API_BASE') || 
                    'https://vendon-api.theleetclub.com';
    
    // Build exclude_ids parameter if provided
    let url = `${apiBase}/api/vendon-sales/lowest-yesterday`;
    if (excludeIds && excludeIds.length > 0) {
      url += `?exclude_ids=${encodeURIComponent(excludeIds.join(','))}`;
    }
    
    console.log(`📡 Fetching lowest machine from cache: ${url}`);
    
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    if (responseCode !== 200) {
      console.error(`❌ API error ${responseCode}: ${responseText}`);
      return {
        success: false,
        error: `API error ${responseCode}`,
        bestMachine: null
      };
    }
    
    try {
      const data = JSON.parse(responseText);
      // API returns 'lowestMachine', but we normalize it to 'bestMachine' for consistency
      if (data.success && data.lowestMachine) {
        // Normalize the response to use 'bestMachine' key for compatibility
        const normalizedData = {
          success: true,
          bestMachine: data.lowestMachine,
          lowestMachine: data.lowestMachine, // Also keep original key
          scannedMachines: data.scannedMachines,
          totalMachines: data.totalMachines
        };
        console.log(`✅ Found lowest machine from cache: ${data.lowestMachine.machineName || 'Unknown'} (${data.lowestMachine.machineId}) with ${data.lowestMachine.revenue} KWD`);
        return normalizedData;
      } else {
        console.warn(`⚠️ No lowest machine found in cache: ${data.message || 'Unknown'}`);
        return {
          success: true,
          bestMachine: null,
          lowestMachine: null,
          message: data.message || 'No data found'
        };
      }
    } catch (e) {
      console.error(`❌ Failed to parse cache response: ${e}`);
      return {
        success: false,
        error: `Failed to parse response: ${e}`,
        bestMachine: null
      };
    }
  } catch (error) {
    console.error("❌ Error fetching best machine from cache:", error);
    return {
      success: false,
      error: error.toString(),
      bestMachine: null
    };
  }
}

/**
 * Fetch historical performance data for a machine within a date range.
 * Returns total revenue, product breakdown, top/bottom products.
 * Uses pagination to handle large date ranges.
 */
/**
 * Fetch historical performance data from cached API (fast) with fallback to direct Vendon API
 */
function fetchHistoricalPerformanceDataFromCache(filters) {
  try {
    const machineId = filters && filters.machineId ? String(filters.machineId) : null;
    const startDate = filters && filters.startDate ? filters.startDate : null;
    const endDate = filters && filters.endDate ? filters.endDate : null;
    
    if (!machineId || !startDate || !endDate) {
      return null; // Will fallback to direct API
    }
    
    // Get API base URL from PropertiesService or use default
    const apiBase = PropertiesService.getScriptProperties().getProperty('HISTORICAL_API_BASE') || 
                    'https://historical-api.theleetclub.com';
    
    const cacheUrl = `${apiBase}/api/historical-performance?machine_id=${encodeURIComponent(machineId)}&start_date=${startDate}&end_date=${endDate}`;
    console.log(`📡 Fetching historical performance from cached API: ${cacheUrl}`);
    
    const cacheResponse = UrlFetchApp.fetch(cacheUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    
    const cacheResponseCode = cacheResponse.getResponseCode();
    const cacheResponseText = cacheResponse.getContentText();
    
    if (cacheResponseCode === 200) {
      const cacheData = JSON.parse(cacheResponseText);
      if (cacheData.success && cacheData.data) {
        // Transform cached data to match expected format
        const result = {
          totalRevenue: cacheData.data.totalRevenue,
          totalQuantity: cacheData.data.totalQuantity,
          productRevenue: cacheData.data.productRevenue,
          topProducts: cacheData.data.topProducts,
          bottomProducts: cacheData.data.bottomProducts,
          startDate: cacheData.data.startDate,
          endDate: cacheData.data.endDate,
          machineId: cacheData.data.machineId
        };
        console.log(`✅ Got historical performance from cache: ${result.totalRevenue} KWD, ${result.totalQuantity} vends`);
        return result;
      }
    }
    
    console.warn(`⚠️ Cache API returned ${cacheResponseCode} or no data, will fallback to direct Vendon API`);
    return null; // Fallback to direct API
    
  } catch (e) {
    console.error("Error fetching from cache:", e);
    return null; // Fallback to direct API
  }
}

function fetchHistoricalPerformanceData(filters) {
  try {
    console.log("📊 Starting fetchHistoricalPerformanceData with filters:", filters);
    
    const machineId = filters && filters.machineId ? String(filters.machineId) : null;
    const startDate = filters && filters.startDate ? filters.startDate : null;
    const endDate = filters && filters.endDate ? filters.endDate : null;
    
    if (!machineId) {
      return { error: "Machine ID is required" };
    }
    
    if (!startDate || !endDate) {
      return { error: "Start date and end date are required" };
    }
    
    // Try cached API first (fast)
    const cachedData = fetchHistoricalPerformanceDataFromCache(filters);
    if (cachedData) {
      return cachedData;
    }
    
    // Fallback to direct Vendon API (slow)
    console.log("⚠️ Cache miss, falling back to direct Vendon API (this will be slow)...");
    
    // Convert dates to timestamps using Kuwait timezone (UTC+3) to match sync service
    // Vendon uses Kuwait local time for daily boundaries
    // For date "2026-01-17" in Kuwait: 00:00:00 Kuwait = 2026-01-16 21:00:00 UTC
    // So we create UTC date and subtract 3 hours to get the Kuwait local time timestamp
    const startDateParts = startDate.split('-');
    const endDateParts = endDate.split('-');
    
    // Create UTC dates for the date string, then adjust for Kuwait timezone (UTC+3)
    // Kuwait 2026-01-17 00:00:00 = UTC 2026-01-16 21:00:00
    const startUTC = new Date(Date.UTC(
      parseInt(startDateParts[0]),
      parseInt(startDateParts[1]) - 1,
      parseInt(startDateParts[2]),
      0, 0, 0, 0
    ));
    // Subtract 3 hours to convert UTC midnight to Kuwait midnight
    const fromTimestamp = Math.floor((startUTC.getTime() / 1000) - (3 * 3600));
    
    const endUTC = new Date(Date.UTC(
      parseInt(endDateParts[0]),
      parseInt(endDateParts[1]) - 1,
      parseInt(endDateParts[2]),
      23, 59, 59, 999
    ));
    // Subtract 3 hours to convert UTC end-of-day to Kuwait end-of-day
    const toTimestamp = Math.floor((endUTC.getTime() / 1000) - (3 * 3600));
    
    console.log("📅 Date range:", startDate, "to", endDate, "(" + fromTimestamp, "to", toTimestamp + ")");
    
    // Aggregate data by product
    const productRevenue = {};
    let totalRevenue = 0;
    let totalQuantity = 0;
    
    // Fetch data in chunks using pagination
    let offset = 0;
    const limit = 10000; // Fetch 10k records at a time
    let hasMore = true;
    let totalFetched = 0;
    const maxIterations = 50; // Safety limit to prevent infinite loops
    let iteration = 0;
    
    while (hasMore && iteration < maxIterations) {
      iteration++;
      console.log("🔄 Fetching chunk", iteration, "- offset:", offset);
      
      const url = `${API_BASE}/stats/vends?from_timestamp=${fromTimestamp}&to_timestamp=${toTimestamp}&machine_id=${machineId}&limit=${limit}&offset=${offset}`;
      
      const options = {
        method: "get",
        headers: { "Authorization": "Token " + API_KEY },
        muteHttpExceptions: true
      };
      
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const text = response.getContentText();
      
      if (responseCode !== 200) {
        console.error("❌ API returned status", responseCode);
        return { error: "API error " + responseCode + ": " + text.substring(0, 200) };
      }
      
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error("❌ Failed to parse JSON:", text.substring(0, 200));
        return { error: "Failed to parse API response: " + text.substring(0, 200) };
      }
      
      if (json.code !== 200) {
        console.error("❌ API error code:", json.code, json.message);
        return { error: "API error " + json.code + ": " + (json.message || text.substring(0, 200)) };
      }
      
      if (!json.result || json.result.length === 0) {
        hasMore = false;
        break;
      }
      
      const chunkSize = json.result.length;
      totalFetched += chunkSize;
      console.log("✅ Fetched", chunkSize, "vends (total:", totalFetched + ")");
      
      // Process this chunk
      json.result.forEach(vend => {
        const price = vend.price || 0;
        const productName = vend.name || "Unknown Product";
        
        totalRevenue += price;
        totalQuantity += 1;
        
        if (!productRevenue[productName]) {
          productRevenue[productName] = {
            name: productName,
            revenue: 0,
            quantity: 0
          };
        }
        
        productRevenue[productName].revenue += price;
        productRevenue[productName].quantity += 1;
      });
      
      // Check if there's more data
      if (chunkSize < limit) {
        hasMore = false;
      } else {
        offset += limit;
        // Small delay to avoid rate limiting
        Utilities.sleep(200);
      }
    }
    
    if (iteration >= maxIterations) {
      console.warn("⚠️ Reached max iterations, may have more data");
    }
    
    console.log("✅ Processing complete. Total vends:", totalQuantity, "Total revenue:", totalRevenue.toFixed(2));
    
    // Convert to array and sort
    const productsArray = Object.values(productRevenue);
    console.log("📦 Unique products:", productsArray.length);
    
    // Sort by revenue descending for top products
    const topProducts = productsArray
      .slice()
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10); // Top 10
    
    // Sort by revenue ascending for bottom products (excluding zero revenue)
    const bottomProducts = productsArray
      .filter(p => p.revenue > 0)
      .sort((a, b) => a.revenue - b.revenue)
      .slice(0, 10); // Bottom 10
    
    // Create a simplified productRevenue object for charts (just revenue values)
    const productRevenueSimple = {};
    productsArray.forEach(p => {
      productRevenueSimple[p.name] = p.revenue;
    });
    
    const result = {
      totalRevenue: totalRevenue,
      totalQuantity: totalQuantity,
      productRevenue: productRevenueSimple,
      topProducts: topProducts,
      bottomProducts: bottomProducts,
      startDate: startDate,
      endDate: endDate,
      machineId: machineId
    };
    
    console.log("✅ Returning result with", topProducts.length, "top products and", bottomProducts.length, "bottom products");
    return result;
    
  } catch (error) {
    console.error("❌ Error fetching historical performance data:", error);
    return {
      error: error.toString()
    };
  }
}

// === BEST-DAY BASELINE STORAGE (JSON file in Google Drive) ===

// Use var instead of const for globals to avoid any temporal dead‑zone issues in Apps Script.
var BEST_DAY_BASELINE_FILE_NAME = 'BestDayBaseline.json';
var BASELINE_BUILD_STATE_KEY = 'BASELINE_BUILD_STATE';
var BASELINE_BUILD_TRIGGER_ID_KEY = 'BASELINE_BUILD_TRIGGER_ID';

/**
 * Internal helper: get or create the Drive file used to persist the baseline JSON.
 */
function getBestDayBaselineFile_() {
  const files = DriveApp.getFilesByName(BEST_DAY_BASELINE_FILE_NAME);
  if (files.hasNext()) {
    return files.next();
  }
  // Create an empty JSON file if it doesn't exist yet
  return DriveApp.createFile(BEST_DAY_BASELINE_FILE_NAME, '{}', MimeType.PLAIN_TEXT);
}

/**
 * Load baseline map (machineId -> {machineId, machineName, bestDate, bestRevenue, source})
 * from the JSON file in Drive. This is our persistent, manually-inspectable store.
 */
function getBestDayBaselineMap() {
  try {
    const file = getBestDayBaselineFile_();
    const text = file.getBlob().getDataAsString();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    console.error('Error in getBestDayBaselineMap:', e);
    return {};
  }
}

/**
 * Save baseline map back to the JSON file in Drive.
 */
function saveBestDayBaselineMap(baselineMap) {
  try {
    const file = getBestDayBaselineFile_();
    const payload = JSON.stringify(baselineMap || {});
    file.setContent(payload);
    if (baselineMap) {
      const count = Object.keys(baselineMap).length;
      console.log('💾 Saved BestDayBaseline.json with', count, 'machines');
    } else {
      console.log('💾 Saved BestDayBaseline.json (empty map)');
    }
  } catch (e) {
    console.error('Error in saveBestDayBaselineMap:', e);
  }
}

/**
/**
 * Returns progress info for the all-time baseline builder.
 * Can be called from the frontend to show a progress bar.
 */
function getBaselineBuildProgress() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(BASELINE_BUILD_STATE_KEY);
  if (!raw) {
    return {
      done: false,
      percent: 0,
      message: 'Not started'
    };
  }
  try {
    const state = JSON.parse(raw);
    return {
      done: !!state.done,
      percent: state.percent || 0,
      message: state.message || ''
    };
  } catch (e) {
    console.error('Error parsing BASELINE_BUILD_STATE:', e);
    return {
      done: false,
      percent: 0,
      message: 'Error reading progress'
    };
  }
}

/**
 * Internal: save current build state for resume + progress.
 */
function saveBaselineBuildState_(state) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(BASELINE_BUILD_STATE_KEY, JSON.stringify(state || {}));
}

/**
 * Start automatic baseline build in the background using a time‑based trigger.
 * You run THIS ONCE; Apps Script will then keep calling buildBestDayBaselineChunk()
 * on a schedule until all months are processed.
 */
function startBaselineBuildAuto() {
  // Default to 2023-01-01 instead of 2018
  return startBaselineBuildFromDate('2023-01-01');
}

function startBaselineBuildAuto_OLD() {
  const props = PropertiesService.getScriptProperties();

  // Reset state so build starts from ALL_TIME_START again
  props.deleteProperty(BASELINE_BUILD_STATE_KEY);

  // Avoid creating duplicate triggers
  const existingId = props.getProperty(BASELINE_BUILD_TRIGGER_ID_KEY);
  if (existingId) {
    console.log('Baseline build trigger already exists with ID:', existingId);
    return;
  }

  const trigger = ScriptApp.newTrigger('buildBestDayBaselineChunk')
    .timeBased()
    .everyMinutes(5) // adjust frequency if needed
    .create();

  props.setProperty(BASELINE_BUILD_TRIGGER_ID_KEY, trigger.getUniqueId());
  console.log('✅ Started automatic baseline build. Trigger ID:', trigger.getUniqueId());
}

/**
 * Stop and remove the automatic baseline build trigger (internal).
 */
function stopBaselineBuildTriggerIfAny_() {
  const props = PropertiesService.getScriptProperties();
  const triggerId = props.getProperty(BASELINE_BUILD_TRIGGER_ID_KEY);
  if (!triggerId) return;

  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(tr => {
    if (tr.getUniqueId && tr.getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(tr);
      console.log('🛑 Removed baseline build trigger with ID:', triggerId);
    }
  });

  props.deleteProperty(BASELINE_BUILD_TRIGGER_ID_KEY);
}

/**
 * Chunked builder: processes at most ONE month of data per call,
 * updating BestDayBaseline.json in Drive.
 *
 * Call this repeatedly (manually, or from the UI) until getBaselineBuildProgress().done === true.
 */
function buildBestDayBaselineChunk() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(BASELINE_BUILD_STATE_KEY);

  const ALL_TIME_START = '2018-01-01';
  const today = new Date();
  const endDateStr = today.toISOString().split('T')[0];

  let state;
  if (!raw) {
    // Initialise state
    const start = new Date(ALL_TIME_START + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    const totalMonths =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth()) + 1;
    state = {
      allTimeStart: ALL_TIME_START,
      endDate: endDateStr,
      currentYear: start.getFullYear(),
      currentMonth: start.getMonth(), // 0-based
      totalMonths: totalMonths,
      processedMonths: 0,
      done: false,
      percent: 0,
      message: 'Starting baseline build...'
    };
  } else {
    state = JSON.parse(raw);
  }

  if (state.done) {
    console.log('✅ Baseline build already complete.');
    return getBaselineBuildProgress();
  }

  const chunkYear = state.currentYear;
  const chunkMonth = state.currentMonth; // 0-based

  const chunkStart = new Date(chunkYear, chunkMonth, 1);
  const chunkStartStr = chunkStart.toISOString().split('T')[0];

  const monthEnd = new Date(chunkYear, chunkMonth + 1, 0); // last day of month
  const endBoundary = new Date(state.endDate + 'T23:59:59Z');
  const chunkEnd = monthEnd < endBoundary ? monthEnd : endBoundary;
  const chunkEndStr = chunkEnd.toISOString().split('T')[0];

  console.log('🏗 Baseline chunk:', chunkStartStr, 'to', chunkEndStr);

  // Fetch vends for this month in ONE call (increase limit to handle more data)
  const fromTs = Math.floor(chunkStart.getTime() / 1000);
  const toTs = Math.floor(chunkEnd.getTime() / 1000);
  const url = `${API_BASE}/stats/vends?from_timestamp=${fromTs}&to_timestamp=${toTs}&limit=50000`;

  let json = { result: [] };
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Token ' + API_KEY },
      muteHttpExceptions: true
    });
    const text = response.getContentText();
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('Error parsing monthly response:', parseErr, 'text:', text);
      json = { result: [] };
    }
    if (json.code !== 200) {
      console.error('Monthly API error', json.code, 'for', chunkStartStr, 'to', chunkEndStr);
      json = { result: [] };
    }
  } catch (e) {
    console.error('Error fetching monthly data for baseline:', e);
    json = { result: [] };
  }

  // Aggregate revenue per machine per day within this chunk
  const dailyByMachine = {}; // { machineId: { date: revenue } }
  const uniqueMachinesInChunk = new Set();
  if (Array.isArray(json.result)) {
    console.log('Monthly vends count for chunk', chunkStartStr, 'to', chunkEndStr, ':', json.result.length);
    json.result.forEach(vend => {
      const mId = String(vend.machine_id || vend.machineId || '');
      if (!mId) return;
      uniqueMachinesInChunk.add(mId);
      // Use price_vat if available (to match Vendon UI), otherwise fall back to price
      const price = vend.price_vat !== undefined ? vend.price_vat : (vend.price || 0);

      let dt = null;
      if (vend.datetime != null) {
        if (typeof vend.datetime === 'number') {
          dt = new Date(vend.datetime * 1000);
        } else {
          dt = new Date(vend.datetime);
        }
      } else if (vend.time != null) {
        dt = new Date(vend.time);
      } else if (vend.timestamp != null) {
        if (typeof vend.timestamp === 'number') {
          dt = new Date(vend.timestamp * 1000);
        } else {
          dt = new Date(vend.timestamp);
        }
      } else {
        dt = new Date();
      }
      const dateStr = dt.toISOString().split('T')[0];

      if (!dailyByMachine[mId]) {
        dailyByMachine[mId] = {};
      }
      if (!dailyByMachine[mId][dateStr]) {
        dailyByMachine[mId][dateStr] = 0;
      }
      dailyByMachine[mId][dateStr] += price;
    });
    console.log('Unique machines in this chunk:', uniqueMachinesInChunk.size);
  }

  // Load existing baseline from Drive
  const baselineMap = getBestDayBaselineMap();
  const beforeCount = Object.keys(baselineMap).length;

  // Get machine names for lookup
  const machines = fetchMachines();
  const machineNameMap = {};
  machines.forEach(m => {
    machineNameMap[String(m.id)] = m.name || '';
  });
  console.log('Machine name map created with', machines.length, 'machines');

  // Also collect machine names from vend data (they might have machine_name field)
  const machineNamesFromVends = {};
  if (Array.isArray(json.result)) {
    json.result.forEach(vend => {
      const mId = String(vend.machine_id || vend.machineId || '');
      if (mId && vend.machine_name) {
        machineNamesFromVends[mId] = vend.machine_name;
      }
    });
  }
  console.log('Machine names from vends:', Object.keys(machineNamesFromVends).length);

  // Update baseline with any better days from this chunk
  // IMPORTANT: We process ALL machines in parallel for each month.
  // For each machine, we compare each day in this month to its stored "best day ever".
  // If a day in this month beats the stored best, we update it.
  // This way, as we scan 2023-01, then 2023-02, ... 2024-09, etc.,
  // we're building up the "best day of all time" for each machine.
  let machinesUpdated = 0;
  let machinesNew = 0;
  Object.keys(dailyByMachine).forEach(mId => {
    const perDay = dailyByMachine[mId];
    Object.keys(perDay).forEach(dateStr => {
      const revenue = perDay[dateStr];
      const existing = baselineMap[mId];
      const existingBest = existing ? (Number(existing.bestRevenue) || 0) : 0;
      if (!existing || revenue > existingBest) {
        // Priority: 1) vend data name, 2) machineNameMap, 3) existing name, 4) empty
        const machineName = machineNamesFromVends[mId] 
          || machineNameMap[mId] 
          || (existing ? existing.machineName : '') 
          || '';
        
        if (!machineName && mId) {
          console.log('⚠️ No name found for machine ID:', mId, '- map has:', machineNameMap[mId], '- vend has:', machineNamesFromVends[mId]);
        }
        
        const wasNew = !existing;
        baselineMap[mId] = {
          machineId: mId,
          machineName: machineName,
          bestDate: dateStr,
          bestRevenue: revenue,
          source: existing ? 'API_all_time_update' : 'API_all_time_new'
        };
        
        if (wasNew) {
          machinesNew++;
        } else {
          machinesUpdated++;
        }
      }
    });
  });
  
  if (machinesNew > 0 || machinesUpdated > 0) {
    console.log(`📊 This chunk: ${machinesNew} new machines, ${machinesUpdated} machines with better days`);
  }

  // Backfill missing machine names for existing entries
  let namesBackfilled = 0;
  Object.keys(baselineMap).forEach(mId => {
    const entry = baselineMap[mId];
    if (!entry.machineName || entry.machineName === '') {
      const nameFromMap = machineNameMap[mId] || machineNamesFromVends[mId] || '';
      if (nameFromMap) {
        entry.machineName = nameFromMap;
        namesBackfilled++;
      }
    }
  });
  if (namesBackfilled > 0) {
    console.log('✅ Backfilled', namesBackfilled, 'missing machine names');
  }

  // Persist baseline
  saveBestDayBaselineMap(baselineMap);
  const afterCount = Object.keys(baselineMap).length;
  console.log('Baseline map size before/after chunk:', beforeCount, '->', afterCount);

  // Advance state to next month
  state.processedMonths += 1;
  const nextMonth = new Date(chunkYear, chunkMonth + 1, 1);
  if (nextMonth > endBoundary) {
    state.done = true;
  } else {
    state.currentYear = nextMonth.getFullYear();
    state.currentMonth = nextMonth.getMonth();
  }

  const percent = state.totalMonths > 0
    ? Math.min(100, Math.round((state.processedMonths / state.totalMonths) * 100))
    : 100;
  state.percent = percent;
  state.message = state.done
    ? 'Baseline build complete'
    : `Processed up to ${chunkEndStr} (${percent}%)`;

  saveBaselineBuildState_(state);
  console.log('Baseline build progress:', percent + '%', '-', state.message);

  // If we've finished all months, stop the auto trigger (if any)
  if (state.done) {
    stopBaselineBuildTriggerIfAny_();
    console.log('✅ Baseline build fully complete. Auto trigger (if present) has been stopped.');
  }

  return getBaselineBuildProgress();
}

/**
 * Cancel/stop the automatic baseline build trigger.
 */
function cancelBaselineBuild() {
  stopBaselineBuildTriggerIfAny_();
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BASELINE_BUILD_STATE_KEY);
  console.log('✅ Baseline build cancelled. Trigger stopped and state cleared.');
  return { success: true, message: 'Baseline build cancelled successfully' };
}

/**
 * Start baseline build from a specific start date (defaults to 2023-01-01).
 * This resets any existing state and starts fresh.
 */
function startBaselineBuildFromDate(startDate) {
  // Stop any existing trigger first
  stopBaselineBuildTriggerIfAny_();
  
  // Clear old state
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(BASELINE_BUILD_STATE_KEY);
  
  // Set new state starting from the provided date (or 2023-01-01)
  const start = startDate || '2023-01-01';
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  const startDateObj = new Date(start);
  const endDateObj = new Date(todayStr);
  
  const state = {
    allTimeStart: start,
    endDate: todayStr,
    currentYear: startDateObj.getFullYear(),
    currentMonth: startDateObj.getMonth(),
    totalMonths: calculateMonthsBetween(startDateObj, endDateObj),
    processedMonths: 0,
    done: false,
    percent: 0,
    message: `Starting from ${start}`
  };
  
  saveBaselineBuildState_(state);
  
  // Create trigger to run every 1 minute (faster than 5 minutes)
  const trigger = ScriptApp.newTrigger('buildBestDayBaselineChunk')
    .timeBased()
    .everyMinutes(1)
    .create();
  
  const triggerId = trigger.getUniqueId();
  props.setProperty('BASELINE_BUILD_TRIGGER_ID', triggerId);
  
  console.log('✅ Started baseline build from', start, 'to', todayStr, '. Trigger ID:', triggerId);
  return {
    success: true,
    message: `Baseline build started from ${start}`,
    triggerId: triggerId
  };
}

/**
 * Helper: calculate number of months between two dates.
 */
function calculateMonthsBetween(start, end) {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  return years * 12 + months + 1; // +1 to include both start and end months
}

/**
 * Get recent execution logs for baseline build.
 * Returns last N executions with their logs.
 */
function getBaselineBuildLogs(limit) {
  const limitCount = limit || 20;
  const logs = [];
  
  try {
    // Get recent executions for buildBestDayBaselineChunk
    const executions = [];
    // Note: Apps Script doesn't have a direct API to list executions,
    // so we'll return the state and let the frontend poll for updates
    const state = getBaselineBuildState_();
    const baselineMap = getBestDayBaselineMap();
    
    return {
      success: true,
      state: state,
      baselineStats: {
        totalMachines: Object.keys(baselineMap).length,
        sampleEntries: Object.keys(baselineMap).slice(0, 5).map(k => baselineMap[k])
      },
      message: 'Use getBaselineBuildProgress() for real-time status'
    };
  } catch (e) {
    console.error('Error getting baseline build logs:', e);
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Get the full baseline data as JSON for display.
 */
function getBaselineDataFull() {
  try {
    const baselineMap = getBestDayBaselineMap();
    const file = getBestDayBaselineFile_();
    
    return {
      success: true,
      data: baselineMap,
      fileUrl: file.getUrl(),
      fileName: file.getName(),
      machineCount: Object.keys(baselineMap).length,
      jsonString: JSON.stringify(baselineMap, null, 2)
    };
  } catch (e) {
    console.error('Error getting full baseline data:', e);
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Get the 2nd best day for a machine by querying all historical data,
 * aggregating by day, sorting by revenue, and returning the 2nd highest.
 * This is used as a workaround for a bug in the best day value.
 * @param {string} machineId - The machine ID to query
 * @param {string} skipDate - Optional date to skip (the known best day date from baseline)
 */
function getSecondBestDayForMachine(machineId, skipDate) {
  try {
    // Use a more recent date range to avoid timeout (last 3 years should be enough)
    const today = new Date();
    const threeYearsAgo = new Date(today);
    threeYearsAgo.setFullYear(today.getFullYear() - 3);
    threeYearsAgo.setHours(0, 0, 0, 0);
    today.setHours(23, 59, 59, 999);
    
    const fromTimestamp = Math.floor(threeYearsAgo.getTime() / 1000);
    const toTimestamp = Math.floor(today.getTime() / 1000);
    
    const startDateStr = threeYearsAgo.toISOString().split('T')[0];
    console.log(`🔍 Fetching 2nd best day for machine ${machineId} from ${startDateStr} to today${skipDate ? ` (skipping ${skipDate})` : ''}`);
    
    // Fetch all vends for this machine with pagination
    const limit = 10000;
    let offset = 0;
    let hasMore = true;
    const allVends = [];
    const maxIterations = 20; // Reduced to avoid timeout
    let iteration = 0;
    const startTime = new Date().getTime();
    const maxExecutionTime = 25000; // 25 seconds max
    
    while (hasMore && iteration < maxIterations) {
      // Check execution time to avoid timeout
      const elapsed = new Date().getTime() - startTime;
      if (elapsed > maxExecutionTime) {
        console.log(`⏱️ Time limit reached (${elapsed}ms), stopping fetch`);
        break;
      }
      
      iteration++;
      const url = `${API_BASE}/stats/vends?from_timestamp=${fromTimestamp}&to_timestamp=${toTimestamp}&machine_id=${machineId}&limit=${limit}&offset=${offset}`;
      
      let response;
      try {
        response = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { Authorization: 'Token ' + API_KEY },
          muteHttpExceptions: true
        });
      } catch (e) {
        console.error('Error fetching vends for 2nd best day:', e.toString());
        break;
      }
      
      const text = response.getContentText();
      let json = { result: [] };
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error('Error parsing response for 2nd best day:', e.toString());
        break;
      }
      
      if (json.code !== 200) {
        console.error('API error for 2nd best day:', json.code, json.message || '');
        break;
      }
      
      const vends = json.result || [];
      if (vends.length === 0) {
        hasMore = false;
      } else {
        allVends.push(...vends);
        offset += vends.length;
        hasMore = vends.length === limit;
        console.log(`📥 Fetched ${vends.length} vends (total: ${allVends.length})`);
      }
    }
    
    console.log(`📊 Fetched ${allVends.length} vends for machine ${machineId}`);
    
    // Aggregate by day
    const dailyRevenue = {}; // { dateStr: revenue }
    allVends.forEach(vend => {
      const vendDate = new Date(vend.timestamp * 1000);
      const dateStr = vendDate.toISOString().split('T')[0];
      const price = vend.price || 0;
      
      if (!dailyRevenue[dateStr]) {
        dailyRevenue[dateStr] = 0;
      }
      dailyRevenue[dateStr] += price;
    });
    
    // Convert to array and sort by revenue descending
    let dailyArray = Object.keys(dailyRevenue).map(dateStr => ({
      date: dateStr,
      revenue: dailyRevenue[dateStr]
    })).sort((a, b) => b.revenue - a.revenue);
    
    console.log(`📊 Found ${dailyArray.length} unique days for machine ${machineId}`);
    
    // If we have a skipDate (baseline best day), remove it from the array
    if (skipDate && dailyArray.length > 0) {
      const beforeFilter = dailyArray.length;
      dailyArray = dailyArray.filter(day => day.date !== skipDate);
      const afterFilter = dailyArray.length;
      if (beforeFilter > afterFilter) {
        console.log(`🗑️ Removed baseline best day ${skipDate} from results (${beforeFilter} -> ${afterFilter} days)`);
      }
    }
    
    // Log top 5 days for debugging
    if (dailyArray.length > 0) {
      console.log(`📊 Top 5 days for machine ${machineId}:`);
      dailyArray.slice(0, 5).forEach((day, idx) => {
        console.log(`  ${idx + 1}. ${day.date}: ${day.revenue.toFixed(2)} KWD`);
      });
    }
    
    // Get the best day from filtered array (which is now the 2nd best overall)
    if (dailyArray.length >= 1) {
      const secondBest = dailyArray[0]; // After filtering, index 0 is the 2nd best
      console.log(`✅ 2nd best day (after skipping baseline): ${secondBest.date} with ${secondBest.revenue.toFixed(2)} KWD`);
      return {
        date: secondBest.date,
        revenue: secondBest.revenue,
        machineId: String(machineId)
      };
    } else {
      console.log(`⚠️ No days found for machine ${machineId} after filtering`);
      return null;
    }
  } catch (e) {
    console.error('Error in getSecondBestDayForMachine:', e);
    return null;
  }
}

/**
 * Debug function: Verify revenue for a specific machine and date.
 * This helps compare our baseline results with Vendon's direct API.
 */
function verifyMachineDayRevenue(machineId, dateStr) {
  try {
    const date = new Date(dateStr);
    date.setHours(0, 0, 0, 0);
    const fromTs = Math.floor(date.getTime() / 1000);
    const toTs = fromTs + 24 * 60 * 60 - 1;
    
    const url = `${API_BASE}/stats/vends?from_timestamp=${fromTs}&to_timestamp=${toTs}&machine_id=${machineId}&limit=10000`;
    
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Token ' + API_KEY },
      muteHttpExceptions: true
    });
    
    const text = response.getContentText();
    let json = { result: [] };
    try {
      json = JSON.parse(text);
    } catch (e) {
      return {
        success: false,
        error: 'Failed to parse response: ' + text.substring(0, 200)
      };
    }
    
    if (json.code !== 200) {
      return {
        success: false,
        error: 'API error ' + json.code + ': ' + (json.message || text.substring(0, 200))
      };
    }
    
    const vends = json.result || [];
    let totalRevenue = 0;
    const products = {};
    
    vends.forEach(vend => {
      const price = vend.price || 0;
      totalRevenue += price;
      
      const productName = vend.name || 'Unknown';
      if (!products[productName]) {
        products[productName] = { quantity: 0, revenue: 0 };
      }
      products[productName].quantity += 1;
      products[productName].revenue += price;
    });
    
    return {
      success: true,
      machineId: machineId,
      date: dateStr,
      totalRevenue: totalRevenue,
      vendCount: vends.length,
      products: products,
      note: 'This uses /stats/vends endpoint. Vendon UI might use /stats/vendsSummaryTotal with price_type=w_vat which may differ.'
    };
  } catch (e) {
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * FAST incremental updater for BestDayBaseline JSON.
 *
 * Idea:
 *  - We remember the last date we scanned in Script Properties.
 *  - Each time this runs, it only scans from that date up to today.
 *  - If a machine gets a NEW best day in that period, we update its row.
 *
 * This should be called:
 *  - Either by a daily time‑based trigger, OR
 *  - Via a button / action from the Targets tab when owners want to refresh.
 */
function incrementalUpdateBestDayBaseline() {
  const ALL_TIME_START = '2018-01-01';
  const props = PropertiesService.getScriptProperties();

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  let lastScanStr = props.getProperty('BEST_DAY_BASELINE_LAST_SCAN') || ALL_TIME_START;

  // If we already scanned up to (or beyond) today, nothing to do
  if (lastScanStr >= todayStr) {
    console.log('⏭ BestDayBaseline already up to date (last scan:', lastScanStr, ', today:', todayStr, ')');
    return;
  }

  console.log('🔄 Incremental BestDayBaseline update from', lastScanStr, 'to', todayStr);

  const machines = fetchMachines();
  if (!machines || machines.length === 0) {
    console.log('No machines found, aborting incrementalUpdateBestDayBaseline');
    return;
  }

  // We just need ANY valid machineId to call fetchTargetsData;
  // it will internally calculate highestByMachine for ALL machines.
  const firstMachineId = String(machines[0].id);

  // Yesterday value is required parameter but not used for baseline update itself
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  const result = fetchTargetsData({
    machineId: firstMachineId,
    yesterday: yesterdayStr,
    searchStartDate: lastScanStr,
    searchEndDate: todayStr
  });

  if (!result || result.error) {
    console.error('Error while running incrementalUpdateBestDayBaseline via fetchTargetsData:', result && result.error);
    return;
  }

  const highestByMachine = result.highestByMachine || [];
  console.log('Incremental scan found highest‑day candidates for', highestByMachine.length, 'machines');

  // Load existing baseline JSON
  const baselineMap = getBestDayBaselineMap();

  // Apply incremental updates in memory
  highestByMachine.forEach(item => {
    const mId = String(item.machineId);
    const machineName = item.machineName || '';
    const date = item.date;
    const revenue = item.revenue || 0;

    const existing = baselineMap[mId];
    const existingBest = existing ? (Number(existing.bestRevenue) || 0) : 0;

    if (!existing || revenue > existingBest) {
      baselineMap[mId] = {
        machineId: mId,
        machineName: machineName,
        bestDate: date,
        bestRevenue: revenue,
        source: existing ? 'API_incremental' : 'API_incremental_new'
      };
      console.log(`⬆ Updated baseline for machine ${mId}: ${revenue} on ${date} (prev ${existingBest})`);
    }
  });

  // Persist updated baseline
  saveBestDayBaselineMap(baselineMap);

  // Remember up‑to date scan date
  props.setProperty('BEST_DAY_BASELINE_LAST_SCAN', todayStr);
  console.log('✅ incrementalUpdateBestDayBaseline completed. LAST_SCAN set to', todayStr, 'and baseline JSON saved');
}



