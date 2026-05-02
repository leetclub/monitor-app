/**
 * Reasons API base (same DB host as people-analytics).
 */
function getRemoteCreditReasonsApiBase() {
  return (PropertiesService.getScriptProperties().getProperty('PEOPLE_ANALYTICS_API_BASE') || 'https://people-api.theleetclub.com').replace(/\/$/, '');
}

/**
 * WEB CASHLESS WITH FAILED DISPENSE MATCHING
 *
 * Fetches WEB cashless transactions and matches them with
 * "Product dispense/vend failed" events to identify:
 * - Substitutions (matched with failed dispense, same product)
 * - Possible Substitutions (matched with failed dispense, different product, nearby time)
 * - Test Transactions (early morning WEB cashless)
 * - Unmatched (no nearby failed dispense - could be waste/corruption)
 */
function getRemoteCreditsLogs(filters) {
  try {
    const fromDate = filters && filters.startDate;
    const toDate = filters && filters.endDate;
    const selectedMachineId = filters && filters.machineId ? String(filters.machineId) : "";

    // Pre-fetch users once for all lookups (more efficient)
    let allUsersCache = null;
    try {
      if (typeof fetchUsers === 'function') {
        allUsersCache = fetchUsers();
      }
    } catch (e) {
      console.log("Could not pre-fetch users:", e);
    }

    if (!fromDate || !toDate) {
      throw new Error("Start date and end date are required");
    }

    const fromTimestamp = Math.floor(new Date(fromDate + "T00:00:00").getTime() / 1000);
    const toTimestamp = Math.floor(new Date(toDate + "T23:59:59").getTime() / 1000);

    const allMachines = fetchMachines();
    const targetMachines = selectedMachineId
      ? allMachines.filter(m => String(m.id) === selectedMachineId)
      : allMachines;

    // Step 1: Fetch all WEB cashless vends
    const webCashlessVends = [];
    const limit = 1000;

    targetMachines.forEach(machine => {
      try {
        let offset = 0;
        let hasMore = true;
        let page = 0;
        const machineIdStr = String(machine.id);

        while (hasMore && page < 50) {
          page++;

          let url = API_BASE + "/stats/vends?from_timestamp=" + fromTimestamp +
            "&to_timestamp=" + toTimestamp +
            "&machine_id=" + encodeURIComponent(machineIdStr) +
            "&limit=" + limit +
            "&offset=" + offset;

          const options = {
            method: "get",
            headers: { "Authorization": "Token " + API_KEY },
            muteHttpExceptions: true
          };

          const response = UrlFetchApp.fetch(url, options);
          const responseCode = response.getResponseCode();
          const text = response.getContentText();

          if (responseCode !== 200) {
            console.error("WEB cashless stats error for machine", machineIdStr, ":", responseCode);
            break;
          }

          let json;
          try {
            json = JSON.parse(text);
          } catch (e) {
            console.error("WEB cashless stats JSON parse error");
            break;
          }

          if (json.code !== 200 || !json.result || json.result.length === 0) {
            hasMore = false;
            break;
          }

          const vends = json.result;
          vends.forEach(vend => {
            if (isWebCashlessVend(vend)) {
              const amount = vend.price || 0;
              const ts = vend.datetime || vend.timestamp || vend.time;
              const productName = vend.name || vend.product_name || "";
              
              webCashlessVends.push({
                id: vend.id,
                timestamp: ts,
                datetime: ts ? new Date(ts * 1000) : null,
                machine_id: machine.id,
                machine_name: machine.name || ("Machine " + machine.id),
                user_id: vend.user_id || "",
                user_name: vend.user_name || "",
                credit_amount: amount,
                product_name: productName,
                selection: vend.selection || vend.product_id || ""
              });
            }
          });

          if (vends.length < limit) {
            hasMore = false;
          } else {
            offset += limit;
          }
        }
      } catch (machineError) {
        console.error("Error fetching WEB cashless vends for machine " + machine.id + ":", machineError);
      }
    });

    // Step 2: Fetch "Product dispense/vend failed" events
    const failedDispenses = [];
    const eventMachineIds = selectedMachineId ? [selectedMachineId] : targetMachines.map(m => String(m.id));
    
    eventMachineIds.forEach(machineId => {
      try {
        let offset = 0;
        let hasMore = true;
        const pageLimit = 500;

        while (hasMore) {
          const params = {
            from_timestamp: fromTimestamp,
            to_timestamp: toTimestamp,
            machine_id: machineId,
            limit: pageLimit,
            offset: offset
          };
          const query = Object.keys(params).map(k => `${k}=${params[k]}`).join("&");
          const url = `${API_BASE}/event?${query}`;
          
          const res = UrlFetchApp.fetch(url, { 
            headers: { Authorization: "Token " + API_KEY },
            muteHttpExceptions: true
          });

          if (res.getResponseCode() !== 200) {
            console.error("Events API error for machine", machineId, ":", res.getResponseCode());
            break;
          }

          const json = JSON.parse(res.getContentText());
          const pageResults = Array.isArray(json.result) ? json.result : [];
          
          let failedDispenseCountThisPage = 0;
          pageResults.forEach(event => {
            // Check if this is a "Product dispense/vend failed" event
            // Try multiple variations of the event name
            const eventName = (event.name || event.base_code || event.type || "").toLowerCase();
            const eventDesc = (event.description || event.data || "").toLowerCase();
            const isFailedDispense = 
              eventName.includes("dispense") && eventName.includes("failed") ||
              eventName.includes("vend") && eventName.includes("failed") ||
              eventName === "product dispense/vend failed" ||
              eventName === "product dispense/vend failed".toLowerCase() ||
              eventDesc.includes("dispense") && eventDesc.includes("failed") ||
              eventDesc.includes("vend failed");
            
            if (isFailedDispense) {
              
              // Extract product name from event description/data
              let productName = "";
              let selection = "";
              
              // Try multiple sources for product name
              const description = event.description || event.data || event.payload || "";
              const eventData = event.data || {};
              
              if (description) {
                // Try to extract product name from description like "Product Karak, selection 20"
                // Or "Product Karak, selection 20, dispense/vend failed when paid by Cashless"
                const productMatch = description.match(/Product\s+([^,]+)/i);
                if (productMatch) productName = productMatch[1].trim();
                
                const selectionMatch = description.match(/selection\s+(\d+)/i);
                if (selectionMatch) selection = selectionMatch[1];
              }
              
              // Also try event.data fields
              if (!productName && eventData.product_name) {
                productName = eventData.product_name;
              }
              if (!productName && eventData.product) {
                productName = eventData.product;
              }
              if (!productName && eventData.name) {
                productName = eventData.name;
              }
              if (!selection && eventData.selection) {
                selection = String(eventData.selection);
              }
              
              const eventTs = event.datetime || event.received_at || event.timestamp;
              
              failedDispenses.push({
                id: event.id,
                timestamp: eventTs,
                datetime: eventTs ? new Date(eventTs * 1000) : null,
                machine_id: event.machine_id || machineId,
                machine_name: event.machine_name || "",
                product_name: productName,
                selection: selection,
                description: description
              });
              failedDispenseCountThisPage++;
            }
          });
          
          if (failedDispenseCountThisPage > 0) {
            console.log(`Machine ${machineId}: Found ${failedDispenseCountThisPage} failed dispense events on page (offset ${offset})`);
          }

          if (json.paging && failedDispenses.length >= json.paging.total) break;
          if (pageResults.length < pageLimit) break;
          offset += pageLimit;
          
          if (offset >= 5000) break; // Safety limit
        }
        
        const machineFailedCount = failedDispenses.filter(fd => String(fd.machine_id) === String(machineId)).length;
        if (machineFailedCount > 0) {
          console.log(`Machine ${machineId}: Total ${machineFailedCount} failed dispense events found`);
        }
      } catch (error) {
        console.error("Error fetching failed dispenses for machine " + machineId + ":", error);
      }
    });

    // Step 2.5: Fetch remote credits from settingChangeLog (with "Vend successful")
    const remoteCreditsRaw = [];
    targetMachines.forEach(machine => {
      try {
        const credits = fetchRemoteCreditsFromSettingChangeLog(
          machine.id,
          fromDate,
          toDate
        ) || [];
        remoteCreditsRaw.push(...credits);
      } catch (error) {
        console.error("Error fetching remote credits for machine " + machine.id + ":", error);
      }
    });

    // Deduplicate remote credits (same machine, same amount, same timestamp - within 1 minute)
    const remoteCredits = [];
    const seen = new Set();
    
    remoteCreditsRaw.forEach(credit => {
      const key = `${credit.machine_id}_${credit.credit_amount}_${credit.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        remoteCredits.push({
          id: credit.id,
          timestamp: credit.timestamp,
          datetime: credit.timestamp ? new Date(credit.timestamp * 1000) : null,
          machine_id: credit.machine_id,
          machine_name: credit.machine_name || "",
          credit_amount: credit.credit_amount || 0,
          user_name: credit.user_name || "",
          status: credit.status || ""
        });
      }
    });

    console.log(`Found ${remoteCreditsRaw.length} remote credits, ${remoteCredits.length} after deduplication`);
    console.log(`Found ${failedDispenses.length} failed dispense events`);
    console.log(`Found ${webCashlessVends.length} WEB cashless transactions`);
    
    // Debug: Log sample of failed dispenses and WEB cashless
    if (failedDispenses.length > 0) {
      console.log("Sample failed dispense:", JSON.stringify({
        machine_id: failedDispenses[0].machine_id,
        product_name: failedDispenses[0].product_name,
        datetime: failedDispenses[0].datetime,
        description: failedDispenses[0].description
      }));
    }
    if (webCashlessVends.length > 0) {
      console.log("Sample WEB cashless:", JSON.stringify({
        machine_id: webCashlessVends[0].machine_id,
        product_name: webCashlessVends[0].product_name,
        datetime: webCashlessVends[0].datetime,
        credit_amount: webCashlessVends[0].credit_amount
      }));
    }

    // Step 3: Match WEB cashless with failed dispenses AND remote credits, then categorize
    // Business Requirements:
    // 1. Custom Refunds: Matched with "Vend Failed" within 5 minutes (Customer Service KPI)
    // 2. Drink Tests: First WEB cashless of day + transactions within 30 minutes
    // 3. Reason Unidentified: Everything else (with editable reason field)
    
    const logs = [];
    const totalsByMachine = {};
    const CUSTOM_REFUND_WINDOW_MINUTES = 5; // Customer Service KPI: 5 minutes
    const DRINK_TEST_WINDOW_MINUTES = 30; // 30-minute window from first transaction
    const TIME_WINDOW_MINUTES = 10; // For remote credit matching
    const AMOUNT_TOLERANCE = 0.01; // Match amounts within 0.01 tolerance

    // Group WEB cashless by machine and date to find first transaction of day (for Drink Tests)
    const firstTransactionByMachineDay = {};
    webCashlessVends.forEach(wc => {
      if (!wc.datetime) return;
      const dateKey = `${wc.machine_id}_${wc.datetime.toDateString()}`;
      if (!firstTransactionByMachineDay[dateKey] || 
          wc.datetime.getTime() < firstTransactionByMachineDay[dateKey].getTime()) {
        firstTransactionByMachineDay[dateKey] = wc.datetime;
      }
    });

    // Normalize timestamp to Unix seconds (Vendon may return seconds or milliseconds)
    function toSeconds(ts) {
      if (ts == null || ts === '') return 0;
      var n = typeof ts === 'number' ? ts : parseInt(String(ts), 10);
      if (isNaN(n)) return 0;
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    }
    // Same key as save: log_id|machine_id|timestamp (machine_id "_" when empty)
    function reasonKey(logId, machineId, tsSeconds) {
      var mid = (machineId != null && String(machineId).trim() !== '') ? String(machineId) : '_';
      return String(logId || '') + '|' + mid + '|' + String(tsSeconds || 0);
    }
    function machineTsKey(machineId, tsSeconds) {
      var mid = (machineId != null && String(machineId).trim() !== '') ? String(machineId) : '_';
      return mid + '|' + String(tsSeconds || 0);
    }
    // Batch-fetch ALL saved reasons for date range (no machine filter so we never miss)
    const reasonsByKey = {};
    const reasonsByMachineTs = {};
    var batchFetched = false;
    try {
      const base = getRemoteCreditReasonsApiBase();
      var tryPath = function (path) {
        try {
          var u = base + path + '?start_date=' + encodeURIComponent(fromDate) + '&end_date=' + encodeURIComponent(toDate);
          var r = UrlFetchApp.fetch(u, { method: 'get', headers: { 'Accept': 'application/json' }, muteHttpExceptions: true });
          if (r.getResponseCode() === 200) {
            var d = JSON.parse(r.getContentText());
            if (d.success && Array.isArray(d.reasons)) {
              d.reasons.forEach(function (re) {
                var keyTs = toSeconds(re.timestamp);
                var k = reasonKey(re.log_id, re.machine_id, keyTs);
                reasonsByKey[k] = re.reason || '';
                reasonsByMachineTs[machineTsKey(re.machine_id, keyTs)] = re.reason || '';
              });
              return true;
            }
          }
        } catch (err) { /* ignore */ }
        return false;
      };
      batchFetched = tryPath('/api/remote-credit-reasons') || tryPath('/remote-credit-reasons');
      if (!batchFetched) {
        console.warn('Remote credit reasons batch fetch failed for both /api/remote-credit-reasons and /remote-credit-reasons. Check PEOPLE_ANALYTICS_API_BASE and API deployment.');
      }
    } catch (e) {
      console.warn('Could not fetch remote credit reasons from API:', e);
    }

    webCashlessVends.forEach(webCashless => {
      if (!webCashless.datetime) return;

      const webCashlessTime = webCashless.datetime.getTime();
      const webCashlessDate = new Date(webCashlessTime);
      const webCashlessHour = webCashlessDate.getHours();
      const dateKey = `${webCashless.machine_id}_${webCashlessDate.toDateString()}`;
      const isFirstOfDay = firstTransactionByMachineDay[dateKey] && 
                          Math.abs(webCashlessTime - firstTransactionByMachineDay[dateKey].getTime()) < 60000; // Within 1 minute
      
      // Find matching failed dispenses (same machine, same day)
      const sameMachineDayFailed = failedDispenses.filter(failed => {
        if (!failed.datetime) return false;
        if (String(failed.machine_id) !== String(webCashless.machine_id)) return false;
        const sameDay = webCashlessDate.toDateString() === failed.datetime.toDateString();
        return sameDay;
      });
      
      // Check for Custom Refunds: Failed dispense within 5 minutes (Customer Service KPI)
      const matchingFailedWithin5Min = sameMachineDayFailed.filter(failed => {
        const failedTime = failed.datetime.getTime();
        const timeDiffMinutes = Math.abs((webCashlessTime - failedTime) / (1000 * 60));
        return timeDiffMinutes <= CUSTOM_REFUND_WINDOW_MINUTES;
      });
      
      // Check if within Drink Test window (30 minutes from first transaction of day)
      const firstTransactionOfDay = firstTransactionByMachineDay[dateKey];
      const isWithinDrinkTestWindow = firstTransactionOfDay && 
        Math.abs(webCashlessTime - firstTransactionOfDay.getTime()) <= (DRINK_TEST_WINDOW_MINUTES * 60 * 1000);
      
      // Debug: Log nearby failed dispenses
      if (sameMachineDayFailed.length > 0) {
        sameMachineDayFailed.forEach(failed => {
          const failedTime = failed.datetime.getTime();
          const timeDiffMinutes = Math.abs((webCashlessTime - failedTime) / (1000 * 60));
          if (timeDiffMinutes <= 10) { // Log if within 10 minutes
            console.log(`WEB cashless [${webCashless.product_name}] at ${webCashless.datetime.toISOString()} - Nearby failed dispense [${failed.product_name}] at ${failed.datetime.toISOString()}, time diff: ${timeDiffMinutes.toFixed(1)} min`);
          }
        });
      }

      // Find matching remote credits (for confirmation only, not for primary categorization)
      const matchingRemoteCredits = remoteCredits.filter(rc => {
        if (!rc.datetime) return false;
        if (String(rc.machine_id) !== String(webCashless.machine_id)) return false;
        
        const amountMatch = Math.abs((rc.credit_amount || 0) - webCashless.credit_amount) <= AMOUNT_TOLERANCE;
        if (!amountMatch) return false;
        
        const rcTime = rc.datetime.getTime();
        const timeDiffMinutes = Math.abs((webCashlessTime - rcTime) / (1000 * 60));
        
        // Same day and within time window
        const sameDay = webCashlessDate.toDateString() === rc.datetime.toDateString();
        return sameDay && timeDiffMinutes <= TIME_WINDOW_MINUTES;
      });

      let category = "Reason Unidentified";
      let matchedFailedDispense = null;
      let matchedRemoteCredit = null;
      let categoryNote = "";
      let manualReason = ""; // For editable reason field
      
      // Load saved manual reason if this is "Reason Unidentified"
      // (We'll check category later and load if needed)

      // PRIORITY 1: Custom Refunds - Matched with failed dispense within 5 minutes (Customer Service KPI)
      if (matchingFailedWithin5Min.length > 0) {
        // Sort failed dispenses: prefer same product, then closest time
        matchingFailedWithin5Min.sort((a, b) => {
          const timeDiffA = Math.abs(webCashlessTime - a.datetime.getTime());
          const timeDiffB = Math.abs(webCashlessTime - b.datetime.getTime());
          
          const sameProductA = a.product_name && webCashless.product_name && 
                              a.product_name.toLowerCase().trim() === webCashless.product_name.toLowerCase().trim();
          const sameProductB = b.product_name && webCashless.product_name && 
                              b.product_name.toLowerCase().trim() === webCashless.product_name.toLowerCase().trim();
          
          // Prefer same product
          if (sameProductA && !sameProductB) return -1;
          if (!sameProductA && sameProductB) return 1;
          // Then prefer closest time
          return timeDiffA - timeDiffB;
        });

        matchedFailedDispense = matchingFailedWithin5Min[0];
        const sameProduct = matchedFailedDispense.product_name && webCashless.product_name &&
                           matchedFailedDispense.product_name.toLowerCase().trim() === webCashless.product_name.toLowerCase().trim();
        
        // Check for remote credit match (for confirmation)
        if (matchingRemoteCredits.length > 0) {
          matchingRemoteCredits.sort((a, b) => {
            const timeDiffA = Math.abs(webCashlessTime - a.datetime.getTime());
            const timeDiffB = Math.abs(webCashlessTime - b.datetime.getTime());
            return timeDiffA - timeDiffB;
          });
          matchedRemoteCredit = matchingRemoteCredits[0];
        }
        
        category = "Custom Refunds";
        const timeDiff = Math.abs((webCashlessTime - matchedFailedDispense.datetime.getTime()) / (1000 * 60));
        categoryNote = `Matched with failed dispense "${matchedFailedDispense.product_name || "product"}" within ${timeDiff.toFixed(1)} minutes (Customer Service KPI: 5 min)` +
                      (matchedRemoteCredit ? " - confirmed by remote credit" : "");
        
      } else if (isWithinDrinkTestWindow) {
        // PRIORITY 2: Drink Tests - Within 30 minutes of first WEB cashless of day
        category = "Drink Tests";
        const timeFromFirst = Math.abs(webCashlessTime - firstTransactionOfDay.getTime()) / (1000 * 60);
        categoryNote = `Within ${timeFromFirst.toFixed(1)} minutes of first WEB cashless of day (${firstTransactionOfDay.toLocaleTimeString()}) - QA drink test`;
        
      } else {
        // PRIORITY 3: Reason Unidentified - Everything else
        category = "Reason Unidentified";
        categoryNote = "No failed dispense within 5 minutes and not within drink test window";
        var normalizedTs = toSeconds(webCashless.timestamp) || (webCashless.datetime ? Math.floor(webCashless.datetime.getTime() / 1000) : 0);
        var fullKey = reasonKey(webCashless.id, webCashless.machine_id, normalizedTs);
        manualReason = reasonsByKey[fullKey] || reasonsByMachineTs[machineTsKey(webCashless.machine_id, normalizedTs)] || "";
        
        // Check for remote credit (for info only)
        if (matchingRemoteCredits.length > 0) {
          matchingRemoteCredits.sort((a, b) => {
            const timeDiffA = Math.abs(webCashlessTime - a.datetime.getTime());
            const timeDiffB = Math.abs(webCashlessTime - b.datetime.getTime());
            return timeDiffA - timeDiffB;
          });
          matchedRemoteCredit = matchingRemoteCredits[0];
          categoryNote += " (remote credit found)";
        }
      }

      // Get user name with priority:
      // 1. Matched remote credit user_name (if remote credit found)
      // 2. Web cashless user_name (from Vendon API directly - vend.user_name)
      // 3. Lookup by user_id if user_name is missing (vend.user_id -> fetchUsers lookup)
      let displayUserName = "";
      let userSource = "none"; // Track where user came from for debugging
      
      if (matchedRemoteCredit && matchedRemoteCredit.user_name) {
        // Priority 1: User from matched remote credit
        displayUserName = matchedRemoteCredit.user_name;
        userSource = "remote_credit";
      } else if (webCashless.user_name) {
        // Priority 2: User name from web cashless transaction itself (Vendon API)
        displayUserName = webCashless.user_name;
        userSource = "vendon_api_user_name";
      } else if (webCashless.user_id && allUsersCache && allUsersCache.length > 0) {
        // Priority 3: Look up user by ID if user_name is missing
        try {
          const user = allUsersCache.find(u => String(u.id) === String(webCashless.user_id));
          if (user) {
            displayUserName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
            userSource = "vendon_api_user_id_lookup";
          } else {
            userSource = "vendon_api_user_id_not_found";
          }
        } catch (e) {
          userSource = "vendon_api_user_id_lookup_error";
        }
      } else if (webCashless.user_id) {
        userSource = "vendon_api_user_id_no_cache";
      } else {
        userSource = "no_user_data";
      }
      
      // Debug logging for user source (can be removed in production)
      if (displayUserName) {
        console.log(`User "${displayUserName}" for transaction ${webCashless.id} at ${webCashless.datetime.toISOString()} - Source: ${userSource}, user_id: ${webCashless.user_id || "none"}, vend.user_name: ${webCashless.user_name || "none"}`);
      } else {
        console.log(`No user for transaction ${webCashless.id} at ${webCashless.datetime.toISOString()} - Source: ${userSource}, user_id: ${webCashless.user_id || "none"}, vend.user_name: ${webCashless.user_name || "none"}`);
      }

      var normalizedTsForLog = toSeconds(webCashless.timestamp) || (webCashless.datetime ? Math.floor(webCashless.datetime.getTime() / 1000) : 0);
      logs.push({
        id: webCashless.id,
        timestamp: normalizedTsForLog,
        datetime: webCashless.datetime.toISOString(),
        machine_id: webCashless.machine_id,
        machine_name: webCashless.machine_name,
        user_id: webCashless.user_id,
        user_name: displayUserName, // Prioritize remote credit user
        credit_amount: webCashless.credit_amount,
        status: category,
        allowed_products: webCashless.product_name,
        user_type: "",
        source: "stats/vends",
        category: category,
        category_note: categoryNote,
        manual_reason: manualReason, // Editable reason for "Reason Unidentified"
        matched_failed_dispense: matchedFailedDispense ? {
          product_name: matchedFailedDispense.product_name,
          selection: matchedFailedDispense.selection,
          timestamp: matchedFailedDispense.timestamp,
          datetime: matchedFailedDispense.datetime ? matchedFailedDispense.datetime.toISOString() : "",
          description: matchedFailedDispense.description
        } : null,
        matched_remote_credit: matchedRemoteCredit ? {
          amount: matchedRemoteCredit.credit_amount,
          user_name: matchedRemoteCredit.user_name,
          timestamp: matchedRemoteCredit.timestamp,
          datetime: matchedRemoteCredit.datetime ? matchedRemoteCredit.datetime.toISOString() : ""
        } : null
      });

      // Update totals
      if (!totalsByMachine[webCashless.machine_id]) {
        totalsByMachine[webCashless.machine_id] = {
          machine_id: webCashless.machine_id,
          machine_name: webCashless.machine_name,
          total_amount: 0,
          count: 0,
          custom_refunds_count: 0,
          drink_tests_count: 0,
          reason_unidentified_count: 0
        };
      }

      totalsByMachine[webCashless.machine_id].total_amount += webCashless.credit_amount;
      totalsByMachine[webCashless.machine_id].count += 1;
      
      if (category === "Custom Refunds") {
        totalsByMachine[webCashless.machine_id].custom_refunds_count += 1;
      } else if (category === "Drink Tests") {
        totalsByMachine[webCashless.machine_id].drink_tests_count += 1;
      } else if (category === "Reason Unidentified") {
        totalsByMachine[webCashless.machine_id].reason_unidentified_count += 1;
      }
    });

    // Sort logs by timestamp descending (newest first)
    logs.sort(function(a, b) {
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    // Sort totals by count descending (highest count first)
    const totals = Object.values(totalsByMachine);
    totals.sort(function(a, b) {
      return (b.count || 0) - (a.count || 0);
    });

    // Debug: Log category breakdown
    const categoryBreakdown = {
      customRefunds: logs.filter(l => l.category === "Custom Refunds").length,
      drinkTests: logs.filter(l => l.category === "Drink Tests").length,
      reasonUnidentified: logs.filter(l => l.category === "Reason Unidentified").length
    };
    console.log("=== MATCHING SUMMARY ===");
    console.log("Category breakdown:", JSON.stringify(categoryBreakdown));
    console.log("Total WEB cashless:", webCashlessVends.length);
    console.log("Total failed dispenses found:", failedDispenses.length);
    
    // Per-machine breakdown
    const machineStats = {};
    webCashlessVends.forEach(wc => {
      const mid = String(wc.machine_id);
      if (!machineStats[mid]) {
        machineStats[mid] = { machine_name: wc.machine_name, webCashless: 0, failedDispenses: 0, matches: 0 };
      }
      machineStats[mid].webCashless++;
    });
    failedDispenses.forEach(fd => {
      const mid = String(fd.machine_id);
      if (!machineStats[mid]) {
        machineStats[mid] = { machine_name: fd.machine_name || "Unknown", webCashless: 0, failedDispenses: 0, matches: 0 };
      }
      machineStats[mid].failedDispenses++;
    });
    logs.forEach(log => {
      if (log.matched_failed_dispense) {
        const mid = String(log.machine_id);
        if (machineStats[mid]) machineStats[mid].matches++;
      }
    });
    
    console.log("Per-machine stats:");
    Object.keys(machineStats).forEach(mid => {
      const stats = machineStats[mid];
      console.log(`  ${stats.machine_name} (${mid}): ${stats.webCashless} WEB cashless, ${stats.failedDispenses} failed dispenses, ${stats.matches} matches`);
    });

    return {
      success: true,
      logs: logs,
      totals: totals,
      filters: {
        startDate: fromDate,
        endDate: toDate,
        machineId: selectedMachineId || ""
      }
    };
  } catch (error) {
    console.error("Error in getRemoteCreditsLogs (WEB cashless with matching):", error);
    return {
      success: false,
      error: error.message || String(error),
      logs: [],
      totals: []
    };
  }
}

/**
 * Find the machine with the highest WEB cashless event count in the given range.
 * Defaults to yesterday when no dates are provided.
 * Returns top machine plus per-machine counts so the frontend can preload.
 */
function getTopWebCashlessMachine(startDate, endDate) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultDate = yesterday.toISOString().split("T")[0];

    const fromDate = startDate || defaultDate;
    const toDate = endDate || fromDate;

    const fromTimestamp = Math.floor(new Date(fromDate + "T00:00:00").getTime() / 1000);
    const toTimestamp = Math.floor(new Date(toDate + "T23:59:59").getTime() / 1000);

    const machines = fetchMachines() || [];
    const limit = 1000;
    const counts = [];
    let bestMachine = null;

    machines.forEach(machine => {
      let count = 0;
      let offset = 0;
      let hasMore = true;
      let page = 0;
      const machineIdStr = String(machine.id);

      while (hasMore && page < 50) {
        page++;

        const url = `${API_BASE}/stats/vends?from_timestamp=${fromTimestamp}` +
          `&to_timestamp=${toTimestamp}` +
          `&machine_id=${encodeURIComponent(machineIdStr)}` +
          `&limit=${limit}` +
          `&offset=${offset}`;

        const options = {
          method: "get",
          headers: { "Authorization": "Token " + API_KEY },
          muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch(url, options);
        if (response.getResponseCode() !== 200) {
          console.error("WEB cashless count error for machine", machineIdStr, ":", response.getResponseCode());
          break;
        }

        let json;
        try {
          json = JSON.parse(response.getContentText());
        } catch (e) {
          console.error("WEB cashless count JSON parse error for machine", machineIdStr, e);
          break;
        }

        const vends = (json && json.result) ? json.result : [];
        vends.forEach(vend => {
          if (isWebCashlessVend(vend)) {
            count++;
          }
        });

        if (vends.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }

      const machineEntry = {
        machine_id: machine.id,
        machine_name: machine.name || ("Machine " + machine.id),
        count: count
      };
      counts.push(machineEntry);

      if (!bestMachine || count > bestMachine.count) {
        bestMachine = machineEntry;
      }
    });

    counts.sort((a, b) => (b.count || 0) - (a.count || 0));

    return {
      success: true,
      bestMachine: bestMachine || (counts.length > 0 ? counts[0] : null),
      counts: counts,
      fromDate: fromDate,
      toDate: toDate
    };
  } catch (error) {
    console.error("Error in getTopWebCashlessMachine:", error);
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * Try to detect WEB cashless vends robustly.
 * Vendon may expose payment type in different fields.
 */
function isWebCashlessVend(vend) {
  try {
    // Most robust: look for "WEB" and "CASHLESS" anywhere in the vend JSON
    const jsonStr = JSON.stringify(vend || {}).toUpperCase();
    if (jsonStr.indexOf("WEB") !== -1 && jsonStr.indexOf("CASHLESS") !== -1) {
      return true;
    }

    // Fallback: check common payment fields for either "WEB" or "CASHLESS"
    const candidates = [];
    if (vend.payment_type) candidates.push(String(vend.payment_type));
    if (vend.payment_type_name) candidates.push(String(vend.payment_type_name));
    if (vend.type) candidates.push(String(vend.type));
    if (vend.pay_type) candidates.push(String(vend.pay_type));
    if (vend.pay_type_name) candidates.push(String(vend.pay_type_name));

    if (candidates.length === 0) return false;

    return candidates.some(function(val) {
      const upper = val.toUpperCase();
      return upper.indexOf("WEB") !== -1 || upper.indexOf("CASHLESS") !== -1;
    });
  } catch (e) {
    return false;
  }
}

/**
 * Save manual reason for a remote credit transaction (DB via people-analytics API).
 * @param {string} logId - The log ID
 * @param {string} reason - The manual reason text
 * @param {string} machineId - Machine ID
 * @param {string|number} timestamp - Transaction timestamp (Unix seconds)
 * @return {object} Success status
 */
function saveRemoteCreditManualReason(logId, reason, machineId, timestamp) {
  try {
    if (!logId) {
      return { success: false, message: "Log ID is required" };
    }
    var rawTs = timestamp != null ? (typeof timestamp === 'number' ? timestamp : parseInt(String(timestamp), 10)) : 0;
    if (isNaN(rawTs)) rawTs = 0;
    // Normalize to Unix seconds (frontend may send seconds or milliseconds)
    var ts = rawTs > 1e12 ? Math.floor(rawTs / 1000) : Math.floor(rawTs);
    var base = getRemoteCreditReasonsApiBase();
    var payload = JSON.stringify({
      log_id: String(logId),
      machine_id: machineId != null && String(machineId).trim() !== "" ? String(machineId) : "_",
      timestamp: ts,
      reason: reason != null ? String(reason).trim() : ""
    });
    var paths = ['/api/remote-credit-reasons', '/remote-credit-reasons'];
    for (var p = 0; p < paths.length; p++) {
      var url = base + paths[p];
      var resp = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        payload: payload,
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() === 200) {
        var json = JSON.parse(resp.getContentText());
        if (json.success) return { success: true, message: "Reason saved successfully" };
        return { success: false, message: json.error || "Save failed" };
      }
      if (resp.getResponseCode() !== 404) {
        return { success: false, message: "API " + resp.getResponseCode() + ": " + resp.getContentText() };
      }
    }
    return { success: false, message: "API not reachable (tried both /api/remote-credit-reasons and /remote-credit-reasons)" };
  } catch (error) {
    console.error("Error saving manual reason:", error);
    return { success: false, message: "Error saving reason: " + error.toString() };
  }
}

/**
 * Get manual reason for a remote credit transaction (DB via people-analytics API).
 * @param {string} logId - The log ID
 * @param {string} machineId - Machine ID
 * @param {string|number} timestamp - Transaction timestamp (Unix seconds)
 * @return {string} The manual reason or empty string
 */
function getRemoteCreditManualReason(logId, machineId, timestamp) {
  try {
    if (!logId) return "";
    var ts = timestamp != null ? (typeof timestamp === 'number' ? timestamp : parseInt(String(timestamp), 10)) : 0;
    if (isNaN(ts)) ts = 0;
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    var base = getRemoteCreditReasonsApiBase();
    var q = 'log_id=' + encodeURIComponent(String(logId)) + '&timestamp=' + encodeURIComponent(String(ts));
    if (machineId != null && String(machineId).trim() !== "") {
      q += '&machine_id=' + encodeURIComponent(String(machineId));
    }
    var paths = ['/api/remote-credit-reasons', '/remote-credit-reasons'];
    for (var i = 0; i < paths.length; i++) {
      var resp = UrlFetchApp.fetch(base + paths[i] + '?' + q, { method: 'get', headers: { 'Accept': 'application/json' }, muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var data = JSON.parse(resp.getContentText());
        if (data.success && Array.isArray(data.reasons) && data.reasons.length > 0) return data.reasons[0].reason || "";
      }
    }
    return "";
  } catch (error) {
    console.error("Error getting manual reason:", error);
    return "";
  }
}
