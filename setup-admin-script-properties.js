// Run this in Apps Script to set up admin panel properties
// Go to Apps Script Editor > Run > setupAdminProperties

/**
 * Set the Slack "issues-actions" list ID for the QA Findings tab.
 * Get the list ID: In Slack, open the issues-actions list in browser → F12 → Network →
 * find a request containing list_id (e.g. lists.records.list or slackLists.items.list) → copy the list_id value (e.g. F08NW0659RP).
 * Then: Run > setIssuesActionsListId('YOUR_LIST_ID_HERE')
 */
function setIssuesActionsListId(listId) {
  if (!listId || typeof listId !== 'string' || !listId.trim()) {
    Logger.log('Usage: setIssuesActionsListId("F08NW0659RP")  — replace with your issues-actions list ID.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SLACK_ISSUES_ACTIONS_LIST_ID', listId.trim());
  Logger.log('✅ SLACK_ISSUES_ACTIONS_LIST_ID set to: ' + listId.trim());
}

/**
 * One-off: set the issues-actions list ID from here, then run this function (Run > setIssuesActionsListIdOnce).
 * Replace the string below with your actual list ID (e.g. from Slack F12 → Network → list request → list_id).
 */
function setIssuesActionsListIdOnce() {
  var listId = 'YOUR_ISSUES_ACTIONS_LIST_ID_HERE';  // e.g. 'F08NW0659RP'
  setIssuesActionsListId(listId);
}

/**
 * Set option ID → label map for QA Findings (Location/VM, Status, etc.) when cookie token is expired.
 * The OAuth API only returns IDs (e.g. Opt0ADMCH9YDR); this map makes the table show labels instead.
 * Get IDs from Cloud logs (QA Findings sample item / field layout). Get labels from Slack list column options.
 * Run: setIssuesActionsOptionLabels({ "Opt0ADMCH9YDR": "#kfst", "OptEY59BDXL": "Done" })
 */
function setIssuesActionsOptionLabels(labelsObj) {
  if (!labelsObj || typeof labelsObj !== 'object') {
    Logger.log('Usage: setIssuesActionsOptionLabels({ "Opt0ADMCH9YDR": "#kfst", "OptEY59BDXL": "Done" })');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SLACK_ISSUES_ACTIONS_OPTION_LABELS', JSON.stringify(labelsObj));
  Logger.log('✅ SLACK_ISSUES_ACTIONS_OPTION_LABELS set with ' + Object.keys(labelsObj).length + ' entries.');
}

/**
 * One-off: edit the object below with your Opt ID → label map (from Cloud logs + Slack list), then Run > setIssuesActionsOptionLabelsOnce.
 */
function setIssuesActionsOptionLabelsOnce() {
  var labels = {
    'Opt0ADMCH9YDR': '#kfst',   // VM/Location (index 0) – replace with your VM name from Slack
    'OptEY59BDXL': 'Done'      // Status/Resolved (index 2) – replace with your status label from Slack
    // Add more: 'OptXXXXXXXX': 'Label'
  };
  setIssuesActionsOptionLabels(labels);
}

/**
 * Extract and save QA option labels from the lists.records.list response (real labels from Slack).
 * Note: lists.records.list returns only records (option IDs), not list schema (option labels). If the
 * pasted response has no labels, the log will list the Opt IDs found – add them to SLACK_ISSUES_ACTIONS_OPTION_LABELS
 * with labels from your Slack list (run setIssuesActionsOptionLabels({ "OptXXX": "Label", ... })).
 *
 * To fix invalid_auth: set SLACK_COOKIE_HEADER to the full Cookie header from the browser (same request
 * as lists.records.list). The app will then try internal APIs (lists.get, lists.view, etc.) with that
 * Cookie to fetch option labels the same way the browser does.
 *
 * To find which request has the mapping: F12 → Network → open the list → in each request's Response,
 * search (Ctrl+F) for an option ID (e.g. Opt0ADMCH9YDR). The one that also contains a readable label
 * in the same object is the schema request. Paste that response into QA_FINDINGS_RAW_RESPONSE and run
 * setQaOptionLabelsFromPastedResponse.
 */
function setQaOptionLabelsFromPastedResponse() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('QA_FINDINGS_RAW_RESPONSE');
  if (!raw || !raw.trim()) {
    Logger.log('No pasted response. Set Script Property QA_FINDINGS_RAW_RESPONSE to the full JSON from lists.records.list (Response tab in Network), then run this again.');
    return;
  }
  var data;
  try {
    data = JSON.parse(raw.trim());
  } catch (e) {
    Logger.log('Invalid JSON in QA_FINDINGS_RAW_RESPONSE: ' + e.toString());
    return;
  }
  if (!data || typeof data !== 'object') {
    Logger.log('QA_FINDINGS_RAW_RESPONSE must be the full lists.records.list response object.');
    return;
  }
  var extracted = extractOptionMapFromListResponse(data);
  var keys = Object.keys(extracted);
  if (keys.length === 0) {
    // Response has no list schema – only records with Opt IDs. Build a placeholder map so user has one list to fill.
    var optIds = collectOptIdsFromListRecordsResponse(data);
    if (optIds.length > 0) {
      var placeholderMap = {};
      for (var p = 0; p < optIds.length; p++) placeholderMap[optIds[p]] = '?';
      setSavedQaOptionLabels(placeholderMap);
      Logger.log('Saved placeholder map for ' + optIds.length + ' option IDs (labels will show as ? until you set them).');
      Logger.log('In Script Properties open SLACK_ISSUES_ACTIONS_OPTION_LABELS and replace each "?" with the real label from Slack for that option (e.g. "Opt0ADMCH9YDR": "#kfst", "OptEY59BDXL": "Done"). Option IDs: ' + optIds.join(', '));
    } else {
      Logger.log('No option labels and no Opt IDs found. Response keys: ' + Object.keys(data).join(', '));
    }
    return;
  }
  setSavedQaOptionLabels(extracted);
  Logger.log('Saved ' + keys.length + ' option labels from pasted response. Reload the app; QA Findings should show real labels. You can delete property QA_FINDINGS_RAW_RESPONSE if you want.');
}

function setupAdminProperties() {
  var properties = PropertiesService.getScriptProperties();
  
  // Set admin API URL (update if your API is at a different URL)
  properties.setProperty('ADMIN_API_URL', 'https://vendon-api.theleetclub.com');
  
  // Get admin API key from k8s secret and set it here
  // Run: kubectl get secret -n leet-monitor people-analytics-secrets -o jsonpath='{.data.admin-api-key}' | base64 -d
  // Then set it below:
  var adminApiKey = 'PASTE_API_KEY_HERE'; // Replace with actual key from k8s secret
  
  if (adminApiKey !== 'PASTE_API_KEY_HERE') {
    properties.setProperty('ADMIN_API_KEY', adminApiKey);
    Logger.log('✅ Admin API URL and key set successfully');
    Logger.log('Admin API URL: https://vendon-api.theleetclub.com');
  } else {
    Logger.log('⚠️  Please update adminApiKey variable with the actual API key from k8s secret');
    Logger.log('Get it with: kubectl get secret -n leet-monitor people-analytics-secrets -o jsonpath=\"{.data.admin-api-key}\" | base64 -d');
  }
}

// Test admin API connection
function testAdminApi() {
  var apiUrl = PropertiesService.getScriptProperties().getProperty('ADMIN_API_URL');
  if (!apiUrl) {
    Logger.log('❌ ADMIN_API_URL not set. Run setupAdminProperties() first.');
    return;
  }
  
  try {
    var response = UrlFetchApp.fetch(apiUrl + '/api/admin/health', {
      method: 'get',
      muteHttpExceptions: true
    });
    
    var data = JSON.parse(response.getContentText());
    Logger.log('Admin API Health Check:');
    Logger.log(JSON.stringify(data, null, 2));
    
    if (data.admin_available) {
      Logger.log('✅ Admin features are available!');
    } else {
      Logger.log('⚠️  Admin features not available');
    }
  } catch (e) {
    Logger.log('❌ Error connecting to admin API: ' + e.message);
  }
}
