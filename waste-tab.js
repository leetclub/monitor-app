function analyzeWasteForMachine(machineId, date) {
   try {
    console.log(`Analyzing waste for machine ${machineId} on date ${date}`);
    
    const overridesData = fetchAreaOverridesData(machineId, date);
    const salesData = fetchSalesDataForMachine(machineId, date);
    
    return calculateWaste(overridesData, salesData);
  } catch (error) {
    console.error("Error in waste analysis:", error);
    return { error: error.toString() };
  }
}
 
function fetchAreaOverridesData(machineId, date) {
  const apiUrl = `https://motion.theleetclub.com/api/area-overrides?date=${date}&machine_id=${machineId}`;
  
  const options = {
    'method': 'GET',
    'headers': {
      'Accept': 'application/json',
      'X-API-KEY': 'Q2FzZVNlY3VyZUtleU5vdyE3d0p5bGx4d2p2d2ZzZ2p3bGZ3'
    },
    'muteHttpExceptions': true
  };
  
  const response = UrlFetchApp.fetch(apiUrl, options);
  
  if (response.getResponseCode() !== 200) {
    throw new Error(`API Error: ${response.getResponseCode()} - ${response.getContentText()}`);
  }
  
  return JSON.parse(response.getContentText());
}

function fetchSalesDataForMachine(machineId, date) {
  try {
    const startDate = new Date(date);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);
    
    const url = `${API_BASE}/stats/vends?machine_id=${machineId}&from_timestamp=${startTimestamp}&to_timestamp=${endTimestamp}&limit=1000`;
    
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "Authorization": "Token " + API_KEY },
      muteHttpExceptions: true
    });
    
    if (res.getResponseCode() !== 200) {
      console.error("Failed to fetch sales data:", res.getContentText());
      throw new Error("Failed to fetch sales data");
    }
    
    const data = JSON.parse(res.getContentText());
    return data;
  } catch (error) {
    console.error("Error fetching sales data:", error);
    throw error;
  }
}

function calculateWaste(overridesData, salesData) {
  if (!overridesData.data || !Array.isArray(overridesData.data)) {
    return { error: "No refill data available for analysis" };
  }
  
  if (!salesData.result || !Array.isArray(salesData.result)) {
    return { error: "No sales data available for analysis" };
  }
  
  const productDetailsPromise = fetchProductDetailsForStockIds(
    overridesData.data.map(item => item.stock_id)
  );
  
  const salesByStockId = {};
  
  salesData.result.forEach(sale => {
    const stockId = sale.stock_id;
    if (!stockId) return;
    
    if (!salesByStockId[stockId]) {
      salesByStockId[stockId] = {
        sales: 0,
        returns: 0,
        product_name: sale.product_name || sale.name || "Unknown Product"
      };
    }
    
    salesByStockId[stockId].sales += 1;
  });
  
  const wasteItems = [];
  
  overridesData.data.forEach(override => {
    const stockId = override.stock_id;
    const sales = salesByStockId[stockId] ? salesByStockId[stockId].sales : 0;
    const returns = salesByStockId[stockId] ? salesByStockId[stockId].returns : 0;
    
    let productName = "Unknown Product";
    if (salesByStockId[stockId] && salesByStockId[stockId].product_name) {
      productName = salesByStockId[stockId].product_name;
    } else if (productDetailsPromise[stockId] && productDetailsPromise[stockId].name) {
      productName = productDetailsPromise[stockId].name;
    }
    
    wasteItems.push({
      stock_id: stockId,
      product_name: productName,
      original_quantity: override.original_quantity,
      updated_quantity: override.updated_quantity,
      sales: sales,
      returns: returns
    });
  });
  
  return {
    items: wasteItems,
    machine_name: overridesData.data.length > 0 ? overridesData.data[0].machine_name : "Unknown Machine"
  };
}

function fetchProductDetailsForStockIds(stockIds) {
  try {
    if (!stockIds || stockIds.length === 0) {
      return {};
    }
    
    const productDetails = {};
    
    stockIds.forEach(stockId => {
      try {
        const url = `${API_BASE}/stock/${stockId}`;
        
        const res = UrlFetchApp.fetch(url, {
          method: "get",
          headers: { "Authorization": "Token " + API_KEY },
          muteHttpExceptions: true
        });
        
        if (res.getResponseCode() === 200) {
          const data = JSON.parse(res.getContentText());
          if (data.result) {
            productDetails[stockId] = {
              name: data.result.name || "Unknown Product",
              id: data.result.id
            };
          }
        }
      } catch (itemError) {
        console.error(`Error fetching details for stock ID ${stockId}:`, itemError);
      }
    });
    
    return productDetails;
  } catch (error) {
    console.error("Error fetching product details:", error);
    return {};
  }
}

function getTopWasteLocationsAndProducts(filters) {
  try {
    const date = filters && filters.date ? filters.date : null;
    
    if (!date) {
      return {
        topLocations: [],
        topProducts: [],
        error: "Date is required"
      };
    }
    
    // Always analyze ALL machines for top waste analysis (system-wide view)
    const allMachines = fetchMachines();
    const machinesToAnalyze = allMachines.map(m => m.id);
    
    // Aggregate waste by location and product
    const locationWaste = {};
    const productWaste = {};
    
    // Analyze waste for each machine
    machinesToAnalyze.forEach(machineId => {
      try {
        const wasteResult = analyzeWasteForMachine(machineId, date);
        
        if (wasteResult.error || !wasteResult.items) {
          return;
        }
        
        const machineName = wasteResult.machine_name || `Machine ${machineId}`;
        let locationTotalWaste = 0;
        let locationTotalSales = 0;
        let locationTotalRefill = 0;
        
        wasteResult.items.forEach(item => {
          const originalQuantity = item.original_quantity || 0;
          const updatedQuantity = item.updated_quantity || 0;
          const refillAdded = updatedQuantity - originalQuantity;
          const totalAvailable = originalQuantity + refillAdded;
          const sales = item.sales || 0;
          const waste = totalAvailable - sales;
          
          // Aggregate by location
          locationTotalWaste += waste;
          locationTotalSales += sales;
          locationTotalRefill += refillAdded;
          
          // Aggregate by product
          const productName = item.product_name || "Unknown Product";
          if (!productWaste[productName]) {
            productWaste[productName] = {
              name: productName,
              totalWaste: 0,
              totalSales: 0,
              totalRefill: 0,
              totalAvailable: 0,
              locations: new Set()
            };
          }
          
          productWaste[productName].totalWaste += waste;
          productWaste[productName].totalSales += sales;
          productWaste[productName].totalRefill += refillAdded;
          productWaste[productName].totalAvailable += totalAvailable;
          productWaste[productName].locations.add(machineName);
        });
        
        // Store location waste
        if (locationTotalWaste > 0) {
          locationWaste[machineName] = {
            name: machineName,
            machineId: machineId,
            totalWaste: locationTotalWaste,
            totalSales: locationTotalSales,
            totalRefill: locationTotalRefill,
            wastePercent: (locationTotalSales + locationTotalWaste) > 0 
              ? (locationTotalWaste / (locationTotalSales + locationTotalWaste) * 100) 
              : 0
          };
        }
      } catch (machineError) {
        console.error(`Error analyzing waste for machine ${machineId}:`, machineError);
      }
    });
    
    // Sort and get top 5 locations
    const topLocations = Object.values(locationWaste)
      .sort((a, b) => b.totalWaste - a.totalWaste)
      .slice(0, 5)
      .map((loc, index) => ({
        rank: index + 1,
        ...loc
      }));
    
    // Sort and get top wasted products
    const topProducts = Object.values(productWaste)
      .filter(p => p.totalWaste > 0)
      .sort((a, b) => b.totalWaste - a.totalWaste)
      .slice(0, 10)
      .map((prod, index) => ({
        rank: index + 1,
        name: prod.name,
        totalWaste: prod.totalWaste,
        totalSales: prod.totalSales,
        totalRefill: prod.totalRefill,
        totalAvailable: prod.totalAvailable,
        wastePercent: prod.totalAvailable > 0 
          ? (prod.totalWaste / prod.totalAvailable * 100) 
          : 0,
        locationCount: prod.locations.size,
        locations: Array.from(prod.locations).slice(0, 3) // Show first 3 locations
      }));
    
    return {
      topLocations: topLocations,
      topProducts: topProducts,
      date: date
    };
  } catch (error) {
    console.error("Error getting top waste locations and products:", error);
    return {
      topLocations: [],
      topProducts: [],
      error: error.toString()
    };
  }
}

/**
 * Waste reasons: DB via people-analytics API only.
 * Uses PEOPLE_ANALYTICS_API_BASE (e.g. https://people-api.theleetclub.com).
 */
function getReasonsApiBase() {
  return (PropertiesService.getScriptProperties().getProperty('PEOPLE_ANALYTICS_API_BASE') || 'https://people-api.theleetclub.com').replace(/\/$/, '');
}

function getWasteReasons(dateVal, machineIds) {
  try {
    var base = getReasonsApiBase();
    var url = base + '/api/waste-reasons?date=' + encodeURIComponent(dateVal);
    if (machineIds && machineIds.length > 0) {
      url += '&machine_ids=' + encodeURIComponent(machineIds.join(','));
    }
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Accept': 'application/json' },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      return { success: false, error: 'API ' + response.getResponseCode() + ': ' + response.getContentText(), reasons: [] };
    }
    var json = JSON.parse(response.getContentText());
    if (!json.success) {
      return { success: false, error: json.error || 'API error', reasons: [] };
    }
    return { success: true, reasons: Array.isArray(json.reasons) ? json.reasons : [] };
  } catch (e) {
    return { success: false, error: e.toString(), reasons: [] };
  }
}

/**
 * Save/upsert one waste reason (DB via people-analytics API).
 */
function saveWasteReasonToApi(machineId, dateVal, reason) {
  try {
    var base = getReasonsApiBase();
    var url = base + '/api/waste-reasons';
    var payload = JSON.stringify({
      machine_id: String(machineId),
      date: dateVal,
      reason: reason || ''
    });
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      payload: payload,
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      return { success: false, error: 'API ' + response.getResponseCode() + ': ' + response.getContentText() };
    }
    var json = JSON.parse(response.getContentText());
    if (!json.success) {
      return { success: false, error: json.error || 'Save failed' };
    }
    return { success: true, machine_id: machineId, date: dateVal, reason: reason || '' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
