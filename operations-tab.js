 /**
 * Operations Tab - Slack Lists Integration
 * Fetches and displays pending Slack tasks from Staff Requests List.
 *
 * Token usage (only this tab uses these for Lists):
 * - SLACK_COOKIE_TOKEN (xoxc-...): Used ONLY here for the internal API (lists.records.list).
 *   Must be the token from the browser request body when you open the list (F12 → Network →
 *   lists.records.list or lists.getMyItems → payload → token). Do not put xoxb- here.
 * - SLACK_BOT_TOKEN (xoxb-...): Fallback for official API; often returns list_not_found for Lists.
 */

/**
 * Known column_id mapping for Issues & Actions list — matches Slack list exactly (from screenshot + raw API).
 * Slack columns in order: Request | VM | Status | Manager Ch... | To | Response
 * Response column in Slack shows the "From" text (mahdi, mrashed, malbaba) = Col0ADJ9MNATF, not the number.
 */
var ISSUES_ACTIONS_QA_COLUMN_IDS = {
  request: 'Col0ADFA0669H',      // key "name" → .text (Request)
  vm: 'Col0AE0KHU97T',           // channel → VM (Location)
  status: 'Col0AD68RC80P',       // select → Status (Not Started / Done)
  managerCheck: 'Col0ADN0BGGKD', // select → Manager Check (Not Done / Done)
  to: 'Col0ADRA53QH2',           // user → To (Operator)
  response: 'Col0ADJ9MNATF'      // .text = From (Slack shows this in Response column: mahdi, mrashed, malbaba)
};

/** VM column: channel ID → display name (from Slack list). */
var ISSUES_ACTIONS_VM_LABELS = {
  'C0ADKGD1B8W': 'issues-actions',
  'C08MDCSAFM4': 'leetsub-support'
};

/** Status column: option ID → display name (from Slack list). */
var ISSUES_ACTIONS_STATUS_LABELS = {
  'Opt0ADMCH9YDR': 'Not Started',
  'OptWOEM71HM': 'Done'
};

/** Manager Check column: option ID → display name (from Slack list). */
var ISSUES_ACTIONS_MANAGER_CHECK_LABELS = {
  'Opt1JMNACMF': 'Done',
  'OptIXUGK647': 'Not Done'
};

/** Per-request cache for Slack user lookups (avoids N API calls for N items with same users) */
var _slackUserInfoCache = {};
var _slackTokenForUserInfo = null;

/** Cache for channel ID → name (Location/VM). Populated from SLACK_QA_CHANNEL_NAMES or conversations.info. */
var _slackChannelNameCache = {};

/** Checklist shown when list_not_found or list ID issues occur (even on paid workspaces) */
var LIST_NOT_FOUND_CHECKLIST = [
  'Long-lived fix: set SLACK_USER_TOKEN (xoxp-) with lists:read. Slack app → api.slack.com/apps → your app → OAuth & Permissions → User Token Scopes → add lists:read → Reinstall to Workspace → copy "User OAuth Token" → Script Properties → SLACK_USER_TOKEN.',
  'List ID: set SLACK_STAFF_REQUESTS_LIST_ID (e.g. F08NW0659RP). In Slack, open the list in browser → F12 → Network → find lists.records.list → payload → list_id.',
  'Workspace must be on a paid plan. App must be installed in the same workspace. After adding lists:read, reinstall the app so the new token has the scope.'
];

/**
 * Diagnose which Slack tokens are set and whether Staff Requests can use the internal API.
 *
 * HOW TO RUN: Open Apps Script (script.google.com) → open file "operations-tab.js" in the left panel →
 * at the top choose "diagnoseSlackTokens" from the "Select function" dropdown → click Run →
 * then View → Executions (or View → Logs) to see the result.
 *
 * - xoxb- = Bot token (SLACK_BOT_TOKEN). xoxc- = Cookie token (SLACK_COOKIE_TOKEN, from browser).
 */
function diagnoseSlackTokens() {
  const props = PropertiesService.getScriptProperties();
  const listId = getStaffRequestsListId();
  const host = getSlackWorkspaceHost();
  const report = { listId: listId || '(not set)', host: host, tokens: {}, internalApi: null };
  function prefix(key) {
    const v = props.getProperty(key);
    if (!v || !v.trim()) return null;
    const t = v.trim();
    if (t.length <= 12) return t.substring(0, 4) + '...';
    return t.substring(0, 8) + '...' + t.substring(t.length - 4);
  }
  report.tokens.SLACK_BOT_TOKEN = prefix('SLACK_BOT_TOKEN');
  report.tokens.SLACK_USER_TOKEN = prefix('SLACK_USER_TOKEN');
  report.tokens.SLACK_COOKIE_TOKEN = prefix('SLACK_COOKIE_TOKEN');
  Logger.log('Slack token diagnosis: ' + JSON.stringify(report, null, 2));
  var cookieVal = props.getProperty('SLACK_COOKIE_TOKEN');
  if (cookieVal && cookieVal.trim()) {
    cookieVal = cookieVal.trim();
    if (cookieVal.indexOf('xoxc-') !== 0) {
      Logger.log('SLACK_COOKIE_TOKEN is set but does NOT start with xoxc-. Staff Requests need a cookie token (xoxc-) from the browser, not a bot token (xoxb-). Get xoxc-: open the list in Slack → F12 → Network → find lists.records.list → Request payload → copy the "token" value.');
    } else if (listId) {
      const internalResult = tryListsRecordsList(listId, cookieVal);
      report.internalApi = internalResult && internalResult.error ? { error: internalResult.error } : { itemCount: (internalResult && internalResult.items) ? internalResult.items.length : 0 };
      Logger.log('Internal API (lists.records.list) with SLACK_COOKIE_TOKEN: ' + JSON.stringify(report.internalApi));
    }
  } else {
    Logger.log('SLACK_COOKIE_TOKEN is not set. For Staff Requests, add the xoxc- token from the browser (see above).');
  }
  return report;
}

/**
 * Test the current (or given) list ID against Slack API. Run from Apps Script editor to see raw response.
 * Usage: testSlackListId() uses SLACK_STAFF_REQUESTS_LIST_ID; or testSlackListId('F08NW0659RP') to try a specific ID.
 * @param {string} [listId] - Optional list ID to test; if omitted, uses getStaffRequestsListId().
 * @returns {Object} Raw Slack API response (ok, items, error, etc.) for inspection in logs/Execution log.
 */
function testSlackListId(listId) {
  const id = (listId && listId.trim()) ? listId.trim() : getStaffRequestsListId();
  if (!id) {
    Logger.log('No list ID: set SLACK_STAFF_REQUESTS_LIST_ID or pass testSlackListId("F...")');
    return { error: 'no_list_id' };
  }
  var out = {};
  var cookieToken = null;
  try {
    cookieToken = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_TOKEN');
    if (cookieToken && cookieToken.trim()) cookieToken = cookieToken.trim();
    else cookieToken = null;
  } catch (e) {}
  if (cookieToken && cookieToken.indexOf('xoxc-') === 0) {
    const internalResult = tryListsRecordsList(id, cookieToken);
    out.internalApi = internalResult;
    Logger.log('testSlackListId internal (lists.records.list with SLACK_COOKIE_TOKEN) → ' + JSON.stringify(internalResult, null, 2));
  } else if (cookieToken) {
    Logger.log('SLACK_COOKIE_TOKEN is set but does not start with xoxc- (you have ' + cookieToken.substring(0, 6) + '...). Staff Requests need xoxc- from browser.');
  }
  const tokenObj = getSlackToken();
  if (tokenObj && tokenObj.token) {
    const officialResult = trySlackListsItemsList(id, tokenObj.token);
    out.officialApi = officialResult;
    Logger.log('testSlackListId official (slackLists.items.list with ' + tokenObj.type + ' token) → ' + JSON.stringify(officialResult, null, 2));
  }
  if (!out.internalApi && !out.officialApi) {
    Logger.log('No token used. Set SLACK_COOKIE_TOKEN (xoxc-...) for internal API or SLACK_BOT_TOKEN (xoxb-...) for official API.');
  }
  return out.internalApi || out.officialApi || out;
}

/**
 * Get Staff Requests List ID: Script Property SLACK_STAFF_REQUESTS_LIST_ID overrides config constant.
 * @returns {string} List ID to use
 */
function getStaffRequestsListId() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('SLACK_STAFF_REQUESTS_LIST_ID');
    if (id && id.trim()) return id.trim();
  } catch (e) {}
  return typeof SLACK_STAFF_REQUESTS_LIST_ID !== 'undefined' ? SLACK_STAFF_REQUESTS_LIST_ID : '';
}

/**
 * Get Issues-Actions List ID (QA Findings). Script Property SLACK_ISSUES_ACTIONS_LIST_ID.
 * This is the Slack list named "issues-actions" used for QA Findings table.
 * @returns {string} List ID to use
 */
function getIssuesActionsListId() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('SLACK_ISSUES_ACTIONS_LIST_ID');
    if (id && id.trim()) return id.trim();
  } catch (e) {}
  return '';
}

/**
 * Get Slack workspace host for internal API (e.g. leet-wru5565.slack.com).
 * Script Property SLACK_WORKSPACE_HOST overrides; otherwise defaults to leet-wru5565.slack.com.
 * @returns {string} Host like "leet-wru5565.slack.com"
 */
function getSlackWorkspaceHost() {
  try {
    const host = PropertiesService.getScriptProperties().getProperty('SLACK_WORKSPACE_HOST');
    if (host && host.trim()) return host.trim();
  } catch (e) {}
  return 'leet-wru5565.slack.com';
}

/**
 * Fetch pending Slack tasks from Staff Requests List
 * Filters tasks that have been pending for more than 24 hours
 * @returns {Object} Tasks data with pending tasks (or error/list_not_found with checklist)
 */
function fetchPendingSlackTasks() {
  try {
    const now = new Date();
    const listId = getStaffRequestsListId();
    if (!listId) {
      return {
        tasks: [],
        total: 0,
        error: 'list_id_not_configured',
        message: 'Set Script Property SLACK_STAFF_REQUESTS_LIST_ID or SLACK_STAFF_REQUESTS_LIST_ID in config.',
        checklist: LIST_NOT_FOUND_CHECKLIST
      };
    }

    // Fetch list items from Staff Requests list (same API path as QA tab)
    const fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) {
      return {
        tasks: [],
        total: 0,
        error: fetchResult.error,
        listId: fetchResult.listId || listId,
        message: fetchResult.error === 'list_not_found'
          ? 'Slack does not recognize this list ID. See checklist below.'
          : (fetchResult.message || fetchResult.error),
        checklist: fetchResult.checklist || LIST_NOT_FOUND_CHECKLIST,
        slackError: fetchResult.slackError
      };
    }
    const listItems = (fetchResult && fetchResult.items) ? fetchResult.items : [];

    if (!listItems || listItems.length === 0) {
      Logger.log('No list items returned from fetchSlackListItems');
      return {
        tasks: [],
        total: 0,
        message: "No items found in Staff Requests list. Check logs for API response details.",
        debug: "Check Google Apps Script logs for detailed error information",
        rawData: null
      };
    }
    
    Logger.log(`Processing ${listItems.length} list items`);
    // Log first item field indices and keys/labels so you can set SLACK_LIST_REQUEST_FIELD_INDEX / SLACK_LIST_PRIORITY_FIELD_INDEX if titles or priority are wrong
    if (listItems.length > 0 && listItems[0].fields) {
      var normalized = normalizeFieldsToArray(listItems[0].fields);
      if (normalized.length) {
        var sample = normalized.map(function (f, idx) {
          return idx + ': key=' + (f.key || f.column_id || '') + ' label=' + (f.label || f.title || '') + ' text=' + (fieldDisplayText(f).substring(0, 30));
        });
        Logger.log('First item columns (0-based index → use in Script Properties): ' + sample.join(' | '));
      }
    }

    // Process list items into tasks and filter by pending > 24 hours
    const pendingTasks = [];
    
    // Log the first item structure for debugging
    if (listItems.length > 0) {
      Logger.log('Sample list item structure: ' + JSON.stringify(listItems[0], null, 2));
    }
    
    listItems.forEach((item, index) => {
      // Parse item data - Slack Lists items have different structure
      let itemTime = null;
      let itemText = '';
      let itemUser = 'Unknown';
      let itemUserId = null;
      
      // Try to extract timestamp from item (check many possible field names)
      // Check for various date field names that Slack might use
      const dateFields = [
        'date_submitted', 'submitted_at', 'submitted_date', 'date_submitted_at',
        'created_date', 'date_created', 'created_at', 'created',
        'ts', 'timestamp', 'date', 'time', 'submitted',
        'item_date', 'list_item_date', 'entry_date', 'request_date'
      ];
      
      for (let field of dateFields) {
        if (item[field] !== undefined && item[field] !== null) {
          try {
            // Try parsing as Unix timestamp (seconds)
            if (typeof item[field] === 'number') {
              // If it's a number, check if it's in seconds or milliseconds
              if (item[field] < 10000000000) {
                // Likely in seconds, convert to milliseconds
                itemTime = new Date(item[field] * 1000);
              } else {
                // Likely already in milliseconds
                itemTime = new Date(item[field]);
              }
            } else if (typeof item[field] === 'string') {
              // Try parsing as ISO string or Unix timestamp string
              if (/^\d+$/.test(item[field])) {
                // It's a numeric string, treat as timestamp
                const num = parseFloat(item[field]);
                if (num < 10000000000) {
                  itemTime = new Date(num * 1000);
                } else {
                  itemTime = new Date(num);
                }
              } else {
                // Try parsing as date string
                itemTime = new Date(item[field]);
              }
            }
            
            if (itemTime && !isNaN(itemTime.getTime())) {
              Logger.log(`Found date in field '${field}': ${itemTime.toISOString()} for item ${index}`);
              break; // Found valid date, stop looking
            }
          } catch (e) {
            // Continue to next field
          }
        }
      }
      
      // Extract text/description: prefer field-based so it matches Slack column (Request/title)
      if (item.fields) {
        var fromFields = pickRequestTextFromFields(item.fields);
        if (fromFields) itemText = fromFields;
      }
      if (!itemText && item.title) itemText = item.title;
      else if (!itemText && item.text) itemText = item.text;
      else if (!itemText && item.description) itemText = item.description;
      else if (!itemText && item.item) itemText = typeof item.item === 'string' ? item.item : JSON.stringify(item.item);
      
      // Extract user info
      if (item.user_id) {
        itemUserId = item.user_id;
        const userInfo = getSlackUserInfo(item.user_id);
        itemUser = userInfo.displayName || userInfo.name || 'Unknown';
      } else if (item.user) {
        itemUserId = item.user;
        const userInfo = getSlackUserInfo(item.user);
        itemUser = userInfo.displayName || userInfo.name || 'Unknown';
      }
      
      // Calculate hours pending
      if (itemTime && !isNaN(itemTime.getTime())) {
        const hoursPending = (now - itemTime) / (1000 * 60 * 60);
        
        Logger.log(`Item ${index}: hoursPending=${hoursPending.toFixed(2)}, date=${itemTime.toISOString()}, text=${itemText.substring(0, 50)}`);
        
        // Only include tasks pending for more than 24 hours
        if (hoursPending > 24) {
          // Check if item is not completed/done (check multiple field names + list fields)
          var isCompletedByFields = item.fields ? pickIsCompletedFromFields(item.fields) : false;
          const isCompleted = isCompletedByFields || item.completed || item.done || item.status === 'completed' || 
                             item.status === 'done' || item.checked || item.closed ||
                             item.resolved || item.finished || item.archived;
          
          if (!isCompleted) {
            var listPriority = item.fields ? pickPriorityFromFields(item.fields) : '';
            var dueDateText = item.fields ? pickDueDateFromFields(item.fields) : '';
            var detailsText = item.fields ? pickDetailsFromFields(item.fields) : '';
            var itemIdText = item.fields ? pickItemIdFromFields(item.fields) : (item.item_id || '');

            // Submitted by: created_by user
            var submittedById = item.created_by || null;
            var submittedByName = '';
            if (submittedById) {
              var submitUser = getSlackUserInfo(submittedById);
              submittedByName = submitUser.displayName || submitUser.name || '';
            }

            const task = {
              id: item.id || item.item_id || item.list_item_id || `item_${Math.random().toString(36).substr(2, 9)}`,
              text: itemText,                // Request
              user: itemUserId || 'Unknown', // Assignee ID
              userName: itemUser,            // Assignee name
              timestamp: itemTime.getTime() / 1000,
              hoursPending: Math.floor(hoursPending),
              daysPending: Math.floor(hoursPending / 24),
              listId: listId,
              priority: listPriority || determinePriority(hoursPending),
              // Extra fields to mirror Slack columns
              submittedById: submittedById || '',
              submittedByName: submittedByName || '',
              dueDate: dueDateText || '',
              dateSubmitted: itemTime.toISOString(),
              status: 'Open',
              details: detailsText || '',
              itemId: itemIdText || '',
              permalink: `https://leet-wru5565.slack.com/lists/${SLACK_WORKSPACE_ID}/${listId}`
            };
            
            pendingTasks.push(task);
            Logger.log(`Added pending task: ${itemText.substring(0, 50)} (${hoursPending.toFixed(1)} hours)`);
          } else {
            Logger.log(`Item ${index} is completed, skipping`);
          }
        } else {
          Logger.log(`Item ${index} is less than 24 hours old (${hoursPending.toFixed(2)} hours), skipping`);
        }
      } else {
        // Log items without valid dates for debugging
        Logger.log(`Item ${index} has no valid date field. Item keys: ${Object.keys(item).join(', ')}`);
        Logger.log(`Item ${index} full data: ${JSON.stringify(item).substring(0, 200)}`);
      }
    });

    // Sort by hours pending (oldest first)
    pendingTasks.sort((a, b) => b.hoursPending - a.hoursPending);

    return {
      tasks: pendingTasks,
      total: pendingTasks.length,
      fetchedAt: now.toISOString()
    };

  } catch (error) {
    Logger.log('Error fetching pending Slack tasks: ' + error.toString());
    return {
      error: error.toString(),
      tasks: [],
      total: 0
    };
  }
}

/**
 * Fetch ALL Slack tasks from Staff Requests List (no >24h filter).
 * Returns same shape as fetchPendingSlackTasks but includes all non-completed items.
 */
function fetchAllSlackTasks() {
  try {
    const now = new Date();
    const listId = getStaffRequestsListId();
    if (!listId) {
      return {
        tasks: [],
        total: 0,
        error: 'list_id_not_configured',
        message: 'Set Script Property SLACK_STAFF_REQUESTS_LIST_ID or SLACK_STAFF_REQUESTS_LIST_ID in config.',
        checklist: LIST_NOT_FOUND_CHECKLIST
      };
    }

    const fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) {
      return {
        tasks: [],
        total: 0,
        error: fetchResult.error,
        listId: fetchResult.listId || listId,
        message: fetchResult.error === 'list_not_found'
          ? 'Slack does not recognize this list ID. See checklist below.'
          : (fetchResult.message || fetchResult.error),
        checklist: fetchResult.checklist || LIST_NOT_FOUND_CHECKLIST,
        slackError: fetchResult.slackError
      };
    }
    const listItems = (fetchResult && fetchResult.items) ? fetchResult.items : [];

    if (!listItems || listItems.length === 0) {
      Logger.log('No list items returned from fetchSlackListItems (fetchAllSlackTasks)');
      return {
        tasks: [],
        total: 0,
        message: "No items found in Staff Requests list. Check logs for API response details.",
        debug: "Check Google Apps Script logs for detailed error information",
        rawData: null
      };
    }

    Logger.log(`Processing ${listItems.length} list items (fetchAllSlackTasks)`);
    if (listItems.length > 0 && listItems[0].fields) {
      var normalized = normalizeFieldsToArray(listItems[0].fields);
      if (normalized.length) {
        var sample = normalized.map(function (f, idx) {
          return idx + ': key=' + (f.key || f.column_id || '') + ' label=' + (f.label || f.title || '') + ' text=' + (fieldDisplayText(f).substring(0, 30));
        });
        Logger.log('First item columns (0-based index): ' + sample.join(' | '));
      }
    }

    const allTasks = [];

    listItems.forEach((item, index) => {
      let itemTime = null;
      let itemText = '';
      let itemUser = 'Unknown';
      let itemUserId = null;

      const dateFields = [
        'date_submitted', 'submitted_at', 'submitted_date', 'date_submitted_at',
        'created_date', 'date_created', 'created_at', 'created',
        'ts', 'timestamp', 'date', 'time', 'submitted',
        'item_date', 'list_item_date', 'entry_date', 'request_date'
      ];

      for (let field of dateFields) {
        if (item[field] !== undefined && item[field] !== null) {
          try {
            if (typeof item[field] === 'number') {
              if (item[field] < 10000000000) {
                itemTime = new Date(item[field] * 1000);
              } else {
                itemTime = new Date(item[field]);
              }
            } else if (typeof item[field] === 'string') {
              if (/^\d+$/.test(item[field])) {
                const num = parseFloat(item[field]);
                if (num < 10000000000) {
                  itemTime = new Date(num * 1000);
                } else {
                  itemTime = new Date(num);
                }
              } else {
                itemTime = new Date(item[field]);
              }
            }
            if (itemTime && !isNaN(itemTime.getTime())) {
              break;
            }
          } catch (e) {}
        }
      }

      // Prefer field-based text so it matches Slack column (Request/title)
      if (item.fields) {
        var fromFields = pickRequestTextFromFields(item.fields);
        if (fromFields) itemText = fromFields;
      }
      if (!itemText && item.title) itemText = item.title;
      else if (!itemText && item.text) itemText = item.text;
      else if (!itemText && item.description) itemText = item.description;
      else if (!itemText && item.item) itemText = typeof item.item === 'string' ? item.item : JSON.stringify(item.item);

      if (item.user_id) {
        itemUserId = item.user_id;
        const userInfo = getSlackUserInfo(item.user_id);
        itemUser = userInfo.displayName || userInfo.name || 'Unknown';
      } else if (item.user) {
        itemUserId = item.user;
        const userInfo = getSlackUserInfo(item.user);
        itemUser = userInfo.displayName || userInfo.name || 'Unknown';
      }

      let hoursPending = null;
      if (itemTime && !isNaN(itemTime.getTime())) {
        hoursPending = (now - itemTime) / (1000 * 60 * 60);
      }

      var isCompletedByFields = item.fields ? pickIsCompletedFromFields(item.fields) : false;
      const isCompleted = isCompletedByFields || item.completed || item.done || item.status === 'completed' ||
                          item.status === 'done' || item.checked || item.closed ||
                          item.resolved || item.finished || item.archived;

      if (!isCompleted) {
        // Use Slack list Priority column (High, Medium) when present; only fall back to computed priority if missing
        var listPriority = item.fields ? pickPriorityFromFields(item.fields) : '';
        var fallbackPriority = hoursPending != null ? determinePriority(hoursPending) : 'normal';

        var dueDateText = item.fields ? pickDueDateFromFields(item.fields) : '';
        var detailsText = item.fields ? pickDetailsFromFields(item.fields) : '';
        var itemIdText = item.fields ? pickItemIdFromFields(item.fields) : (item.item_id || '');

        var submittedById = item.created_by || null;
        var submittedByName = '';
        if (submittedById) {
          var submitUser = getSlackUserInfo(submittedById);
          submittedByName = submitUser.displayName || submitUser.name || '';
        }

        const task = {
          id: item.id || item.item_id || item.list_item_id || `item_${Math.random().toString(36).substr(2, 9)}`,
          text: itemText,                // Request
          user: itemUserId || 'Unknown', // Assignee ID
          userName: itemUser,            // Assignee name
          timestamp: itemTime && !isNaN(itemTime.getTime()) ? itemTime.getTime() / 1000 : null,
          hoursPending: hoursPending != null ? Math.floor(hoursPending) : null,
          daysPending: hoursPending != null ? Math.floor(hoursPending / 24) : null,
          listId: listId,
          priority: listPriority || fallbackPriority,
          submittedById: submittedById || '',
          submittedByName: submittedByName || '',
          dueDate: dueDateText || '',
          dateSubmitted: itemTime && !isNaN(itemTime.getTime()) ? itemTime.toISOString() : '',
          status: 'Open',
          details: detailsText || '',
          itemId: itemIdText || '',
          permalink: `https://leet-wru5565.slack.com/lists/${SLACK_WORKSPACE_ID}/${listId}`
        };
        allTasks.push(task);
      }
    });

    // Sort by hours pending (oldest first if we have hours)
    allTasks.sort((a, b) => {
      if (a.hoursPending == null && b.hoursPending == null) return 0;
      if (a.hoursPending == null) return 1;
      if (b.hoursPending == null) return -1;
      return b.hoursPending - a.hoursPending;
    });

    return {
      tasks: allTasks,
      total: allTasks.length,
      fetchedAt: now.toISOString()
    };

  } catch (error) {
    Logger.log('Error fetching ALL Slack tasks: ' + error.toString());
    return {
      error: error.toString(),
      tasks: [],
      total: 0
    };
  }
}

/**
 * Fetch items from a Slack List. Same API path for Operations and QA tabs.
 * Note: Slack Lists may require special API access or scopes
 * @param {string} listId - List ID (e.g., F08NW0659RP)
 * @returns {{ items: Array, rawData?: Object }|{ error: string, listId?: string, checklist?: Array, message?: string }} On success: { items, rawData? } (rawData when internal API used). On error: { error, ... }.
 */
function fetchSlackListItems(listId) {
  try {
    // Cookie token (xoxc-): try internal API first – works for Staff Requests without OAuth scopes.
    const cookieToken = (function () {
      try {
        const t = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_TOKEN');
        return (t && t.trim()) ? t.trim() : null;
      } catch (e) { return null; }
    })();
    if (cookieToken && cookieToken.indexOf('xoxc-') === 0) {
      const internalResult = tryListsRecordsList(listId, cookieToken);
      if (internalResult && internalResult.error) {
        Logger.log('lists.records.list error: ' + internalResult.error);
      } else if (internalResult && Array.isArray(internalResult.items)) {
        Logger.log('Internal API (lists.records.list) returned ' + internalResult.items.length + ' items');
        return { items: internalResult.items, rawData: internalResult.rawData || null };
      }
    }

    const tokenObj = getSlackToken();
    const token = tokenObj ? tokenObj.token : null;
    const tokenType = tokenObj ? tokenObj.type : null;

    if (!token && !cookieToken) {
      Logger.log('No Slack token. Set SLACK_COOKIE_TOKEN (xoxc-...) for Staff Requests, or SLACK_BOT_TOKEN / SLACK_USER_TOKEN.');
      return { items: [] };
    }

    // Method 0: Official Slack API slackLists.items.list (paid workspace; Bearer token only).
    if (token && (tokenType === 'bot' || tokenType === 'user')) {
      const officialResult = trySlackListsItemsList(listId, token);
      
      // List ID not recognized by official API – try internal API with cookie token if set
      if (officialResult && officialResult.error === 'list_not_found') {
        var otherToken = getOtherSlackOAuthToken(tokenType);
        if (otherToken) {
          Logger.log('list_not_found with ' + tokenType + ' token, trying ' + otherToken.type + ' token');
          var retryOfficial = trySlackListsItemsList(listId, otherToken.token);
          if (retryOfficial && Array.isArray(retryOfficial.items)) {
            Logger.log('Official API returned ' + retryOfficial.items.length + ' items with ' + otherToken.type + ' token');
            return { items: retryOfficial.items };
          }
        }
        if (cookieToken && cookieToken.indexOf('xoxc-') === 0) {
          const retryInternal = tryListsRecordsList(listId, cookieToken);
          if (retryInternal && Array.isArray(retryInternal.items)) {
            Logger.log('Fallback: internal API returned ' + retryInternal.items.length + ' items (cookie token is short-lived)');
            return { items: retryInternal.items, rawData: retryInternal.rawData || null };
          }
        }
        var checklist = LIST_NOT_FOUND_CHECKLIST.slice();
        var msg = 'Use a long-lived User OAuth token: set SLACK_USER_TOKEN (xoxp-) with lists:read. Slack app → OAuth & Permissions → User Token Scopes → add lists:read → Reinstall to Workspace → copy User OAuth Token. ';
        return {
          error: 'list_not_found',
          listId: listId,
          checklist: checklist,
          slackError: officialResult.slackError,
          message: msg + 'See checklist below.'
        };
      }
      
      // Successful response with items
      if (officialResult && officialResult.items && officialResult.items.length > 0) {
        Logger.log('Found ' + officialResult.items.length + ' items via slackLists.items.list');
        return { items: officialResult.items };
      }
      
      // Explicit error from Slack (e.g. missing_scope, plan_required, not_allowed_token_type, etc.)
      if (officialResult && officialResult.error) {
        const err = officialResult.slackError || officialResult.error;
        Logger.log('Slack Lists API error (no fallback): ' + err);
        return {
          error: err,
          listId: listId,
          message: 'Slack Lists API error: ' + err,
          checklist: LIST_NOT_FOUND_CHECKLIST,
          slackError: err
        };
      }
      
      // No error and no items → treat as an empty list
      Logger.log('Slack Lists API returned ok with 0 items for listId ' + listId);
      return { items: [] };
    }
    
    // Method 1 (cookie only): Internal API lists.records.list (matches browser request with xoxc- token)
    if (tokenType === 'cookie') {
      const internalResult = tryListsRecordsList(listId, token);
      if (internalResult && internalResult.items && internalResult.items.length > 0) {
        Logger.log('Found ' + internalResult.items.length + ' items via lists.records.list (internal API)');
        return { items: internalResult.items, rawData: internalResult.rawData || null };
      }
      if (internalResult && internalResult.error) {
        Logger.log('lists.records.list error (trying other methods): ' + internalResult.error);
      }
      const webClientResult = tryWebClientAPI(listId, token);
      if (webClientResult && webClientResult.length > 0) {
        Logger.log(`Found ${webClientResult.length} items via Web Client API`);
        return { items: webClientResult };
      }
    }
    
    // Method 2: Try fetching the actual list page HTML and parsing it
    // Since Lists don't have a public API, we need to scrape the web page
    // Try with any token type, but cookie tokens work best
    const htmlResult = tryFetchListPageHTML(listId, token, tokenType);
    if (htmlResult && htmlResult.length > 0) {
      Logger.log(`Found ${htmlResult.length} items via HTML parsing`);
      return { items: htmlResult };
    }
    
    // Method 2: Try accessing the list via web API with cookie token
    if (tokenType === 'cookie') {
      const cookieResult = tryCookieTokenAccess(listId, token);
      if (cookieResult && cookieResult.length > 0) {
        Logger.log(`Found ${cookieResult.length} items via cookie token access`);
        return { items: cookieResult };
      }
    }
    
    // Method 3: Try accessing list through conversations API (if list is accessible as a channel/conversation)
    const conversationsResult = tryConversationsAPI(listId, token);
    if (conversationsResult && conversationsResult.length > 0) {
      Logger.log(`Found ${conversationsResult.length} items via conversations API`);
      return { items: conversationsResult };
    }
    
    // Method 4: Try accessing through files.list (if list items are stored as files)
    const filesResult = tryFilesAPI(listId, token);
    if (filesResult && filesResult.length > 0) {
      Logger.log(`Found ${filesResult.length} items via files API`);
      return { items: filesResult };
    }
    
    // Method 5: Try accessing the list page directly with authentication
    const webResult = tryWebListAccess(listId, token, tokenType);
    if (webResult && webResult.length > 0) {
      Logger.log(`Found ${webResult.length} items via web access`);
      return { items: webResult };
    }
    
    // Method 6: Try using the list ID directly with different endpoints
    const directResult = tryDirectListAccess(listId, token);
    if (directResult && directResult.length > 0) {
      Logger.log(`Found ${directResult.length} items via direct access`);
      return { items: directResult };
    }
    
    Logger.log('All API methods failed. Slack Lists may require special access or a different approach.');
    return { items: [] };

  } catch (error) {
    Logger.log('Error fetching Slack list items: ' + error.toString());
    return { items: [] };
  }
}


/**
 * Slack user ID pattern (e.g. U0789LQQC9Z) – used to avoid showing user IDs as request text.
 */
function looksLikeSlackUserId(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  return /^U[A-Z0-9]{8,12}$/i.test(s.trim());
}

/**
 * Get displayable text from a Slack list field (handles text, value, rich_text, select).
 */
function fieldDisplayText(f) {
  if (!f) return '';
  if (f.text != null && f.text !== '') return String(f.text).trim();
  if (f.value != null && f.value !== '') return String(f.value).trim();
  if (f.select && Array.isArray(f.select) && f.select.length) return String(f.select[0]).trim();
  if (f.number != null) {
    var n = Array.isArray(f.number) ? f.number[0] : f.number;
    if (n != null && n !== '') return String(n);
  }
  if (f.date && Array.isArray(f.date) && f.date.length) return String(f.date[0]).trim();
  if (f.rich_text && Array.isArray(f.rich_text) && f.rich_text.length) {
    var out = [];
    for (var r = 0; r < f.rich_text.length; r++) {
      var block = f.rich_text[r];
      if (block && block.text) out.push(block.text);
    }
    if (out.length) return out.join('').trim();
  }
  return '';
}

/**
 * Normalize fields to an array so we can use index-based mapping.
 * Slack may return fields as array (official API) or as object keyed by column_id (internal API).
 */
function normalizeFieldsToArray(fields) {
  if (!fields) return [];
  if (Array.isArray(fields)) return fields;
  if (typeof fields === 'object') {
    var keys = Object.keys(fields);
    return keys.sort().map(function (k) {
      var cell = fields[k];
      if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
        return Object.assign({ key: k, column_id: k }, cell);
      }
      return { key: k, column_id: k, text: cell != null ? String(cell) : '', value: cell };
    });
  }
  return [];
}

/**
 * From Slack list item fields, pick the best text for "Request" (title/description).
 * 1) If SLACK_LIST_REQUEST_FIELD_INDEX is set (0-based), use that column (if not a user ID).
 * 2) Prefer a field whose key suggests Request/Title (e.g. "Request", "Title").
 * 3) Else use the first field (by column order) that has non–user-ID text.
 * 4) Else use the longest non–user-ID text.
 */
function pickRequestTextFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return '';
  var requestKeys = ['request', 'title', 'description', 'text', 'name', 'item', 'summary'];
  var bestByKey = '';
  var firstContent = '';
  var bestLongest = '';
  var bestLongestLen = 0;
  var preferredIndex = getRequestFieldIndex();
  var byIndex = '';
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var text = fieldDisplayText(f);
    if (!text || looksLikeSlackUserId(text)) continue;
    if (preferredIndex >= 0 && i === preferredIndex) byIndex = text;
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    for (var k = 0; k < requestKeys.length; k++) {
      if (key.indexOf(requestKeys[k]) !== -1 || label.indexOf(requestKeys[k]) !== -1) {
        if (text.length > bestByKey.length) bestByKey = text;
        break;
      }
    }
    if (firstContent === '' && text.length > 1) firstContent = text;
    if (text.length > bestLongestLen) {
      bestLongestLen = text.length;
      bestLongest = text;
    }
  }
  return (byIndex || bestByKey || firstContent || bestLongest || '').trim().substring(0, 2000);
}

/**
 * From Slack list item fields, pick Assignee (user ID) if present; otherwise null.
 * - Matches common column keys, plus "people" which Slack uses for assignee in some lists.
 */
function pickAssigneeFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return null;
  var assigneeKeys = ['assignee', 'assigned', 'user', 'owner', 'people'];
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    for (var k = 0; k < assigneeKeys.length; k++) {
      if (key.indexOf(assigneeKeys[k]) !== -1) {
        var val = f.user ? (Array.isArray(f.user) ? f.user[0] : f.user) : (f.text || f.value);
        if (val && looksLikeSlackUserId(String(val))) return String(val).trim();
        break;
      }
    }
  }
  return null;
}

/**
 * From Slack list item fields, pick Priority (e.g. High, Medium) from the list column.
 * 1) If SLACK_LIST_PRIORITY_FIELD_INDEX is set (0-based), use that column's display text.
 * 2) Else find a field whose key or label/title contains "priority".
 * 3) Else fall back to the first select-type field (many lists model Priority as a select).
 * Returns empty string if not found so caller can fall back to computed priority.
 */
function pickPriorityFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return '';
  var priorityIndex = getPriorityFieldIndex();
  if (priorityIndex >= 0 && priorityIndex < arr.length) {
    var text = fieldDisplayText(arr[priorityIndex]);
    if (text) return mapPriorityOptionIdToLabel(text.trim());
    var f = arr[priorityIndex];
    if (f && f.select && Array.isArray(f.select) && f.select[0]) return mapPriorityOptionIdToLabel(String(f.select[0]).trim());
  }
  var key = 'priority';
  var firstSelect = null;
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    // Remember first select field as a generic Priority fallback
    if (!firstSelect && f && f.select && Array.isArray(f.select) && f.select.length) {
      firstSelect = f;
    }
    var k = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    if (k.indexOf(key) !== -1 || label.indexOf(key) !== -1) {
      var text = fieldDisplayText(f);
      if (text) return mapPriorityOptionIdToLabel(text.trim());
      if (f.select && Array.isArray(f.select) && f.select[0]) return mapPriorityOptionIdToLabel(String(f.select[0]).trim());
      return '';
    }
  }
  if (firstSelect) {
    var text = fieldDisplayText(firstSelect);
    if (text) return mapPriorityOptionIdToLabel(text.trim());
    if (firstSelect.select && Array.isArray(firstSelect.select) && firstSelect.select[0]) {
      return mapPriorityOptionIdToLabel(String(firstSelect.select[0]).trim());
    }
  }
  return '';
}

/**
 * Map Slack List select option IDs (e.g. OptJWBRH800) to human labels (High, Medium, Low)
 * using Script Property SLACK_PRIORITY_OPTION_LABELS.
 *
 * Example property value:
 *   {"OptJWBRH800":"High","OptABCD1234":"Medium","OptXYZ7890":"Low"}
 */
var _priorityOptionMap = null;
function mapPriorityOptionIdToLabel(text) {
  if (!text) return '';
  // If it doesn't look like an encoded option ID, just return as-is
  if (!/^Opt[A-Za-z0-9]+$/.test(text)) return text;
  // Built‑in mapping for known IDs in this workspace (priority + Issues & Actions Manager Check)
  var builtIn = {
    'OptJWBRH800': 'High',
    'Opt3JLB8ADN': 'Medium',
    'Opt1JMNACMF': 'Done',
    'OptIXUGK647': 'Not Done'
  };
  if (builtIn[text]) return builtIn[text];
  if (typeof ISSUES_ACTIONS_MANAGER_CHECK_LABELS !== 'undefined' && ISSUES_ACTIONS_MANAGER_CHECK_LABELS[text]) return ISSUES_ACTIONS_MANAGER_CHECK_LABELS[text];
  try {
    if (_priorityOptionMap === null) {
      var raw = PropertiesService.getScriptProperties().getProperty('SLACK_PRIORITY_OPTION_LABELS');
      if (raw) {
        try {
          _priorityOptionMap = JSON.parse(raw);
        } catch (e) {
          _priorityOptionMap = {};
        }
      } else {
        _priorityOptionMap = {};
      }
    }
    if (_priorityOptionMap && _priorityOptionMap[text]) {
      return String(_priorityOptionMap[text]);
    }
  } catch (e) {
    // ignore and fall through
  }
  // Fallback: return original ID so at least something is shown
  return text;
}

/** Script Property key for persisted QA (issues-actions) option ID → label map. */
var SLACK_QA_OPTION_LABELS_PROP = 'SLACK_ISSUES_ACTIONS_OPTION_LABELS';

/** Built-in: Resolved/Status option IDs and labels. Add any extra Status option IDs Slack returns so they show as labels not raw IDs. Override with SLACK_QA_RESOLVED_STATUS_LABELS if needed. */
var QA_RESOLVED_STATUS_LABELS_BUILTIN = {
  'OptEY59BDXL': 'Done',
  'OptFMECRN92': 'not started',
  'Opt0AEN4FBZ88': 'Done',
  'Opt0ADMCH9YDR': 'Not Started',
  'OptWOEM71HM': 'Done'
};

/** Known Status column option IDs - used to identify which field is really Status (not Manager Check / Response). */
var QA_STATUS_OPTION_IDS = { 'OptEY59BDXL': true, 'OptFMECRN92': true, 'Opt0AEN4FBZ88': true, 'Opt0ADMCH9YDR': true, 'OptWOEM71HM': true };

/** Find Status field value by label when column_id lookup failed (e.g. different field shape). */
function findStatusFieldValueByLabel(norm) {
  if (!norm || !norm.length) return '';
  var statusKeys = ['status', 'resolved', 'state', 'resolution'];
  var avoid = ['manager', 'check', 'response', 'comment', 'verified'];
  for (var i = 0; i < norm.length; i++) {
    var f = norm[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    var isAvoid = avoid.some(function(a) { return key.indexOf(a) !== -1 || label.indexOf(a) !== -1; });
    if (isAvoid) continue;
    var match = statusKeys.some(function(k) { return key.indexOf(k) !== -1 || label.indexOf(k) !== -1; });
    if (match) return (fieldDisplayText(f) || '').trim();
  }
  return '';
}

/** Get field value by matching label (and optional avoid). Used when column_id lookup is empty for this item. */
function valueByLabel(norm, matchLabels, avoidLabels) {
  if (!norm || !norm.length) return '';
  for (var i = 0; i < norm.length; i++) {
    var f = norm[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    if (avoidLabels && avoidLabels.some(function(a) { return label.indexOf(a) !== -1 || key.indexOf(a) !== -1; })) continue;
    if (matchLabels.some(function(m) { return label === m || label.indexOf(m) !== -1 || key === m || key.indexOf(m) !== -1; })) {
      var text = (fieldDisplayText(f) || '').trim();
      if (text) return text;
    }
  }
  return '';
}

/** Like valueByLabel but prefers a value that is not a date (YYYY-MM-DD); use for Response to avoid "Needed by" date. */
function valueByLabelPreferNonDate(norm, matchLabels, avoidLabels) {
  if (!norm || !norm.length) return '';
  var dateVal = '';
  for (var i = 0; i < norm.length; i++) {
    var f = norm[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    if (avoidLabels && avoidLabels.some(function(a) { return label.indexOf(a) !== -1 || key.indexOf(a) !== -1; })) continue;
    if (matchLabels.some(function(m) { return label === m || label.indexOf(m) !== -1 || key === m || key.indexOf(m) !== -1; })) {
      var text = (fieldDisplayText(f) || '').trim();
      if (text) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
        if (!dateVal) dateVal = text;
      }
    }
  }
  return dateVal;
}

/** Get value by label; for user fields return the user ID so caller can resolve to display name. */
function valueByLabelOrUser(norm, matchLabels, avoidLabels) {
  if (!norm || !norm.length) return '';
  for (var i = 0; i < norm.length; i++) {
    var f = norm[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    if (avoidLabels && avoidLabels.some(function(a) { return label.indexOf(a) !== -1 || key.indexOf(a) !== -1; })) continue;
    if (matchLabels.some(function(m) { return label === m || label.indexOf(m) !== -1 || key === m || key.indexOf(m) !== -1; })) {
      if (f.user != null) {
        var u = f.user;
        var uid = (Array.isArray(u) && u.length ? u[0] : u);
        if (uid) return String(uid);
      }
      var text = (fieldDisplayText(f) || '').trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Pick the Status/Resolved field value. Only use a field whose value is a known status Opt ID so we never show Manager Check/Response in the Resolved column.
 * If several columns have those IDs, prefer the one whose label/key is "Status" or "Resolved".
 */
function pickStatusFromFields(fields, norm) {
  if (!norm || !norm.length) return '';
  var statusLabelKeys = ['status', 'resolved', 'state', 'resolution'];
  var avoidKeys = ['manager', 'check', 'response', 'comment', 'verified'];
  var withStatusId = [];
  var byLabelOnly = '';
  for (var i = 0; i < norm.length; i++) {
    var f = norm[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    var text = (fieldDisplayText(f) || '').trim();
    var isStatusId = QA_STATUS_OPTION_IDS[text];
    var labelMatches = statusLabelKeys.some(function(k) { return key.indexOf(k) !== -1 || label.indexOf(k) !== -1; });
    var isAvoid = avoidKeys.some(function(k) { return key.indexOf(k) !== -1 || label.indexOf(k) !== -1; });
    if (isStatusId && labelMatches && !isAvoid) return text;
    if (isStatusId) withStatusId.push(text);
    if (labelMatches && !isAvoid && !byLabelOnly) byLabelOnly = text;
  }
  if (withStatusId.length === 1) return withStatusId[0];
  if (withStatusId.length > 1 && byLabelOnly && QA_STATUS_OPTION_IDS[byLabelOnly]) return byLabelOnly;
  if (withStatusId.length > 0) return withStatusId[0];
  return byLabelOnly;
}

/** Optional map Opt ID -> channel/location name (Script Property SLACK_QA_LOCATION_LABELS). Use so Location shows "issues..." instead of Opt0ADMCH9YDR. */
var _locationLabelsCache = null;
function getLocationLabels() {
  if (_locationLabelsCache !== null) return _locationLabelsCache;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('SLACK_QA_LOCATION_LABELS');
    if (raw && raw.trim()) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        _locationLabelsCache = parsed;
        return _locationLabelsCache;
      }
    }
  } catch (e) { /* ignore */ }
  _locationLabelsCache = {};
  return _locationLabelsCache;
}

var _resolvedStatusLabelsCache = null;
function getResolvedStatusLabels() {
  if (_resolvedStatusLabelsCache !== null) return _resolvedStatusLabelsCache;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('SLACK_QA_RESOLVED_STATUS_LABELS');
    if (raw && raw.trim()) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        _resolvedStatusLabelsCache = parsed;
        return _resolvedStatusLabelsCache;
      }
    }
  } catch (e) { /* ignore */ }
  _resolvedStatusLabelsCache = QA_RESOLVED_STATUS_LABELS_BUILTIN;
  return _resolvedStatusLabelsCache;
}

/**
 * Resolve the Resolved/Status field Opt ID to label. Order: Script Property SLACK_QA_RESOLVED_STATUS_LABELS > saved QA labels > built-in > raw ID.
 * Set Script Property to match Slack exactly, e.g. {"OptEY59BDXL":"Done","OptFMECRN92":"not started"}
 */
function resolveResolvedStatusToLabel(optId, savedMap) {
  if (!optId) return '';
  var s = String(optId).trim();
  if (typeof ISSUES_ACTIONS_STATUS_LABELS !== 'undefined' && ISSUES_ACTIONS_STATUS_LABELS[s]) return ISSUES_ACTIONS_STATUS_LABELS[s];
  var statusMap = getResolvedStatusLabels();
  if (statusMap[s]) return String(statusMap[s]);
  if (savedMap && savedMap[s]) return String(savedMap[s]);
  return s;
}

/**
 * Load saved option ID → label map (persisted when cookie token worked).
 * @returns {Object} Map of "Opt..." → "Label" or {}
 */
function getSavedQaOptionLabels() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(SLACK_QA_OPTION_LABELS_PROP);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) { /* ignore */ }
  return {};
}

/**
 * Save option ID → label map (merge with existing so we keep labels when token expires).
 * @param {Object} newMap - Map of "Opt..." → "Label" to merge in
 */
function setSavedQaOptionLabels(newMap) {
  if (!newMap || typeof newMap !== 'object') return;
  var merged = getSavedQaOptionLabels();
  var keys = Object.keys(newMap);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k && newMap[k]) merged[k] = String(newMap[k]);
  }
  try {
    PropertiesService.getScriptProperties().setProperty(SLACK_QA_OPTION_LABELS_PROP, JSON.stringify(merged));
  } catch (e) {
    Logger.log('setSavedQaOptionLabels error: ' + e.toString());
  }
}

/**
 * Resolve Opt... to display label: saved map (from when token worked) > priority map > raw ID.
 * @param {string} optId - e.g. Opt0ADMCH9YDR
 * @param {Object} savedMap - From getSavedQaOptionLabels()
 * @returns {string} Label or optId
 */
function resolveQaOptionToLabel(optId, savedMap) {
  if (!optId || !/^Opt[A-Za-z0-9]+$/.test(String(optId))) return (optId || '');
  var s = String(optId).trim();
  if (typeof ISSUES_ACTIONS_MANAGER_CHECK_LABELS !== 'undefined' && ISSUES_ACTIONS_MANAGER_CHECK_LABELS[s]) return ISSUES_ACTIONS_MANAGER_CHECK_LABELS[s];
  if (savedMap && savedMap[s]) return String(savedMap[s]);
  return mapPriorityOptionIdToLabel(s) || s;
}

/**
 * From Slack list item fields, pick Due Date text (e.g. 12/27/2025 or 2025-12-27).
 */
function pickDueDateFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return '';
  var dueKeys = ['due', 'due_date', 'deadline'];
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var k = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    for (var j = 0; j < dueKeys.length; j++) {
      if (k.indexOf(dueKeys[j]) !== -1 || label.indexOf(dueKeys[j]) !== -1) {
        var text = fieldDisplayText(f);
        if (text) return text;
      }
    }
  }
  return '';
}

/**
 * From Slack list item fields, pick Details/Notes if present.
 */
function pickDetailsFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return '';
  var detailKeys = ['details', 'notes', 'note'];
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var k = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    for (var j = 0; j < detailKeys.length; j++) {
      if (k.indexOf(detailKeys[j]) !== -1 || label.indexOf(detailKeys[j]) !== -1) {
        var text = fieldDisplayText(f);
        if (text) return text;
      }
    }
  }
  return '';
}

/**
 * From Slack list item fields, pick a simple numeric Item ID (if the list has such a column).
 */
function pickItemIdFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return '';
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var text = fieldDisplayText(f);
    if (!text) continue;
    // prefer fields whose key/label mentions id
    var k = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    var isIdLike = (k.indexOf('id') !== -1 || label.indexOf('id') !== -1);
    if (/^\d+$/.test(text)) {
      if (isIdLike) return text;
    }
  }
  // fallback: first purely numeric field
  for (var j = 0; j < arr.length; j++) {
    var f2 = arr[j];
    var t2 = fieldDisplayText(f2);
    if (t2 && /^\d+$/.test(t2)) return t2;
  }
  return '';
}

/**
 * From Slack list item fields, determine if the item is completed.
 * Handles common patterns like todo_completed, completed, done, status, and checkboxes/selects.
 */
function pickIsCompletedFromFields(fields) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length) return false;
  var completeKeys = ['todo_completed', 'completed', 'done', 'status', 'checked'];
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var k = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    var matchesKey = false;
    for (var j = 0; j < completeKeys.length; j++) {
      if (k.indexOf(completeKeys[j]) !== -1 || label.indexOf(completeKeys[j]) !== -1) {
        matchesKey = true;
        break;
      }
    }
    if (!matchesKey) continue;

    // Boolean/checkbox pattern from Slack internal lists (e.g. todo_completed)
    if (typeof f.value === 'boolean') return f.value;
    if (typeof f.checkbox === 'boolean') return f.checkbox;

    var text = fieldDisplayText(f).toLowerCase();
    if (!text) continue;
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
    if (text === 'completed' || text === 'done' || text === 'closed' || text === 'resolved') return true;
    if (text === 'open' || text === 'pending' || text === 'in progress') return false;
  }
  return false;
}

/**
 * Pick first field whose key or label contains any of the given substrings (case-insensitive).
 * Used for QA Findings column mapping (Location, QA Finding, Resolved, AM Verified, Operator, Response).
 */
function pickFieldByLabels(fields, labelSubstrings) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length || !Array.isArray(labelSubstrings) || !labelSubstrings.length) return '';
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    for (var j = 0; j < labelSubstrings.length; j++) {
      var sub = String(labelSubstrings[j]).toLowerCase();
      if (sub && (key.indexOf(sub) !== -1 || label.indexOf(sub) !== -1)) {
        var text = fieldDisplayText(f);
        if (f.user && (Array.isArray(f.user) ? f.user[0] : f.user)) {
          var uid = Array.isArray(f.user) ? f.user[0] : f.user;
          var u = getSlackUserInfo(uid);
          return (u.displayName || u.name || uid || '').trim();
        }
        return (text || '').trim();
      }
    }
  }
  return '';
}

/**
 * Same method as Operations tab: find column by Slack field key/label only (no value guessing).
 * Returns { colId: string, index: number } for first field whose key or label matches any substring, or null.
 * @param {Object} fields - item.fields
 * @param {string[]} labelSubstrings - e.g. ['request', 'qa finding', 'finding']
 * @param {Object} [excludeColIds] - optional set of column ids already assigned (e.g. { 'ColIdA': true }) to avoid reusing
 */
function pickQaColumnByLabels(fields, labelSubstrings, excludeColIds) {
  var arr = normalizeFieldsToArray(fields);
  if (!arr.length || !Array.isArray(labelSubstrings) || !labelSubstrings.length) return null;
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var colId = (f.key != null ? f.key : f.column_id != null ? f.column_id : '').toString();
    if (excludeColIds && colId && excludeColIds[colId]) continue;
    var key = (f.key || f.column_id || '').toString().toLowerCase();
    var label = (f.label || f.title || f.name || '').toString().toLowerCase();
    for (var j = 0; j < labelSubstrings.length; j++) {
      var sub = String(labelSubstrings[j]).toLowerCase();
      if (sub && (key.indexOf(sub) !== -1 || label.indexOf(sub) !== -1)) {
        if (colId) return { colId: colId, index: i };
        return null;
      }
    }
  }
  return null;
}

/**
 * QA column mapping using the same method as Operations tab: label-based only (no value guessing).
 * Uses first item's fields; each column is identified by Slack key/label (Request, VM, Status, etc.).
 * @param {Object} firstItemFields - first list item's .fields
 * @returns {{ colIds: Object, indices: Object, columnIdsInOrder: string[] }}
 */
function getQaColumnMappingByLabels(firstItemFields) {
  var colIds = { vm: null, request: null, status: null, to: null, response: null, managerCheck: null };
  var indices = { vm: -1, request: -1, status: -1, to: -1, response: -1, managerCheck: -1 };
  var arr = normalizeFieldsToArray(firstItemFields);
  var columnIdsInOrder = arr.map(function (f) { return (f.key != null ? f.key : f.column_id != null ? f.column_id : '').toString(); }).filter(Boolean);
  if (!columnIdsInOrder.length) return { colIds: colIds, indices: indices, columnIdsInOrder: [] };
  var assigned = {};
  var labelConfig = [
    { key: 'request', substrings: ['request', 'qa finding', 'finding', 'description', 'title', 'item', 'summary'] },
    { key: 'vm', substrings: ['vm', 'location'] },
    { key: 'status', substrings: ['status', 'resolved'] },
    { key: 'to', substrings: ['to', 'operator', 'assignee', 'assigned', 'people'] },
    { key: 'managerCheck', substrings: ['manager check', 'am verified', 'verified', 'manager'] },
    { key: 'response', substrings: ['response'] }
  ];
  for (var c = 0; c < labelConfig.length; c++) {
    var match = pickQaColumnByLabels(firstItemFields, labelConfig[c].substrings, assigned);
    if (match) {
      var matchLabel = (arr[match.index] && (arr[match.index].label || arr[match.index].title || arr[match.index].name || '')).toString().toLowerCase();
      if (labelConfig[c].key === 'response' && matchLabel.indexOf('manager') !== -1) continue;
      if (labelConfig[c].key === 'managerCheck' && matchLabel.indexOf('comment') !== -1) continue;
      colIds[labelConfig[c].key] = match.colId;
      var idx = columnIdsInOrder.indexOf(match.colId);
      indices[labelConfig[c].key] = idx >= 0 ? idx : match.index;
      assigned[match.colId] = true;
    }
  }
  return { colIds: colIds, indices: indices, columnIdsInOrder: columnIdsInOrder };
}

/**
 * Fallback: pick first non-empty top-level property from a list of keys.
 * Used when Slack list data does not put values into item.fields.
 */
function pickTopLevelByKeys(item, keys) {
  if (!item || !keys || !keys.length) return '';
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k in item && item[k] != null && item[k] !== '') {
      var val = String(item[k]).trim();
      // If it's a Slack user ID, return display name
      if (looksLikeSlackUserId(val)) {
        try {
          var u = getSlackUserInfo(val);
          return (u.displayName || u.name || val);
        } catch (e) {
          return val;
        }
      }
      // If it's a Slack select option ID (Opt...), try to map to label using existing mapping
      if (/^Opt[A-Za-z0-9]+$/.test(val)) {
        return mapPriorityOptionIdToLabel(val);
      }
      return val;
    }
  }
  return '';
}

/**
 * Run this from the script editor (Run > logQaColumnIdsForMapping) to print column IDs and a template for SLACK_QA_COLUMN_IDS.
 * Then copy the JSON from the log, edit the values (request, vm, status, to, response, managerCheck) to match your list columns, and set Script Property SLACK_QA_COLUMN_IDS.
 */
function logQaColumnIdsForMapping() {
  var listId = getIssuesActionsListId();
  if (!listId) {
    Logger.log('Set SLACK_ISSUES_ACTIONS_LIST_ID first.');
    return;
  }
  var cookieToken = null;
  try {
    var t = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_TOKEN');
    if (t && t.trim() && t.trim().indexOf('xoxc-') === 0) cookieToken = t.trim();
  } catch (e) {}
  if (!cookieToken) {
    Logger.log('Set SLACK_COOKIE_TOKEN (xoxc-...) to fetch the list.');
    return;
  }
  var internalResult = tryListsRecordsList(listId, cookieToken);
  if (!internalResult || internalResult.error || !Array.isArray(internalResult.items) || internalResult.items.length === 0) {
    Logger.log('Could not fetch list: ' + (internalResult && internalResult.error ? internalResult.error : 'no items'));
    return;
  }
  var qaMap = getQaColumnMappingFromListResponse(internalResult.rawData || null);
  var columnIdsInOrder = qaMap.columnIdsInOrder || [];
  var first = internalResult.items[0];
  var fields = (first && first.fields) || {};
  function peek(fields, colId) {
    if (!fields[colId]) return '';
    var c = fields[colId];
    if (typeof c === 'object' && c.text != null) return String(c.text).substring(0, 50);
    if (typeof c === 'object' && c.value != null) return String(c.value).substring(0, 50);
    if (typeof c === 'object' && c.select && c.select[0]) return String(c.select[0]).substring(0, 50);
    return String(c).substring(0, 50);
  }
  Logger.log('--- QA column IDs and first row value (left-to-right in your list: Request, VM, Status, Manager Check, To, Response) ---');
  var template = {};
  for (var i = 0; i < columnIdsInOrder.length; i++) {
    var id = columnIdsInOrder[i];
    var val = peek(fields, id);
    Logger.log(id + ' => "' + val + '"');
    var key = 'column' + i;
    if (i === 0) key = 'request';
    else if (i === 1) key = 'vm';
    else if (i === 2) key = 'status';
    else if (i === 3) key = 'managerCheck';
    else if (i === 4) key = 'to';
    else if (i === 5) key = 'response';
    template[id] = key;
  }
  Logger.log('--- Paste this into Script Property SLACK_QA_COLUMN_IDS (edit values to match: vm, request, status, to, response, managerCheck) ---');
  Logger.log(JSON.stringify(template, null, 2));
}

/**
 * Fetch QA Findings from Slack list "issues-actions".
 * Data flow: Slack API -> listItems + rawData. We keep rawData unchanged and return it as rawListData
 * (so "Download raw JSON" is the unmodified API response). We also build: colIds from list/schema,
 * then one value per column per row via readOneField (request, vm, status, managerCheck, to, response);
 * findings = normalized rows; slackTable = table for UI; rawListDataFriendly = table-shaped JSON for optional download.
 * The Slack API returns fields keyed by column ID; we map those to fixed keys once; readOneField resolves
 * by colId or field.column_id/key. QA data version: 11. No swaps or find-in-row. If columns are wrong, set SLACK_QA_COLUMN_IDS.
 */
function fetchQaFindingsFromSlack() {
  try {
    // Fixed column order for Issues & Actions list:
    // 0: VM, 1: Request, 2: Status, 3: To, 4: From, 5: Assigned by, 6: Needed by,
    // 7: Response, 8: Manager Check, 9: Manager Comment.
    var listId = getIssuesActionsListId();
    if (!listId) {
      return {
        findings: [],
        total: 0,
        error: 'list_id_not_configured',
        message: 'Set Script Property SLACK_ISSUES_ACTIONS_LIST_ID to the list ID of your Slack "issues-actions" list.'
      };
    }
    // Same API path as Operations tab: fetchSlackListItems (internal API when cookie set, then rawData available)
    var fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) {
      return {
        findings: [],
        total: 0,
        error: fetchResult.error,
        message: fetchResult.message || fetchResult.error,
        checklist: fetchResult.checklist,
        qaDataVersion: 13
      };
    }
    var listItems = (fetchResult && fetchResult.items) ? fetchResult.items : [];
    var rawData = (fetchResult && fetchResult.rawData) ? fetchResult.rawData : null;
    if (rawData) {
      var extracted = extractOptionMapFromListResponse(rawData);
      if (Object.keys(extracted).length > 0) setSavedQaOptionLabels(extracted);
    }
    try {
      var schemaMap = tryFetchListSchemaWithCookie(listId);
      if (Object.keys(schemaMap).length > 0) setSavedQaOptionLabels(schemaMap);
    } catch (e) { /* optional */ }
    if (!listItems || listItems.length === 0) {
      return { findings: [], total: 0, message: 'No items in issues-actions list.', slackTable: { headers: [], rows: [] }, rawListData: null, rawListDataFriendly: null, qaDataVersion: 13, qaColumnMapping: {}, qaFirstRowSample: null, qaColumnDebug: [], qaColumnOrder: [] };
    }
    var optionMap = getSavedQaOptionLabels();

    // Log sample item + field layout once to fine-tune mapping
    try {
      var sampleItem = listItems[0];
      Logger.log('QA Findings sample item: ' + JSON.stringify(sampleItem, null, 2));
      if (sampleItem && sampleItem.fields) {
        var norm = normalizeFieldsToArray(sampleItem.fields);
        if (norm && norm.length) {
          var cols = norm.map(function(f, idx) {
            return idx + ': key=' + (f.key || f.column_id || '') + ' label=' + (f.label || f.title || '') +
              ' text=' + fieldDisplayText(f).substring(0, 40);
          });
          Logger.log('QA Findings field layout (0-based indices): ' + cols.join(' | '));
        }
      }
    } catch (logErr) {
      Logger.log('QA Findings sample logging error: ' + logErr.toString());
    }
    var dataForMapping = rawData || null;
    var hasColumnsInRaw = dataForMapping && dataForMapping.list && (Array.isArray(dataForMapping.list.columns) && dataForMapping.list.columns.length > 0 || dataForMapping.list.column_definitions && Object.keys(dataForMapping.list.column_definitions).length > 0);
    if (!hasColumnsInRaw) {
      var fetchedColumns = tryFetchListColumnsWithCookie(listId);
      if (fetchedColumns.length > 0) {
        dataForMapping = { list: { columns: fetchedColumns }, records: listItems };
        Logger.log('QA column mapping using ' + fetchedColumns.length + ' columns from lists.get/lists.view');
      }
    }
    var qaMap = getQaColumnMappingFromListResponse(dataForMapping || { records: listItems });
    var colIds = qaMap.colIds;
    var columnIdsInOrder = qaMap.columnIdsInOrder || [];
    var orderFromApi = qaMap.orderFromApi === true;
    var firstFields = listItems[0] && listItems[0].fields;
    if (columnIdsInOrder.length === 0 && firstFields) {
      if (Array.isArray(firstFields)) {
        for (var ai = 0; ai < firstFields.length; ai++) columnIdsInOrder.push(String(ai));
      } else if (typeof firstFields === 'object') {
        columnIdsInOrder = Object.keys(firstFields);
      }
    }
    var idxVm = qaMap.indices.vm, idxRequest = qaMap.indices.request, idxStatus = qaMap.indices.status, idxTo = qaMap.indices.to, idxResponse = qaMap.indices.response, idxManagerCheck = qaMap.indices.managerCheck;

    // Optional: Script Property SLACK_QA_COLUMN_IDS. You do NOT need to set it.
    // Only set it if automatic column detection puts data in the wrong columns. Value = JSON you paste in Project Settings > Script Properties (e.g. {"request":"0ABC","vm":"0DEF",...}).
    var idsProp = PropertiesService.getScriptProperties().getProperty('SLACK_QA_COLUMN_IDS');
    if (idsProp && idsProp.trim()) {
      try {
        var idsMap = JSON.parse(idsProp.trim());
        var validKeys = { vm: 1, request: 1, status: 1, to: 1, response: 1, managerCheck: 1 };
        function looksLikeColId(s) { return s && typeof s === 'string' && s.length >= 6 && /^[0-9A-Za-z]+$/.test(s); }
        for (var k in idsMap) {
          if (!idsMap.hasOwnProperty(k)) continue;
          var v = (idsMap[k] || '').toString().trim();
          if (validKeys[k] && looksLikeColId(v)) { colIds[k] = v; }
          else if (validKeys[v] && looksLikeColId(k)) { colIds[v] = k; }
        }
        Logger.log('QA columns from SLACK_QA_COLUMN_IDS: request=' + (colIds.request || '') + ' vm=' + (colIds.vm || '') + ' status=' + (colIds.status || '') + ' to=' + (colIds.to || '') + ' response=' + (colIds.response || '') + ' managerCheck=' + (colIds.managerCheck || ''));
      } catch (e) { Logger.log('SLACK_QA_COLUMN_IDS parse error: ' + e.toString()); }
    }

    var indicesExplicitlySet = false;
    try {
      var idxProp = PropertiesService.getScriptProperties().getProperty('SLACK_QA_COLUMN_INDICES');
      if (idxProp && idxProp.trim()) {
        var parsed = JSON.parse(idxProp.trim());
        if (parsed.vm != null) { idxVm = parseInt(parsed.vm, 10); indicesExplicitlySet = true; }
        if (parsed.request != null) { idxRequest = parseInt(parsed.request, 10); indicesExplicitlySet = true; }
        if (parsed.status != null) { idxStatus = parseInt(parsed.status, 10); indicesExplicitlySet = true; }
        if (parsed.to != null) { idxTo = parseInt(parsed.to, 10); indicesExplicitlySet = true; }
        if (parsed.response != null) { idxResponse = parseInt(parsed.response, 10); indicesExplicitlySet = true; }
        if (parsed.managerCheck != null) { idxManagerCheck = parseInt(parsed.managerCheck, 10); indicesExplicitlySet = true; }
      }
    } catch (e) { Logger.log('SLACK_QA_COLUMN_INDICES parse error: ' + e.toString()); }
    if (indicesExplicitlySet && columnIdsInOrder.length > 0) {
      if (idxRequest >= 0 && idxRequest < columnIdsInOrder.length) colIds.request = columnIdsInOrder[idxRequest];
      if (idxVm >= 0 && idxVm < columnIdsInOrder.length) colIds.vm = columnIdsInOrder[idxVm];
      if (idxStatus >= 0 && idxStatus < columnIdsInOrder.length) colIds.status = columnIdsInOrder[idxStatus];
      if (idxManagerCheck >= 0 && idxManagerCheck < columnIdsInOrder.length) colIds.managerCheck = columnIdsInOrder[idxManagerCheck];
      if (idxTo >= 0 && idxTo < columnIdsInOrder.length) colIds.to = columnIdsInOrder[idxTo];
      if (idxResponse >= 0 && idxResponse < columnIdsInOrder.length) colIds.response = columnIdsInOrder[idxResponse];
      Logger.log('QA columns set from SLACK_QA_COLUMN_INDICES');
    }
    var userSetMapping = (idsProp && idsProp.trim()) || indicesExplicitlySet;
    if (!userSetMapping) {
      var firstRec = listItems[0];
      var firstFields = firstRec && firstRec.fields;
      var hasKnownIssuesActionsStructure = false;
      if (firstFields && (Array.isArray(firstFields) || typeof firstFields === 'object')) {
        var arr = normalizeFieldsToArray(firstFields);
        for (var fi = 0; fi < arr.length; fi++) {
          var fid = (arr[fi].column_id || arr[fi].key || '').toString();
          if (fid === ISSUES_ACTIONS_QA_COLUMN_IDS.request || (arr[fi].key === 'name' && fid === 'Col0ADFA0669H')) {
            hasKnownIssuesActionsStructure = true;
            break;
          }
        }
      }
      if (hasKnownIssuesActionsStructure) {
        colIds.request = ISSUES_ACTIONS_QA_COLUMN_IDS.request;
        colIds.vm = ISSUES_ACTIONS_QA_COLUMN_IDS.vm;
        colIds.status = ISSUES_ACTIONS_QA_COLUMN_IDS.status;
        colIds.managerCheck = ISSUES_ACTIONS_QA_COLUMN_IDS.managerCheck;
        colIds.to = ISSUES_ACTIONS_QA_COLUMN_IDS.to;
        colIds.response = ISSUES_ACTIONS_QA_COLUMN_IDS.response;
        Logger.log('QA columns set from known Issues & Actions list structure (14 rows, same column_ids per row).');
      } else {
        disambiguateStatusAndResponseByValue(listItems, colIds, qaMap.indices);
      }
    }
    // Always use the fixed Issues & Actions mapping for this list (matches Slack exactly: Request, VM, Status, Manager Check, To, Response with From text in Response).
    colIds.request = ISSUES_ACTIONS_QA_COLUMN_IDS.request;
    colIds.vm = ISSUES_ACTIONS_QA_COLUMN_IDS.vm;
    colIds.status = ISSUES_ACTIONS_QA_COLUMN_IDS.status;
    colIds.managerCheck = ISSUES_ACTIONS_QA_COLUMN_IDS.managerCheck;
    colIds.to = ISSUES_ACTIONS_QA_COLUMN_IDS.to;
    colIds.response = ISSUES_ACTIONS_QA_COLUMN_IDS.response;
    if (qaMap.indices) { idxStatus = qaMap.indices.status; idxResponse = qaMap.indices.response; }
    Logger.log('QA columns: request=' + (colIds.request || '') + ' vm=' + (colIds.vm || '') + ' status=' + (colIds.status || '') + ' managerCheck=' + (colIds.managerCheck || '') + ' to=' + (colIds.to || '') + ' response=' + (colIds.response || '') + '; orderFromApi=' + orderFromApi);

    if (listItems[0] && listItems[0].fields && columnIdsInOrder.length > 0) {
      var firstFields = listItems[0].fields;
      function peekVal(fields, colId) {
        if (!fields || !colId || fields[colId] == null) return '';
        var cell = fields[colId];
        if (typeof cell === 'object' && cell.text != null) return String(cell.text).substring(0, 30);
        if (typeof cell === 'object' && cell.value != null) return String(cell.value).substring(0, 30);
        if (typeof cell === 'object' && cell.select && cell.select[0]) return String(cell.select[0]).substring(0, 30);
        return String(cell).substring(0, 30);
      }
      var colPreview = columnIdsInOrder.map(function (id) { return id + '=' + peekVal(firstFields, id); }).join(' | ');
      Logger.log('QA column IDs (set SLACK_QA_COLUMN_IDS to map these to: vm, request, status, to, response, managerCheck): ' + colPreview);
    }
    function isDateLike(s) {
      if (!s || typeof s !== 'string') return false;
      var t = s.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t)) return true;
      if (/^\d{2,4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(t)) return true;
      if (/\d{4}/.test(t) && (/[\-\/]/.test(t) || t.toLowerCase().indexOf('date') !== -1)) return true;
      return false;
    }
    function readOneField(fields, colId, optionMap, opts) {
      if (!fields || typeof fields !== 'object' || colId == null) return '';
      var cell = null;
      if (!Array.isArray(fields) && fields[colId] != null) {
        cell = fields[colId];
      } else if (Array.isArray(fields) && /^\d+$/.test(String(colId))) {
        var idx = parseInt(colId, 10);
        if (idx >= 0 && idx < fields.length) cell = fields[idx];
      }
      if (cell == null) {
        var colIdStr = String(colId);
        // Same column can be keyed differently per row (e.g. column_id vs key); match by field.column_id or field.key
        if (Array.isArray(fields)) {
          for (var ai = 0; ai < fields.length; ai++) {
            var f = fields[ai];
            if (f && (String(f.column_id || '') === colIdStr || String(f.key || '') === colIdStr)) { cell = f; break; }
          }
        } else if (typeof fields === 'object') {
          for (var k in fields) {
            if (!fields.hasOwnProperty(k)) continue;
            var v = fields[k];
            if (v && typeof v === 'object' && (String(v.column_id || '') === colIdStr || String(v.key || '') === colIdStr || k === colIdStr)) { cell = v; break; }
          }
        }
      }
      if (cell == null) return '';
      var raw = '';
      if (typeof cell === 'object') {
        if (cell.user != null) {
          var u = Array.isArray(cell.user) ? cell.user[0] : cell.user;
          raw = u ? String(u) : (fieldDisplayText(cell) || '').trim();
        } else if (cell.channel != null) {
          var ch = Array.isArray(cell.channel) ? cell.channel[0] : cell.channel;
          raw = ch ? String(ch) : (fieldDisplayText(cell) || '').trim();
        } else if (cell.text != null && String(cell.text).trim()) {
          raw = String(cell.text).trim();
        } else if (cell.rich_text && Array.isArray(cell.rich_text) && cell.rich_text.length) {
          raw = cell.rich_text.map(function (b) { return b && b.text ? b.text : ''; }).join('').trim();
        } else if (cell.number != null || typeof cell.value === 'number') {
          var num = cell.number != null ? (Array.isArray(cell.number) ? cell.number[0] : cell.number) : cell.value;
          raw = (num != null && num !== '') ? String(num) : (cell.value != null ? String(cell.value) : '').trim();
        } else {
          raw = (fieldDisplayText(cell) || (cell.value != null ? String(cell.value) : '') || '').trim();
        }
      } else {
        raw = (cell != null ? String(cell) : '').trim();
      }
      if (!raw) return '';
      if (opts && opts.raw) return raw;
      if (opts && opts.wantUser && looksLikeSlackUserId(raw)) {
        try {
          var ui = getSlackUserInfo(raw);
          return (ui.displayName || ui.name || raw).trim();
        } catch (e) { return raw; }
      }
      if (opts && opts.resolveStatus && /^Opt[A-Za-z0-9]+$/.test(raw)) return resolveResolvedStatusToLabel(raw, optionMap);
      if (/^Opt[A-Za-z0-9]+$/.test(raw) && optionMap) {
        var label = resolveQaOptionToLabel(raw, optionMap);
        if (label && label !== raw) return label;
      }
      if (opts && opts.skipDateLike && isDateLike(raw)) return '';
      if (raw && /^C[A-Z0-9]{8,}$/.test(raw) && typeof getSlackChannelName === 'function') return getSlackChannelName(raw) || raw;
      if (raw && /^Opt[A-Za-z0-9]+$/.test(raw)) {
        var locLabels = getLocationLabels();
        if (locLabels && locLabels[raw]) return String(locLabels[raw]);
        return resolveQaOptionToLabel(raw, optionMap) || raw;
      }
      return raw;
    }

    // One read per column per row. Cell found by colId or by field.column_id / field.key. No swaps, no find-in-row.
    var findings = [];
    listItems.forEach(function (item) {
      var fields = item.fields || {};
      var requestVal = readOneField(fields, colIds.request, optionMap, {});
      var vmVal = readOneField(fields, colIds.vm, optionMap, {});
      var statusVal = readOneField(fields, colIds.status, optionMap, { resolveStatus: true });
      var managerCheckVal = readOneField(fields, colIds.managerCheck, optionMap, {});
      var toVal = readOneField(fields, colIds.to, optionMap, { wantUser: true });
      var responseVal = readOneField(fields, colIds.response, optionMap, { skipDateLike: true });
      if (!responseVal || /^\d{1,2}$/.test(String(responseVal).trim())) {
        var fromText = readOneField(fields, 'Col0ADJ9MNATF', optionMap, {});
        if (fromText) responseVal = fromText;
      }
      if (toVal && /^\d{1,2}$/.test(String(toVal).trim())) toVal = '';
      findings.push({
        location: vmVal || '',
        qaFinding: requestVal || '',
        resolved: statusVal || '',
        amVerified: managerCheckVal || '',
        operator: toVal || '',
        response: responseVal || ''
      });
    });

    var agreedOrder = [ { key: 'request', title: 'Request' }, { key: 'vm', title: 'VM' }, { key: 'status', title: 'Status' }, { key: 'managerCheck', title: 'Manager Check' }, { key: 'to', title: 'To' }, { key: 'response', title: 'Response' } ];
    var slackTable = { headers: [], rows: [] };
    agreedOrder.forEach(function (col) {
      if (colIds[col.key]) slackTable.headers.push({ id: colIds[col.key], title: col.title });
    });
    slackTable.rows = findings.map(function (f) {
      return [ f.qaFinding, f.location, f.resolved, f.amVerified, f.operator, f.response ];
    });


    // rawListData = exact copy of Slack API response (for download). Deep copy so mapping code cannot mutate it.
    var rawListData = rawData
      ? JSON.parse(JSON.stringify(rawData))
      : { items: listItems, source: 'normalized', note: 'Raw API response not available; this is the normalized items array.' };
    // rawListDataFriendly = our table format (findings with our column titles and resolved labels); only for optional "friendly" download.
    var rawListDataFriendly = null;
    if (slackTable.headers.length > 0 && slackTable.rows.length > 0) {
      rawListDataFriendly = {
        columns: slackTable.headers.map(function (h) { return { id: h.id, title: h.title }; }),
        rows: slackTable.rows.map(function (row) {
          var obj = {};
          slackTable.headers.forEach(function (h, i) { obj[h.title] = row[i] != null ? row[i] : ''; });
          return obj;
        }),
        note: 'Table format: our column names with resolved option labels. Use "Download raw JSON" for unmodified API response.'
      };
    }
    var qaMappingMethod = (idsProp && idsProp.trim()) ? 'SLACK_QA_COLUMN_IDS' : (indicesExplicitlySet ? 'SLACK_QA_COLUMN_INDICES' : ((qaMap && qaMap.mappingMethod) ? qaMap.mappingMethod : 'unknown'));
    var qaDataVersion = 13;
    var qaColumnMapping = { request: colIds.request || '', vm: colIds.vm || '', status: colIds.status || '', managerCheck: colIds.managerCheck || '', to: colIds.to || '', response: colIds.response || '' };
    var qaFirstRowSample = null;
    if (findings.length > 0) {
      var f0 = findings[0];
      qaFirstRowSample = { request: f0.qaFinding, vm: f0.location, status: f0.resolved, managerCheck: f0.amVerified, to: f0.operator, response: f0.response };
    }
    var qaColumnDebug = [];
    var idToTitle = {};
    if (rawData && rawData.list) {
      var cols = rawData.list.columns || rawData.list.column_definitions || [];
      if (Array.isArray(cols)) {
        for (var cx = 0; cx < cols.length; cx++) {
          var col = cols[cx];
          if (col && (col.id || col.key || col.column_id))
            idToTitle[String(col.id || col.key || col.column_id)] = (col.title || col.label || col.name || '').toString().trim();
        }
      }
    }
    function rawCellVal(fields, colId) {
      if (!fields || !colId || fields[colId] == null) return '';
      var cell = fields[colId];
      if (typeof cell === 'object' && cell.text != null) return String(cell.text).substring(0, 60);
      if (typeof cell === 'object' && cell.value != null) return String(cell.value).substring(0, 60);
      if (typeof cell === 'object' && cell.select && cell.select[0]) return String(cell.select[0]).substring(0, 60);
      return String(cell).substring(0, 60);
    }
    var firstFields = listItems[0] && listItems[0].fields;
    var keysOrder = ['request', 'vm', 'status', 'managerCheck', 'to', 'response'];
    for (var ki = 0; ki < keysOrder.length; ki++) {
      var k = keysOrder[ki];
      var cid = colIds[k];
      qaColumnDebug.push({
        key: k,
        colId: cid || '',
        title: (cid && idToTitle[cid]) ? idToTitle[cid] : '',
        firstValue: firstFields && cid ? rawCellVal(firstFields, cid) : ''
      });
    }
    var qaColumnOrder = [];
    for (var oi = 0; oi < columnIdsInOrder.length; oi++) {
      var oid = columnIdsInOrder[oi];
      qaColumnOrder.push({ index: oi, colId: oid, firstValue: firstFields ? rawCellVal(firstFields, oid) : '', title: idToTitle[oid] || '' });
    }
    var slackListColumnsUsed = (qaMappingMethod === 'title_from_api');
    return { findings: findings, total: findings.length, slackTable: slackTable, rawListData: rawListData, rawListDataFriendly: rawListDataFriendly, qaMappingMethod: qaMappingMethod, qaDataVersion: qaDataVersion, qaColumnMapping: qaColumnMapping, qaFirstRowSample: qaFirstRowSample, qaColumnDebug: qaColumnDebug, qaColumnOrder: qaColumnOrder, slackListColumnsUsed: slackListColumnsUsed };
  } catch (e) {
    Logger.log('fetchQaFindingsFromSlack error: ' + e.toString());
    return {
      findings: [],
      total: 0,
      error: 'exception',
      message: e.toString(),
      slackTable: { headers: [], rows: [] },
      rawListData: null,
      rawListDataFriendly: null,
      qaMappingMethod: 'none',
      qaDataVersion: 13,
      qaColumnMapping: {},
      qaFirstRowSample: null,
      qaColumnDebug: [],
      qaColumnOrder: [],
      slackListColumnsUsed: false
    };
  }
}

/**
 * Fetch the raw API response for the QA Issues & Actions list and save it as a JSON file to Google Drive.
 * The file is the exact response from the Slack API (lists.records.list), so you can paste it here
 * to fix column mapping. Filename: qa-findings-raw-api-response-YYYY-MM-DD-HHmmss.json
 * @returns {{ success: boolean, fileId?: string, fileUrl?: string, filename?: string, error?: string, message?: string }}
 */
function saveQaFindingsRawResponseToDrive() {
  try {
    var listId = getIssuesActionsListId();
    if (!listId) {
      return { success: false, error: 'list_id_not_configured', message: 'Set Script Property SLACK_ISSUES_ACTIONS_LIST_ID.' };
    }
    var fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) {
      return { success: false, error: fetchResult.error, message: fetchResult.message || fetchResult.error };
    }
    var rawData = (fetchResult && fetchResult.rawData) ? fetchResult.rawData : null;
    if (!rawData && fetchResult && fetchResult.items) {
      rawData = { ok: true, records: fetchResult.items, source: 'normalized', note: 'Raw API response not available; records are the normalized items from fetchSlackListItems.' };
    }
    if (!rawData) {
      return { success: false, error: 'no_data', message: 'No list data returned from Slack.' };
    }
    var json = JSON.stringify(rawData, null, 2);
    var filename = 'qa-findings-raw-api-response-' + (new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)) + '.json';
    var file = DriveApp.createFile(filename, json, 'application/json');
    var fileId = file.getId();
    var fileUrl = file.getUrl();
    Logger.log('Saved QA raw API response to Drive: ' + filename + ' ' + fileUrl);
    return { success: true, fileId: fileId, fileUrl: fileUrl, filename: filename };
  } catch (e) {
    Logger.log('saveQaFindingsRawResponseToDrive error: ' + e.toString());
    return { success: false, error: 'exception', message: e.toString() };
  }
}

/**
 * Fetch Customer Feedback from Slack list "issues-actions" (WhatsApp source).
 * Only includes items where Rating has a value.
 * Map columns: Drink, Rating, Comment (Request), Location (VM), App = "WhatsApp".
 * Returns { items: [{ drink, rating, comment, location, app }], total, error?, message? }.
 */
function fetchCustomerFeedbackFromSlack() {
  try {
    var listId = getIssuesActionsListId();
    if (!listId) {
      return {
        items: [],
        total: 0,
        error: 'list_id_not_configured',
        message: 'Set Script Property SLACK_ISSUES_ACTIONS_LIST_ID to the list ID of your Slack "issues-actions" list.'
      };
    }
    var fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) {
      return { items: [], total: 0, error: fetchResult.error, message: fetchResult.message || fetchResult.error };
    }
    var listItems = (fetchResult && fetchResult.items) ? fetchResult.items : [];
    if (!listItems || listItems.length === 0) {
      return { items: [], total: 0, message: 'No items in issues-actions list.' };
    }
    var optionMap = getSavedQaOptionLabels();
    var items = [];
    function getCfField(fields, labelKeys, indexProp) {
      var v = pickFieldByLabels(fields, labelKeys);
      if (v) return v;
      try {
        var idx = PropertiesService.getScriptProperties().getProperty(indexProp);
        if (idx != null && idx !== '') {
          var n = parseInt(idx, 10);
          if (!isNaN(n) && n >= 0) {
            var arr = normalizeFieldsToArray(fields);
            if (n < arr.length) return fieldDisplayText(arr[n]) || '';
          }
        }
      } catch (e) {}
      return '';
    }
    listItems.forEach(function (item) {
      var fields = item.fields || {};
      var drink = getCfField(fields, ['drink'], 'SLACK_CF_DRINK_INDEX');
      var rating = getCfField(fields, ['rating'], 'SLACK_CF_RATING_INDEX');
      var comment = getCfField(fields, ['request', 'comment'], 'SLACK_CF_REQUEST_INDEX');
      if (!comment) comment = pickRequestTextFromFields(fields) || item.title || item.text || '';
      var locationRaw = getCfField(fields, ['vm', 'location'], 'SLACK_CF_VM_INDEX');
      var location = locationRaw;
      if (locationRaw && /^Opt[A-Za-z0-9]+$/.test(String(locationRaw).trim())) {
        location = resolveQaOptionToLabel(String(locationRaw).trim(), optionMap);
      }
      if (!rating || String(rating).trim() === '') return;
      items.push({
        drink: (drink || '').trim(),
        rating: (rating || '').trim(),
        comment: (comment || '').trim(),
        location: (location || '').trim(),
        app: 'WhatsApp'
      });
    });
    return { items: items, total: items.length };
  } catch (e) {
    Logger.log('fetchCustomerFeedbackFromSlack error: ' + e.toString());
    return {
      items: [],
      total: 0,
      error: 'exception',
      message: e.toString()
    };
  }
}

/**
 * Fetch Customer Feedback from all sources (issues-actions/WhatsApp, LeetSub, Survey App).
 * Only entries with a Rating are included. Frontend calls this.
 * @returns {{ items: Array<{drink,rating,comment,location,app}>, total, error?, message? }}
 */
function fetchCustomerFeedback() {
  var all = [];
  var err = null;
  var msg = '';
  try {
    var slackResult = fetchCustomerFeedbackFromSlack();
    if (slackResult.error) {
      err = slackResult.error;
      msg = slackResult.message || slackResult.error;
    }
    if (slackResult.items && slackResult.items.length) {
      all = all.concat(slackResult.items);
    }
    if (all.length === 0 && !err) {
      msg = slackResult.message || 'No customer feedback with ratings found.';
    }
  } catch (e) {
    err = 'exception';
    msg = e.toString();
  }
  return { items: all, total: all.length, error: err || null, message: msg || null };
}

/**
 * Optional: 0-based column index for Priority (Script Property SLACK_LIST_PRIORITY_FIELD_INDEX).
 * If set, we use that field's value (e.g. High, Medium) instead of key-based detection.
 */
function getPriorityFieldIndex() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('SLACK_LIST_PRIORITY_FIELD_INDEX');
    if (v != null && v !== '') { var n = parseInt(v, 10); if (!isNaN(n) && n >= 0) return n; }
  } catch (e) {}
  return -1;
}

/**
 * Optional: 0-based column index for "Request" title (Script Property SLACK_LIST_REQUEST_FIELD_INDEX).
 * If set, we use that field for request text when it's not a user ID.
 */
function getRequestFieldIndex() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty('SLACK_LIST_REQUEST_FIELD_INDEX');
    if (v != null && v !== '') { var n = parseInt(v, 10); if (!isNaN(n) && n >= 0) return n; }
  } catch (e) {}
  return -1;
}

/**
 * Return column layout for the Staff Requests list (first item's fields) so the app can show
 * which index maps to which column. Use this to set SLACK_LIST_REQUEST_FIELD_INDEX and
 * SLACK_LIST_PRIORITY_FIELD_INDEX in Script Properties if titles/priority don't match Slack.
 * @returns {{ columns: Array<{index: number, key: string, label: string, sample: string}>, error?: string }}
 */
function getSlackListColumnLayout() {
  try {
    var listId = getStaffRequestsListId();
    if (!listId) return { columns: [], error: 'list_id_not_configured' };
    var fetchResult = fetchSlackListItems(listId);
    if (fetchResult && fetchResult.error) return { columns: [], error: fetchResult.error };
    var listItems = (fetchResult && fetchResult.items) ? fetchResult.items : [];
    if (!listItems || listItems.length === 0) return { columns: [], error: 'no_items' };
    var fields = normalizeFieldsToArray(listItems[0].fields);
    var columns = fields.map(function (f, idx) {
      var sample = fieldDisplayText(f);
      if (sample.length > 50) sample = sample.substring(0, 50) + '…';
      return {
        index: idx,
        key: (f.key || f.column_id || '').toString(),
        label: (f.label || f.title || f.name || '').toString(),
        sample: sample
      };
    });
    return { columns: columns };
  } catch (e) {
    return { columns: [], error: e.toString() };
  }
}

/**
 * Call official Slack API slackLists.items.list (paid workspace; requires lists:read).
 * Uses list_id parameter and Bearer token.
 * @param {string} listId - List encoded ID (e.g. F08NW0659RP)
 * @param {string} token - Bot or user OAuth token (xoxb- or xoxp-)
 * @returns {{ items?: Array, error?: string, slackError?: string }}
 */
function trySlackListsItemsList(listId, token) {
  try {
    const url = SLACK_API_BASE + '/slackLists.items.list';
    const options = {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: 'list_id=' + encodeURIComponent(listId),
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      Logger.log('Slack Lists API parse error: ' + e.toString());
      return {};
    }
    if (code !== 200) {
      Logger.log('Slack Lists API HTTP ' + code + ': ' + text.substring(0, 500));
      return { error: data.error || 'http_error', slackError: data.error };
    }
    if (data.ok === true && Array.isArray(data.items)) {
      var rows = data.items;
      var parentOnly = rows.filter(function (row) { return !row.parent_record_id; });
      if (parentOnly.length < rows.length) {
        Logger.log('Slack list: ' + rows.length + ' items total, ' + parentOnly.length + ' top-level (excluding subtasks)');
      }
      const items = parentOnly.map(function (row) {
        var requestText = pickRequestTextFromFields(row.fields);
        var assigneeOrCreatedBy = pickAssigneeFromFields(row.fields) || row.created_by;
        return {
          id: row.id,
          list_item_id: row.id,
          list_id: row.list_id,
          date_created: row.date_created,
          created_at: row.date_created,
          created_by: row.created_by,
          user_id: assigneeOrCreatedBy || row.created_by,
          title: requestText,
          text: requestText,
          fields: row.fields,
          archived: row.archived
        };
      });
      return { items: items };
    }
    if (data.ok === false && data.error) {
      Logger.log('Slack Lists API error: ' + data.error);
      return { error: data.error, slackError: data.error };
    }
    return {};
  } catch (e) {
    Logger.log('trySlackListsItemsList error: ' + e.toString());
    return {};
  }
}

/**
 * Call Slack internal API lists.records.list (works with xoxc- cookie token).
 * Mirrors the browser request: POST multipart/form-data to workspace host.
 * @param {string} listId - List encoded ID (e.g. F08NW0659RP)
 * @param {string} cookieToken - Cookie token (xoxc-...)
 * @returns {{ items?: Array, error?: string }} Normalized items or error
 */
function tryListsRecordsList(listId, cookieToken) {
  try {
    const host = getSlackWorkspaceHost();
    const url = 'https://' + host + '/api/lists.records.list';
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2, 18);
    const crlf = '\r\n';
    const parts = [
      '--' + boundary,
      'Content-Disposition: form-data; name="token"' + crlf + crlf + cookieToken,
      '--' + boundary,
      'Content-Disposition: form-data; name="list_id"' + crlf + crlf + listId,
      '--' + boundary,
      'Content-Disposition: form-data; name="include_subtasks"' + crlf + crlf + 'true',
      '--' + boundary,
      'Content-Disposition: form-data; name="archived"' + crlf + crlf + 'false',
      '--' + boundary,
      'Content-Disposition: form-data; name="include_suggested"' + crlf + crlf + 'false',
      '--' + boundary,
      'Content-Disposition: form-data; name="_x_reason"' + crlf + crlf + 'get-list-records',
      '--' + boundary,
      'Content-Disposition: form-data; name="_x_mode"' + crlf + crlf + 'online',
      '--' + boundary,
      'Content-Disposition: form-data; name="_x_sonic"' + crlf + crlf + 'true',
      '--' + boundary,
      'Content-Disposition: form-data; name="_x_app_name"' + crlf + crlf + 'client',
      '--' + boundary + '--'
    ];
    const payload = parts.join(crlf);
    const headers = {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Accept': '*/*',
      'Origin': 'https://app.slack.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
    };
    try {
      const cookieHeader = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_HEADER');
      if (cookieHeader && cookieHeader.trim()) {
        headers['Cookie'] = cookieHeader.trim();
      }
    } catch (e) { /* ignore */ }
    const options = {
      method: 'post',
      headers: headers,
      payload: payload,
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const text = response.getContentText();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      Logger.log('lists.records.list parse error: ' + e.toString());
      return { error: 'parse_error' };
    }
    if (code !== 200) {
      Logger.log('lists.records.list HTTP ' + code + ': ' + text.substring(0, 500));
      return { error: data.error || 'http_error' };
    }
    if (data.ok === false && data.error) {
      Logger.log('lists.records.list API error: ' + data.error);
      return { error: data.error };
    }
    // Response may have records, items, or list_items (array or object keyed by id)
    var raw = data.records || data.items || data.list_items || (data.list && data.list.records) || (data.list && data.list.items) || (data.list && data.list.list_items);
    if (Array.isArray(raw)) {
      // ok
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      raw = Object.keys(raw).map(function (k) { var r = raw[k]; return typeof r === 'object' && r !== null ? Object.assign({ id: k }, r) : { id: k, title: String(r) }; });
    } else {
      Logger.log('lists.records.list response keys: ' + Object.keys(data).join(', ') + (data.list ? '; list keys: ' + Object.keys(data.list).join(', ') : ''));
      raw = [];
    }
    var parentOnly = Array.isArray(raw) ? raw.filter(function (row) { return !row.parent_record_id; }) : [];
    if (parentOnly.length < (raw.length || 0)) {
      Logger.log('Internal list: ' + (raw.length || 0) + ' items total, ' + parentOnly.length + ' top-level (excluding subtasks)');
    }
    var rowsToMap = parentOnly.length ? parentOnly : (Array.isArray(raw) ? raw : []);
    var items = rowsToMap.map(function (row) {
      var requestText = row.fields ? pickRequestTextFromFields(row.fields) : '';
      if (!requestText) requestText = row.title || row.text || row.name || '';
      var assigneeOrCreatedBy = row.fields ? pickAssigneeFromFields(row.fields) : null;
      assigneeOrCreatedBy = assigneeOrCreatedBy || row.created_by || row.assignee_id || row.user_id;
      return {
        id: row.id,
        list_item_id: row.id,
        list_id: row.list_id || listId,
        date_created: row.date_created || row.created_at || row.created,
        created_at: row.date_created || row.created_at || row.created,
        created_by: row.created_by || row.assignee_id || row.user_id,
        user_id: assigneeOrCreatedBy,
        title: requestText,
        text: requestText,
        fields: row.fields,
        archived: row.archived,
        completed: row.completed || row.done,
        status: row.status
      };
    });
    Logger.log('lists.records.list returned ' + items.length + ' items');
    return { items: items, rawData: data };
  } catch (e) {
    Logger.log('tryListsRecordsList error: ' + e.toString());
    return { error: e.toString() };
  }
}

/**
 * If Status and Response columns were assigned by label/title but the content is clearly backwards,
 * swap them. Response can be any text (not just numbers 1-14); we only swap when BOTH columns
 * are clearly the wrong type: the one we called Status has mostly numeric 1-14, and the one we
 * called Response has mostly Opt IDs (status dropdown). If Response has free text we do not swap.
 * @param {Array} listItems - list rows with .fields
 * @param {Object} colIds - { status, response, ... }
 * @param {Object} indices - { status, response, ... }
 */
function disambiguateStatusAndResponseByValue(listItems, colIds, indices) {
  if (!listItems || listItems.length === 0 || !colIds || !colIds.status || !colIds.response || colIds.status === colIds.response) return;
  function cellVal(fields, colId) {
    if (!fields || !colId) return '';
    var cell = null;
    if (typeof fields[colId] !== 'undefined') cell = fields[colId];
    if (cell == null && Array.isArray(fields)) {
      var colIdStr = String(colId);
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f && (String(f.column_id || '') === colIdStr || String(f.key || '') === colIdStr)) { cell = f; break; }
      }
    }
    if (cell == null) return '';
    if (typeof cell === 'object' && cell.text != null && cell.text !== '') return String(cell.text).trim();
    if (typeof cell === 'object' && cell.value != null && cell.value !== '') return String(cell.value).trim();
    if (typeof cell === 'object' && cell.select && Array.isArray(cell.select) && cell.select[0] != null) return String(cell.select[0]).trim();
    return String(cell).trim();
  }
  function isNumericResponse(s) {
    if (!s || typeof s !== 'string') return false;
    var t = s.trim();
    return /^\d{1,4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t);
  }
  function isOptId(s) {
    return s && typeof s === 'string' && /^Opt[A-Za-z0-9]+$/.test(s.trim());
  }
  var first = listItems[0].fields || {};
  var statusRaw = cellVal(first, colIds.status);
  var responseRaw = cellVal(first, colIds.response);
  if (statusRaw && responseRaw && isNumericResponse(statusRaw) && isOptId(responseRaw)) {
    var sid = colIds.status, rid = colIds.response;
    colIds.status = rid;
    colIds.response = sid;
    var si = indices.status, ri = indices.response;
    indices.status = ri;
    indices.response = si;
    Logger.log('QA columns: swapped Status and Response (first row had number in Status column, Opt ID in Response column).');
    return;
  }
  var n = Math.min(listItems.length, 30);
  var statusNum = 0, statusOpt = 0, statusFilled = 0, responseNum = 0, responseOpt = 0, responseFilled = 0;
  for (var r = 0; r < n; r++) {
    var fields = listItems[r].fields || {};
    var sv = cellVal(fields, colIds.status);
    var rv = cellVal(fields, colIds.response);
    if (sv) { statusFilled++; if (isNumericResponse(sv)) statusNum++; else if (isOptId(sv)) statusOpt++; }
    if (rv) { responseFilled++; if (isNumericResponse(rv)) responseNum++; else if (isOptId(rv)) responseOpt++; }
  }
  var minRows = Math.max(3, Math.min(n, 5));
  var statusClearlyNumeric = statusFilled >= minRows && statusNum >= statusFilled * 0.3 && (statusOpt <= statusFilled * 0.3 || statusNum > statusOpt);
  var responseClearlyOpt = responseFilled >= minRows && responseOpt >= responseFilled * 0.3 && (responseNum <= responseFilled * 0.3 || responseOpt > responseNum);
  if (statusClearlyNumeric && responseClearlyOpt) {
    var sid = colIds.status, rid = colIds.response;
    colIds.status = rid;
    colIds.response = sid;
    var si = indices.status, ri = indices.response;
    indices.status = ri;
    indices.response = si;
    Logger.log('QA columns: swapped Status and Response (Resolved column had mostly numbers 1-14, Response column had mostly Opt IDs).');
  }
}

/**
 * When API gives no column definitions, detect QA columns by scanning cell values.
 * Response = column with 1,2,3...; Status = column with status option IDs; To = user IDs; Request = text; VM/ManagerCheck = Opt columns.
 * @param {Array} records - list rows with .fields
 * @param {string[]} columnIdsInOrder - column ids (e.g. from Object.keys(first.fields))
 * @returns {{ vm, request, status, to, response, managerCheck }|null} colIds by key, or null
 */
function detectQaColumnsByValue(records, columnIdsInOrder) {
  if (!columnIdsInOrder || columnIdsInOrder.length === 0 || !records || records.length === 0) return null;
  function cellVal(fields, colId) {
    if (!fields || !colId) return '';
    var cell = null;
    if (typeof fields[colId] !== 'undefined') cell = fields[colId];
    if (cell == null && Array.isArray(fields)) {
      var colIdStr = String(colId);
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f && (String(f.column_id || '') === colIdStr || String(f.key || '') === colIdStr)) { cell = f; break; }
      }
    }
    if (cell == null) return '';
    if (typeof cell === 'object' && cell.text != null && cell.text !== '') return String(cell.text).trim();
    if (typeof cell === 'object' && cell.value != null && cell.value !== '') return String(cell.value).trim();
    if (typeof cell === 'object' && cell.select && Array.isArray(cell.select) && cell.select[0] != null) return String(cell.select[0]).trim();
    if (typeof cell === 'object' && cell.user && (cell.user[0] || cell.user)) return String(cell.user[0] || cell.user).trim();
    if (typeof cell === 'object' && cell.channel && (cell.channel[0] || cell.channel)) return String(cell.channel[0] || cell.channel).trim();
    if (typeof cell === 'object' && (cell.number != null || typeof cell.value === 'number')) return String(cell.number != null ? (Array.isArray(cell.number) ? cell.number[0] : cell.number) : cell.value).trim();
    return String(cell).trim();
  }
  function isNumericResponse(s) {
    if (!s || typeof s !== 'string') return false;
    var t = s.trim();
    return /^\d{1,4}$/.test(t) && !/^\d{4}-\d{2}-\d{2}/.test(t);
  }
  var out = { vm: null, request: null, status: null, to: null, response: null, managerCheck: null };
  var responseCol = null;
  var responseScore = 0;
  var statusCol = null;
  var statusScore = 0;
  var toCol = null;
  var requestCol = null;
  var requestScore = -1;
  var optCols = [];
  var n = Math.min(records.length, 30);
  for (var c = 0; c < columnIdsInOrder.length; c++) {
    var colId = columnIdsInOrder[c];
    var numCount = 0;
    var statusCount = 0;
    var toCount = 0;
    var textLen = 0;
    var optCount = 0;
    var optUniques = {};
    for (var r = 0; r < n; r++) {
      var val = cellVal(records[r].fields, colId);
      if (!val) continue;
      if (isNumericResponse(val)) numCount++;
      if (typeof QA_STATUS_OPTION_IDS !== 'undefined' && QA_STATUS_OPTION_IDS[val]) statusCount++;
      if (/^U[A-Z0-9]{8,12}$/.test(val)) toCount++;
      if (val.length > 3 && !/^Opt[A-Za-z0-9]+$/.test(val) && !/^U[A-Z0-9]+$/.test(val)) textLen += val.length;
      if (/^Opt[A-Za-z0-9]+$/.test(val)) { optCount++; optUniques[val] = true; }
    }
    if (numCount > responseScore && numCount >= n * 0.5 && statusCount < n * 0.3) { responseScore = numCount; responseCol = colId; }
    if (statusCount > statusScore && statusCount >= n * 0.3 && numCount < n * 0.5) { statusScore = statusCount; statusCol = colId; }
    if (toCount >= n * 0.2) toCol = colId;
    if (textLen > requestScore && numCount === 0 && statusCount === 0) { requestScore = textLen; requestCol = colId; }
    if (optCount >= n * 0.3 && colId !== statusCol && colId !== responseCol) optCols.push({ id: colId, uniques: Object.keys(optUniques).length });
  }
  out.response = responseCol;
  out.status = statusCol;
  out.to = toCol;
  out.request = requestCol;
  optCols.sort(function (a, b) { return a.uniques - b.uniques; });
  if (optCols.length >= 2) {
    out.managerCheck = optCols[0].id;
    out.vm = optCols[1].id;
  } else if (optCols.length === 1) {
    out.vm = optCols[0].id;
  }
  if (out.response || out.status || out.request) return out;
  return null;
}

/**
 * From list API raw response, get column id and array index for each QA column (VM, Request, Status, To, Response, Manager Check).
 * So we read by column id when fields is object (no wrong order from sorted keys).
 *
 * When do we get Slack list field names?
 * - Only when the API response includes list schema: data.list.columns or data.list.column_definitions (each with id + title/label/name).
 * - That happens when using the internal API (lists.records.list with SLACK_COOKIE_TOKEN). The official API (slackLists.items.list) returns
 *   only items with row.fields keyed by column ID, no column definitions, so we cannot know which ID is "Request" vs "Response" from names.
 * - When we have columns: we match by title (e.g. "VM"/"Location" -> vm, "Request"/"QA Finding" -> request, "Resolved"/"Status" -> status,
 *   "To"/"Operator" -> to, "Response" -> response, "Manager Check"/"AM Verified" -> managerCheck). mappingMethod = 'title_from_api'.
 * - When we don't: we fall back to label on first row fields, or value-based guessing. mappingMethod = 'label' or 'value_fallback'.
 *
 * @param {Object} data - rawData from tryListsRecordsList (or undefined when only items were returned)
 * @returns {{ colIds: Object, indices: Object, columnIdsInOrder: string[], mappingMethod: string }}
 */
function getQaColumnMappingFromListResponse(data) {
  var colIds = { vm: null, request: null, status: null, to: null, response: null, managerCheck: null };
  var columnIdsInOrder = [];
  var orderFromApi = false;
  var mappingMethod = 'value_fallback';
  if (!data || typeof data !== 'object') return { colIds: colIds, indices: { vm: 1, request: 0, status: 2, to: 4, response: 5, managerCheck: 3 }, columnIdsInOrder: columnIdsInOrder, orderFromApi: false, mappingMethod: 'none' };
  var columns = (data.list && data.list.columns) || (data.list && data.list.column_definitions) || (data.view && data.view.columns) || data.columns || data.column_definitions || [];
  if (!Array.isArray(columns)) columns = [];
  var idToTitle = {};
  for (var cx = 0; cx < columns.length; cx++) {
    var col = columns[cx];
    if (col && typeof col === 'object') {
      var cid = (col.id != null ? col.id : col.key || col.column_id);
      if (cid) idToTitle[String(cid)] = (col.title || col.label || col.name || '').toString().trim();
    }
  }
  if (data.list && data.list.column_definitions && typeof data.list.column_definitions === 'object' && !Array.isArray(data.list.column_definitions)) {
    var defs = data.list.column_definitions;
    for (var kid in defs) { if (defs.hasOwnProperty(kid) && defs[kid] && typeof defs[kid] === 'object') { var d = defs[kid]; idToTitle[kid] = (d.title || d.label || d.name || idToTitle[kid] || '').toString().trim(); } }
  }
  if (Array.isArray(columns) && columns.length > 0) {
    orderFromApi = true;
    for (var ix = 0; ix < columns.length; ix++) {
      var col = columns[ix];
      var cid = col && (col.id != null ? col.id : col.key || col.column_id);
      if (cid) columnIdsInOrder.push(String(cid));
    }
  }
  if (columnIdsInOrder.length === 0) {
    var recs = data.records || data.items || (data.list && data.list.records) || (data.list && data.list.items) || [];
    var first = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
    if (first && first.fields) {
      if (Array.isArray(first.fields)) {
        for (var fi = 0; fi < first.fields.length; fi++) {
          var f = first.fields[fi];
          var cid = (f && (f.column_id != null ? f.column_id : f.key));
          columnIdsInOrder.push(cid != null ? String(cid) : String(fi));
        }
      } else if (typeof first.fields === 'object') {
        columnIdsInOrder = Object.keys(first.fields);
      }
    }
  }
  var records = data.records || data.items || (data.list && data.list.records) || (data.list && data.list.items) || [];
  if (!Array.isArray(records)) records = [];
  var indices = { vm: 0, request: 1, status: 2, to: 3, response: 7, managerCheck: 8 };
  if (columnIdsInOrder.length > 0 && !orderFromApi) {
    var first = records[0];
    if (first && first.fields) {
      var fieldsToUse = first.fields;
      if (Object.keys(idToTitle).length > 0 && typeof first.fields === 'object' && !Array.isArray(first.fields)) {
        fieldsToUse = {};
        for (var k in first.fields) {
          if (first.fields.hasOwnProperty(k)) {
            var cell = first.fields[k];
            var label = idToTitle[k] || '';
            if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
              fieldsToUse[k] = Object.assign({}, cell, { label: label || cell.label || cell.title || cell.name, key: k, column_id: k });
            } else {
              fieldsToUse[k] = { key: k, column_id: k, text: cell != null ? String(cell) : '', label: label };
            }
          }
        }
      }
      var byLabels = getQaColumnMappingByLabels(fieldsToUse);
      var hasAny = byLabels.colIds.request || byLabels.colIds.vm || byLabels.colIds.status || byLabels.colIds.to || byLabels.colIds.response || byLabels.colIds.managerCheck;
      if (hasAny) {
        colIds = byLabels.colIds;
        indices = byLabels.indices;
        if (byLabels.columnIdsInOrder && byLabels.columnIdsInOrder.length > 0) columnIdsInOrder = byLabels.columnIdsInOrder;
        return { colIds: colIds, indices: indices, columnIdsInOrder: columnIdsInOrder, orderFromApi: false, mappingMethod: 'label' };
      }
      var detected = detectQaColumnsByValue(records, columnIdsInOrder);
      if (detected) {
        colIds.vm = detected.vm;
        colIds.request = detected.request;
        colIds.status = detected.status;
        colIds.to = detected.to;
        colIds.response = detected.response;
        colIds.managerCheck = detected.managerCheck;
        for (var di = 0; di < columnIdsInOrder.length; di++) {
          var cid = columnIdsInOrder[di];
          if (cid === colIds.vm) indices.vm = di;
          if (cid === colIds.request) indices.request = di;
          if (cid === colIds.status) indices.status = di;
          if (cid === colIds.to) indices.to = di;
          if (cid === colIds.response) indices.response = di;
          if (cid === colIds.managerCheck) indices.managerCheck = di;
        }
        return { colIds: colIds, indices: indices, columnIdsInOrder: columnIdsInOrder, orderFromApi: false, mappingMethod: 'value_fallback' };
      }
    }
  }
  if (orderFromApi && columnIdsInOrder.length === 6) {
    indices = { vm: 1, request: 0, status: 2, to: 4, response: 5, managerCheck: 3 };
  }
  if (columnIdsInOrder.length === 0) return { colIds: colIds, indices: indices, columnIdsInOrder: columnIdsInOrder, orderFromApi: false, mappingMethod: 'none' };
  function titleMatches(col, keys) {
    var t = (col.title || col.label || col.name || '').toString().toLowerCase().trim();
    for (var k = 0; k < keys.length; k++) if (t.indexOf(keys[k]) !== -1 || keys[k].indexOf(t) !== -1) return true;
    return false;
  }
  function titleEquals(col, val) {
    var t = (col.title || col.label || col.name || '').toString().toLowerCase().trim();
    return t === val || t.trim() === val;
  }
  // App vs Slack: Location=VM, QA Finding/Request=Request, Resolved/Status=Status, To/Operator=To, Response=Response, Manager Check/AM Verified=Manager Check.
  // Match by title so the right data shows in the right table column. Prefer exact matches.
  for (var i = 0; i < columns.length; i++) {
    var c = columns[i];
    if (!c || typeof c !== 'object') continue;
    var id = (c.id != null ? c.id : c.key || c.column_id || '').toString();
    if (!id) continue;
    var t = (c.title || c.label || c.name || '').toString().toLowerCase().trim();
    if ((titleMatches(c, ['vm']) || titleMatches(c, ['location'])) && t.indexOf('manager') === -1) { colIds.vm = id; indices.vm = i; }
    else if (titleMatches(c, ['request']) || titleMatches(c, ['qa finding']) || titleMatches(c, ['finding']) || titleMatches(c, ['description']) || titleMatches(c, ['summary']) || titleMatches(c, ['item']) || (t === 'title' && t.indexOf('assigned') === -1)) { colIds.request = id; indices.request = i; }
    else if ((titleMatches(c, ['status']) || titleMatches(c, ['resolved']) || titleMatches(c, ['state'])) && t.indexOf('manager') === -1 && t.indexOf('response') === -1) { colIds.status = id; indices.status = i; }
    else if (titleEquals(c, 'to') || titleMatches(c, ['operator']) && t.indexOf('assign') === -1 && t.indexOf('by') === -1 || (t.indexOf('to') === 0 && t.indexOf('assign') === -1)) { colIds.to = id; indices.to = i; }
    else if ((t.indexOf('manager') !== -1 && t.indexOf('comment') === -1 && (t.indexOf('check') !== -1 || t.indexOf('verified') !== -1)) || titleMatches(c, ['am verified']) || t === 'am verified') { colIds.managerCheck = id; indices.managerCheck = i; }
  }
  for (var i2 = 0; i2 < columns.length; i2++) {
    var c2 = columns[i2];
    if (!c2) continue;
    var id2 = (c2.id != null ? c2.id : c2.key || c2.column_id || '').toString();
    var t2 = (c2.title || c2.label || c2.name || '').toString().toLowerCase();
    if (t2.indexOf('manager') !== -1 || t2.indexOf('needed') !== -1) continue;
    if (t2 === 'response' || (t2.indexOf('response') !== -1 && t2.indexOf('date') === -1)) {
      colIds.response = id2;
      indices.response = i2;
      break;
    }
  }
  return { colIds: colIds, indices: indices, columnIdsInOrder: columnIdsInOrder, orderFromApi: orderFromApi, mappingMethod: 'title_from_api' };
}

/**
 * Extract option ID → label map from lists.records.list raw response (when cookie token works).
 * Used to persist VM/Status etc. labels so they still display after token expires.
 * @param {Object} data - Raw response from lists.records.list
 * @returns {Object} Map of "Opt..." → "Label" (e.g. Opt0ADMCH9YDR → "#kfst")
 */
function extractOptionMapFromListResponse(data) {
  var map = {};
  if (!data || typeof data !== 'object') return map;
  function addOption(id, label) {
    if (id && /^Opt[A-Za-z0-9]+$/.test(String(id))) {
      var lbl = (label || id).toString().trim();
      if (lbl) map[String(id)] = lbl;
    }
  }
  function walkOptions(arr) {
    if (!Array.isArray(arr)) return;
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (o && typeof o === 'object') {
        if (o.id != null && (o.label != null || o.title != null || o.text != null))
          addOption(o.id, o.label || o.title || o.text);
        if (o.value != null && (o.label != null || o.text != null))
          addOption(o.value, o.label || o.text);
        if (Array.isArray(o.options)) walkOptions(o.options);
      }
    }
  }
  function walkColumns(cols) {
    if (!Array.isArray(cols)) return;
    for (var j = 0; j < cols.length; j++) {
      var col = cols[j];
      if (col && typeof col === 'object') {
        if (Array.isArray(col.options)) walkOptions(col.options);
        if (col.options && typeof col.options === 'object' && !Array.isArray(col.options))
          walkOptions([col.options]);
        // Slack schema: choices = [ { value, label, color } ]
        if (Array.isArray(col.choices)) {
          for (var c = 0; c < col.choices.length; c++) {
            var ch = col.choices[c];
            if (ch && typeof ch === 'object' && (ch.value != null || ch.id != null))
              addOption(ch.value != null ? ch.value : ch.id, ch.label || ch.text || ch.title);
          }
        }
      }
    }
  }
  var list = data.list || data.result || data;
  if (list && list.columns) walkColumns(list.columns);
  if (list && list.column_definitions) walkColumns(list.column_definitions);
  if (list && list.view && list.view.columns) walkColumns(list.view.columns);
  if (list && list.views && Array.isArray(list.views) && list.views[0] && list.views[0].columns) walkColumns(list.views[0].columns);
  if (data.columns) walkColumns(data.columns);
  if (data.column_definitions) walkColumns(data.column_definitions);
  if (data.view && data.view.columns) walkColumns(data.view.columns);
  // Records may have field definitions with options (some internal API shapes)
  var records = data.records || data.items || (list && list.records) || (list && list.items) || [];
  if (!Array.isArray(records) && records && typeof records === 'object') records = Object.values(records);
  if (Array.isArray(records)) {
    for (var r = 0; r < Math.min(records.length, 50); r++) {
      var rec = records[r];
      if (!rec || !rec.fields) continue;
      var farr = Array.isArray(rec.fields) ? rec.fields : (rec.fields && rec.fields.values ? rec.fields.values : Object.values(rec.fields || {}));
      for (var f = 0; f < (farr && farr.length) || 0; f++) {
        var field = farr[f];
        if (field && typeof field === 'object' && (Array.isArray(field.options) || field.select_options)) {
          walkOptions(Array.isArray(field.options) ? field.options : (field.select_options || []));
        }
      }
    }
  }
  return map;
}

/**
 * Collect unique option IDs (Opt...) from lists.records.list response (records only; no schema).
 * Used when pasted response has no list.columns/options so we can tell the user which IDs to map.
 * @param {Object} data - Raw response from lists.records.list
 * @returns {Array<string>} Sorted unique Opt IDs
 */
function collectOptIdsFromListRecordsResponse(data) {
  var seen = {};
  var records = data.records || data.items || (data.list && data.list.records) || (data.list && data.list.items) || [];
  if (!Array.isArray(records)) records = records && typeof records === 'object' ? Object.values(records) : [];
  for (var r = 0; r < records.length; r++) {
    var rec = records[r];
    if (!rec || !rec.fields) continue;
    var farr = Array.isArray(rec.fields) ? rec.fields : Object.values(rec.fields || {});
    for (var f = 0; f < farr.length; f++) {
      var field = farr[f];
      if (!field || typeof field !== 'object') continue;
      var val = field.value != null ? field.value : (field.select && field.select[0]);
      if (val && /^Opt[A-Za-z0-9]+$/.test(String(val))) seen[String(val)] = true;
      if (Array.isArray(field.select)) for (var s = 0; s < field.select.length; s++) { if (/^Opt[A-Za-z0-9]+$/.test(String(field.select[s]))) seen[String(field.select[s])] = true; }
    }
  }
  return Object.keys(seen).sort();
}

/**
 * Extract list columns (id + title) from a list API response for QA column mapping.
 * @param {Object} data - Response from lists.get, lists.view, or lists.records.list
 * @returns {Array<{id: string, title: string, key?: string, label?: string, name?: string}>}
 */
function extractListColumnsFromResponse(data) {
  var out = [];
  if (!data || typeof data !== 'object') return out;
  var list = data.list || data.result || data;
  function addCol(col) {
    if (!col || typeof col !== 'object') return;
    var id = (col.id != null ? col.id : col.key || col.column_id || '').toString();
    if (!id) return;
    var title = (col.title || col.label || col.name || '').toString().trim();
    out.push({ id: id, key: id, title: title, label: title, name: title });
  }
  var cols = (list && list.columns) || (list && list.column_definitions);
  if (Array.isArray(cols)) {
    for (var i = 0; i < cols.length; i++) addCol(cols[i]);
  } else if (list && list.column_definitions && typeof list.column_definitions === 'object' && !Array.isArray(list.column_definitions)) {
    for (var k in list.column_definitions) {
      if (list.column_definitions.hasOwnProperty(k)) addCol(Object.assign({ id: k, key: k }, list.column_definitions[k]));
    }
  }
  if (data.view && data.view.columns && Array.isArray(data.view.columns)) {
    for (var j = 0; j < data.view.columns.length; j++) addCol(data.view.columns[j]);
  }
  if (data.columns && Array.isArray(data.columns)) {
    for (var c = 0; c < data.columns.length; c++) addCol(data.columns[c]);
  }
  return out;
}

/**
 * Fetch list column definitions (id + title) from Slack internal API so we can map by Slack field names
 * even when lists.records.list didn't return list.columns. Uses SLACK_COOKIE_TOKEN.
 * @param {string} listId - List ID
 * @returns {Array<{id: string, title: string}>} Non-empty only if we got columns
 */
function tryFetchListColumnsWithCookie(listId) {
  var host = getSlackWorkspaceHost();
  var cookieToken = (function () {
    try {
      var t = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_TOKEN');
      return (t && t.trim() && t.trim().indexOf('xoxc-') === 0) ? t.trim() : null;
    } catch (e) { return null; }
  })();
  if (!cookieToken) return [];
  var cookieHeader = (function () {
    try {
      var h = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_HEADER');
      return (h && h.trim()) ? h.trim() : null;
    } catch (e) { return null; }
  })();
  var baseUrl = 'https://' + host + '/api/';
  var endpoints = [
    { method: 'get', url: baseUrl + 'lists.get?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'lists.view?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'lists.info?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'client.lists.get?list_id=' + encodeURIComponent(listId) }
  ];
  for (var i = 0; i < endpoints.length; i++) {
    try {
      var headers = {
        'Accept': '*/*',
        'Origin': 'https://app.slack.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
      };
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      var response = UrlFetchApp.fetch(endpoints[i].url, { method: endpoints[i].method, headers: headers, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) continue;
      var data;
      try {
        data = JSON.parse(response.getContentText());
      } catch (e) { continue; }
      if (data && data.ok === false && data.error) continue;
      var columns = extractListColumnsFromResponse(data);
      if (columns.length > 0) {
        Logger.log('List columns from ' + endpoints[i].url.split('?')[0] + ': ' + columns.length + ' columns');
        return columns;
      }
    } catch (e) {
      Logger.log('tryFetchListColumns ' + endpoints[i].url + ': ' + e.toString());
    }
  }
  try {
    var boundary = '----FormBoundary' + Math.random().toString(36).substring(2, 18);
    var crlf = '\r\n';
    var parts = [
      '--' + boundary,
      'Content-Disposition: form-data; name="token"' + crlf + crlf + cookieToken,
      '--' + boundary,
      'Content-Disposition: form-data; name="list_id"' + crlf + crlf + listId,
      '--' + boundary + '--'
    ];
    var postHeaders = {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Accept': '*/*',
      'Origin': 'https://app.slack.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
    };
    if (cookieHeader) postHeaders['Cookie'] = cookieHeader;
    var postResponse = UrlFetchApp.fetch(baseUrl + 'lists.get', {
      method: 'post',
      headers: postHeaders,
      payload: parts.join(crlf),
      muteHttpExceptions: true
    });
    if (postResponse.getResponseCode() === 200) {
      var postData = JSON.parse(postResponse.getContentText());
      if (postData && !(postData.ok === false && postData.error)) {
        var postCols = extractListColumnsFromResponse(postData);
        if (postCols.length > 0) {
          Logger.log('List columns from POST lists.get: ' + postCols.length);
          return postCols;
        }
      }
    }
  } catch (e) {
    Logger.log('tryFetchListColumns POST lists.get: ' + e.toString());
  }
  return [];
}

/**
 * Try to fetch list schema (column options with labels) from Slack internal APIs using the same
 * Cookie as the browser, so we get Opt ID → label mapping the same way the UI does.
 * @param {string} listId - List ID (e.g. F0ADKKPCB5L)
 * @returns {Object} Map of "Opt..." → "Label" or {} if not found
 */
function tryFetchListSchemaWithCookie(listId) {
  var host = getSlackWorkspaceHost();
  var cookieToken = (function () {
    try {
      var t = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_TOKEN');
      return (t && t.trim() && t.trim().indexOf('xoxc-') === 0) ? t.trim() : null;
    } catch (e) { return null; }
  })();
  if (!cookieToken) return {};
  var cookieHeader = (function () {
    try {
      var h = PropertiesService.getScriptProperties().getProperty('SLACK_COOKIE_HEADER');
      return (h && h.trim()) ? h.trim() : null;
    } catch (e) { return null; }
  })();

  var baseUrl = 'https://' + host + '/api/';
  var endpoints = [
    { method: 'get', url: baseUrl + 'lists.get?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'lists.view?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'lists.info?list_id=' + encodeURIComponent(listId) },
    { method: 'get', url: baseUrl + 'client.lists.get?list_id=' + encodeURIComponent(listId) }
  ];

  for (var i = 0; i < endpoints.length; i++) {
    try {
      var headers = {
        'Accept': '*/*',
        'Origin': 'https://app.slack.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
      };
      if (cookieHeader) headers['Cookie'] = cookieHeader;
      var options = { method: endpoints[i].method, headers: headers, muteHttpExceptions: true };
      var response = UrlFetchApp.fetch(endpoints[i].url, options);
      var code = response.getResponseCode();
      var text = response.getContentText();
      if (code !== 200) continue;
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) { continue; }
      if (data && data.ok === false && data.error) continue;
      var map = extractOptionMapFromListResponse(data);
      if (Object.keys(map).length > 0) {
        Logger.log('List schema (option labels) from ' + endpoints[i].url.split('?')[0] + ': ' + Object.keys(map).length + ' options');
        return map;
      }
    } catch (e) {
      Logger.log('tryFetchListSchema ' + endpoints[i].url + ': ' + e.toString());
    }
  }

  // POST lists.get with same form as lists.records.list
  try {
    var boundary = '----FormBoundary' + Math.random().toString(36).substring(2, 18);
    var crlf = '\r\n';
    var parts = [
      '--' + boundary,
      'Content-Disposition: form-data; name="token"' + crlf + crlf + cookieToken,
      '--' + boundary,
      'Content-Disposition: form-data; name="list_id"' + crlf + crlf + listId,
      '--' + boundary + '--'
    ];
    var payload = parts.join(crlf);
    var postHeaders = {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Accept': '*/*',
      'Origin': 'https://app.slack.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
    };
    if (cookieHeader) postHeaders['Cookie'] = cookieHeader;
    var postResponse = UrlFetchApp.fetch(baseUrl + 'lists.get', {
      method: 'post',
      headers: postHeaders,
      payload: payload,
      muteHttpExceptions: true
    });
    if (postResponse.getResponseCode() === 200) {
      var postData = JSON.parse(postResponse.getContentText());
      if (postData && !(postData.ok === false && postData.error)) {
        var postMap = extractOptionMapFromListResponse(postData);
        if (Object.keys(postMap).length > 0) {
          Logger.log('List schema from POST lists.get: ' + Object.keys(postMap).length + ' options');
          return postMap;
        }
      }
    }
  } catch (e) {
    Logger.log('tryFetchListSchema POST lists.get: ' + e.toString());
  }
  return {};
}

/**
 * Get Slack token for official API. Prefer User token (xoxp-) for Lists – user tokens
 * see lists the user can see; bot tokens often get list_not_found until list access is granted.
 * @returns {Object} Token object with {token, type} or null
 */
function getSlackToken() {
  try {
    const props = PropertiesService.getScriptProperties();
    // User token first: long-lived and usually sees user-visible lists with lists:read
    let token = props.getProperty('SLACK_USER_TOKEN');
    if (token && token.trim()) {
      Logger.log('Using SLACK_USER_TOKEN from PropertiesService');
      return { token: token.trim(), type: 'user' };
    }
    token = props.getProperty('SLACK_BOT_TOKEN');
    if (token && token.trim()) {
      Logger.log('Using SLACK_BOT_TOKEN from PropertiesService');
      return { token: token.trim(), type: 'bot' };
    }
    token = props.getProperty('SLACK_COOKIE_TOKEN');
    if (token && token.trim()) {
      Logger.log('Using SLACK_COOKIE_TOKEN from PropertiesService');
      return { token: token.trim(), type: 'cookie' };
    }
    Logger.log('No Slack token found. For Lists use SLACK_USER_TOKEN (xoxp-) with lists:read, or SLACK_BOT_TOKEN.');
    return null;
  } catch (error) {
    Logger.log('Error getting Slack token: ' + error.toString());
    return null;
  }
}

/**
 * Get the other OAuth token (user or bot) when one returns list_not_found.
 * @returns {Object|null} { token, type } or null
 */
function getOtherSlackOAuthToken(usedType) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (usedType !== 'user') {
      const t = props.getProperty('SLACK_USER_TOKEN');
      if (t && t.trim()) return { token: t.trim(), type: 'user' };
    }
    if (usedType !== 'bot') {
      const t = props.getProperty('SLACK_BOT_TOKEN');
      if (t && t.trim()) return { token: t.trim(), type: 'bot' };
    }
    return null;
  } catch (e) { return null; }
}

/**
 * Try accessing list through conversations API
 * @param {string} listId - List ID
 * @param {string} token - Slack token
 * @returns {Array} Array of items or empty array
 */
function tryConversationsAPI(listId, token) {
  try {
    const url = `${SLACK_API_BASE}/conversations.history?channel=${listId}&limit=200`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      if (data.ok && data.messages) {
        Logger.log(`Conversations API: Found ${data.messages.length} messages`);
        return data.messages;
      } else if (data.error) {
        Logger.log(`Conversations API error: ${data.error}`);
        if (data.needed) {
          Logger.log(`Required scopes: ${data.needed.join(', ')}`);
        }
      }
    }
    return [];
  } catch (e) {
    Logger.log('Error in conversations API: ' + e.toString());
    return [];
  }
}

/**
 * Try accessing list through files API
 * @param {string} listId - List ID
 * @param {string} token - Slack token
 * @returns {Array} Array of items or empty array
 */
function tryFilesAPI(listId, token) {
  try {
    const url = `${SLACK_API_BASE}/files.list?limit=200`;
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      if (data.ok && data.files) {
        // Filter files related to our list
        const listFiles = data.files.filter(f => 
          f.channels && f.channels.includes(listId) ||
          f.groups && f.groups.includes(listId) ||
          f.title && f.title.toLowerCase().includes('staff request')
        );
        if (listFiles.length > 0) {
          Logger.log(`Files API: Found ${listFiles.length} related files`);
          return listFiles;
        }
      }
    }
    return [];
  } catch (e) {
    Logger.log('Error in files API: ' + e.toString());
    return [];
  }
}

/**
 * Try accessing Slack's Web Client API endpoints
 * These are the internal APIs the Slack web app uses
 * @param {string} listId - List ID
 * @param {string} cookieToken - Cookie token
 * @returns {Array} Array of items or empty array
 */
function tryWebClientAPI(listId, cookieToken) {
  try {
    // These are endpoints the Slack web client might use
    const endpoints = [
      // Try different Web Client API patterns
      `https://leet-wru5565.slack.com/api/client.lists.get?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      `https://leet-wru5565.slack.com/api/client.lists.items?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      `https://app.slack.com/api/client.lists.get?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      `https://app.slack.com/api/client.lists.items?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      // Try without client prefix
      `https://leet-wru5565.slack.com/api/lists.get?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      `https://leet-wru5565.slack.com/api/lists.items?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
      // Try with different parameter formats
      `https://leet-wru5565.slack.com/api/client.lists.get?list=${listId}`,
      `https://leet-wru5565.slack.com/api/client.lists.items?list=${listId}`
    ];
    
    for (let endpoint of endpoints) {
      try {
        const options = {
          method: 'get',
          headers: {
            'Cookie': `d=${cookieToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'X-Slack-User': 'U099R9US3QW'
          },
          muteHttpExceptions: true
        };
        
        Logger.log(`Trying Web Client API: ${endpoint}`);
        const response = UrlFetchApp.fetch(endpoint, options);
        
        if (response.getResponseCode() === 200) {
          const responseText = response.getContentText();
          Logger.log(`Web Client API response (first 1000 chars): ${responseText.substring(0, 1000)}`);
          
          try {
            const data = JSON.parse(responseText);
            if (data.ok !== false) {
              // Try different response structures
              if (data.list && data.list.items && Array.isArray(data.list.items)) {
                Logger.log(`Found ${data.list.items.length} items in list object`);
                return data.list.items;
              }
              if (data.items && Array.isArray(data.items)) {
                Logger.log(`Found ${data.items.length} items in items array`);
                return data.items;
              }
              if (data.result && Array.isArray(data.result)) {
                Logger.log(`Found ${data.result.length} items in result`);
                return data.result;
              }
              if (data.data && data.data.items && Array.isArray(data.data.items)) {
                Logger.log(`Found ${data.data.items.length} items in data.items`);
                return data.data.items;
              }
              // Log full response for debugging
              Logger.log(`Web Client API response structure: ${JSON.stringify(data).substring(0, 1000)}`);
            } else if (data.error) {
              Logger.log(`Web Client API error: ${data.error}`);
            }
          } catch (e) {
            Logger.log(`Error parsing Web Client API response: ${e.toString()}`);
          }
        } else {
          Logger.log(`Web Client API HTTP ${response.getResponseCode()}`);
        }
      } catch (e) {
        Logger.log(`Error trying Web Client API endpoint: ${e.toString()}`);
      }
    }
    
    return [];
  } catch (error) {
    Logger.log('Error in Web Client API access: ' + error.toString());
    return [];
  }
}

/**
 * Try fetching the list page HTML and parsing embedded JSON data
 * Since Lists don't have a public API, we scrape the web page
 * @param {string} listId - List ID
 * @param {string} token - Slack token
 * @param {string} tokenType - Token type (bot, user, cookie)
 * @returns {Array} Array of items or empty array
 */
function tryFetchListPageHTML(listId, token, tokenType) {
  try {
    // Fetch the actual list page
    const listPageUrl = `https://leet-wru5565.slack.com/lists/${SLACK_WORKSPACE_ID}/${listId}`;
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://leet-wru5565.slack.com/'
    };
    
    // Use cookie authentication for cookie tokens, Bearer for others
    if (tokenType === 'cookie') {
      headers['Cookie'] = `d=${token}`;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const options = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
      followRedirects: true
    };
    
    let response = UrlFetchApp.fetch(listPageUrl, options);
    Logger.log(`List page HTML fetch (initial): ${response.getResponseCode()}`);
    
    // Check if we got redirected - look for redirect in response
    const responseText = response.getContentText();
    const redirectMatch = responseText.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
    
    if (redirectMatch) {
      let redirectUrl = redirectMatch[1];
      // Remove escape sequences first
      redirectUrl = redirectUrl.replace(/\\\//g, '/').replace(/\\?/g, '?').replace(/\\&/g, '&').replace(/\\=/g, '=');
      
      Logger.log(`Found redirect (raw): ${redirectUrl}`);
      
      // Extract the redir parameter value and decode it
      // The redirect is like: "/?redir=%2Flists%2F..." or "?redir=%2Flists%2F..."
      const redirParamMatch = redirectUrl.match(/[?&]redir[=:]([^"'\s&]+)/);
      if (redirParamMatch) {
        try {
          const redirValue = redirParamMatch[1];
          Logger.log(`Extracted redir parameter: ${redirValue}`);
          
          // Decode the URL-encoded path
          const decodedPath = decodeURIComponent(redirValue);
          Logger.log(`Decoded redirect path: ${decodedPath}`);
          
          // Construct the actual list URL
          const actualListUrl = 'https://leet-wru5565.slack.com' + decodedPath;
          Logger.log(`Fetching actual list URL: ${actualListUrl}`);
          
          response = UrlFetchApp.fetch(actualListUrl, options);
          Logger.log(`Actual list URL fetch: ${response.getResponseCode()}`);
        } catch (e) {
          Logger.log(`Error processing redirect parameter: ${e.toString()}`);
          // Fall back to trying the redirect URL as-is
          let fullRedirectUrl = redirectUrl;
          if (redirectUrl.startsWith('/')) {
            fullRedirectUrl = 'https://leet-wru5565.slack.com' + redirectUrl;
          } else if (redirectUrl.startsWith('?')) {
            fullRedirectUrl = 'https://leet-wru5565.slack.com/' + redirectUrl;
          }
          Logger.log(`Trying redirect URL as-is: ${fullRedirectUrl}`);
          try {
            response = UrlFetchApp.fetch(fullRedirectUrl, options);
            Logger.log(`Redirected page fetch: ${response.getResponseCode()}`);
          } catch (e2) {
            Logger.log(`Error fetching redirect URL: ${e2.toString()}`);
          }
        }
      } else {
        // No redir parameter found, try the redirect URL directly
        let fullRedirectUrl = redirectUrl;
        if (redirectUrl.startsWith('/')) {
          fullRedirectUrl = 'https://leet-wru5565.slack.com' + redirectUrl;
        } else if (redirectUrl.startsWith('?')) {
          fullRedirectUrl = 'https://leet-wru5565.slack.com/' + redirectUrl;
        } else if (!redirectUrl.startsWith('http')) {
          fullRedirectUrl = 'https://leet-wru5565.slack.com/' + redirectUrl;
        }
        Logger.log(`No redir param, trying redirect URL: ${fullRedirectUrl}`);
        try {
          response = UrlFetchApp.fetch(fullRedirectUrl, options);
          Logger.log(`Redirected page fetch: ${response.getResponseCode()}`);
        } catch (e) {
          Logger.log(`Error fetching redirect: ${e.toString()}`);
        }
      }
    }
    
    if (response.getResponseCode() === 200) {
      let html = response.getContentText();
      Logger.log(`HTML length: ${html.length} characters`);
      
      // If we still have a redirect in the HTML, try to extract the actual list URL from the redirect
      if (html.includes('window.location.href') && html.includes('redir')) {
        // Try to extract the actual list URL from the redirect parameter
        const redirMatch = html.match(/redir[=%]([^"'\s&]+)/);
        if (redirMatch) {
          try {
            const decodedRedir = decodeURIComponent(redirMatch[1]);
            Logger.log(`Extracted redirect path: ${decodedRedir}`);
            // The redirect might be to the actual list page
            if (decodedRedir.includes('/lists/')) {
              const listUrl = 'https://leet-wru5565.slack.com' + decodedRedir;
              Logger.log(`Trying to fetch list URL directly: ${listUrl}`);
              try {
                const listResponse = UrlFetchApp.fetch(listUrl, options);
                if (listResponse.getResponseCode() === 200) {
                  html = listResponse.getContentText();
                  Logger.log(`Direct list URL fetch successful, HTML length: ${html.length}`);
                  
                  // Check if this page also redirects
                  if (html.includes('window.location.href')) {
                    Logger.log(`List page also contains redirect, may need authentication`);
                  }
                }
              } catch (e) {
                Logger.log(`Error fetching direct list URL: ${e.toString()}`);
              }
            }
          } catch (e) {
            Logger.log(`Error processing redirect: ${e.toString()}`);
          }
        }
      }
      
      // Try accessing the list page with the list_id and team_id as query parameters
      // This might be the format Slack expects
      const listUrlWithParams = `https://leet-wru5565.slack.com/lists/${SLACK_WORKSPACE_ID}/${listId}?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`;
      Logger.log(`Trying list URL with params: ${listUrlWithParams}`);
      try {
        const paramResponse = UrlFetchApp.fetch(listUrlWithParams, options);
        if (paramResponse.getResponseCode() === 200) {
          const paramHtml = paramResponse.getContentText();
          Logger.log(`List URL with params fetch: ${paramHtml.length} chars`);
          
          // If this HTML is different/better, use it
          if (paramHtml.length > html.length || (!html.includes(listId) && paramHtml.includes(listId))) {
            html = paramHtml;
            Logger.log(`Using HTML from parameterized URL`);
          }
        }
      } catch (e) {
        Logger.log(`Error fetching parameterized list URL: ${e.toString()}`);
      }
      
      // Try accessing Slack's internal API that the web client uses
      // The web client might use different endpoints
      if (tokenType === 'cookie') {
        const internalApiEndpoints = [
          `https://leet-wru5565.slack.com/api/client.lists.get?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
          `https://leet-wru5565.slack.com/api/client.lists.items?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
          `https://app.slack.com/api/client.lists.get?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`,
          `https://app.slack.com/api/client.lists.items?list_id=${listId}&team_id=${SLACK_WORKSPACE_ID}`
        ];
        
        for (let endpoint of internalApiEndpoints) {
          try {
            Logger.log(`Trying internal API endpoint: ${endpoint}`);
            const apiResponse = UrlFetchApp.fetch(endpoint, options);
            if (apiResponse.getResponseCode() === 200) {
              const apiText = apiResponse.getContentText();
              Logger.log(`Internal API response (first 500 chars): ${apiText.substring(0, 500)}`);
              
              try {
                const apiData = JSON.parse(apiText);
                if (apiData.ok && apiData.list) {
                  if (apiData.list.items && Array.isArray(apiData.list.items)) {
                    Logger.log(`Found ${apiData.list.items.length} items via internal API`);
                    return apiData.list.items;
                  }
                }
                if (apiData.ok && apiData.items && Array.isArray(apiData.items)) {
                  Logger.log(`Found ${apiData.items.length} items via internal API`);
                  return apiData.items;
                }
              } catch (e) {
                Logger.log(`Error parsing internal API response: ${e.toString()}`);
              }
            }
          } catch (e) {
            Logger.log(`Error trying internal API endpoint: ${e.toString()}`);
          }
        }
      }
      
      // Try to find embedded JSON data in the HTML
      // Look for common patterns: window.__INITIAL_STATE__, window.boot_data, etc.
      const jsonPatterns = [
        /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
        /window\.boot_data\s*=\s*({.+?});/s,
        /window\.SLACK_ENV\s*=\s*({.+?});/s,
        /window\.teams\s*=\s*({.+?});/s,
        /"lists"\s*:\s*({.+?})/s,
        /"listItems"\s*:\s*(\[.+?\])/s,
        /"items"\s*:\s*(\[.+?\])/s,
        new RegExp((listId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\\s]*:\\s*({.+?})', 's')  // Direct list ID match
      ];
      
      for (let i = 0; i < jsonPatterns.length; i++) {
        const pattern = jsonPatterns[i];
        const match = html.match(pattern);
        if (match) {
          try {
            const jsonData = JSON.parse(match[1]);
            Logger.log(`Found JSON data with pattern ${i}, type: ${typeof jsonData}, keys: ${typeof jsonData === 'object' && jsonData ? Object.keys(jsonData).slice(0, 10).join(', ') : 'N/A'}`);
            
            // Try to extract list items from the JSON structure
            const items = extractListItemsFromJSON(jsonData, listId);
            if (items && items.length > 0) {
              Logger.log(`Extracted ${items.length} items from JSON`);
              return items;
            }
          } catch (e) {
            Logger.log(`Error parsing JSON from pattern ${i}: ${e.toString()}`);
          }
        }
      }
      
      // Try to find the list ID directly in the HTML
      const listIdMatches = html.match(new RegExp(`"${listId}"[^}]*\\{[^}]*"items"[^}]*\\[([^\\]]+)\\]`, 's'));
      if (listIdMatches) {
        Logger.log(`Found list ID directly in HTML`);
        try {
          const itemsJson = '[' + listIdMatches[1] + ']';
          const items = JSON.parse(itemsJson);
          if (Array.isArray(items) && items.length > 0) {
            Logger.log(`Found ${items.length} items near list ID`);
            return items;
          }
        } catch (e) {
          Logger.log(`Error parsing items near list ID: ${e.toString()}`);
        }
      }
      
      // Try to find all script tags and search for list data
      const scriptTagPattern = /<script[^>]*id="boot"[^>]*>(.*?)<\/script>/s;
      const bootScriptMatch = html.match(scriptTagPattern);
      if (bootScriptMatch) {
        Logger.log(`Found boot script tag`);
        const bootScript = bootScriptMatch[1];
        
        // Look for list data in boot script
        const listDataPatterns = [
          new RegExp(`"${listId}"[^}]*\\{[^}]*"items"[^}]*\\[([^\\]]+)\\]`, 's'),
          /"items"\s*:\s*(\[.+?\])/s,
          /"listItems"\s*:\s*(\[.+?\])/s
        ];
        
        for (let pattern of listDataPatterns) {
          const match = bootScript.match(pattern);
          if (match) {
            try {
              const items = JSON.parse(match[1]);
              if (Array.isArray(items) && items.length > 0) {
                Logger.log(`Found ${items.length} items in boot script`);
                return items;
              }
            } catch (e) {
              Logger.log(`Error parsing items from boot script: ${e.toString()}`);
            }
          }
        }
      }
      
      // Search all script tags for JSON data - focus on the ones that contain the list ID
      const allScriptMatches = html.matchAll(/<script[^>]*>(.*?)<\/script>/gs);
      let scriptCount = 0;
      const scriptsWithListId = [];
      
      for (let match of allScriptMatches) {
        scriptCount++;
        const scriptContent = match[1];
        
        // Look for the list ID in this script
        if (scriptContent.includes(listId)) {
          Logger.log(`Found list ID in script tag ${scriptCount}, length: ${scriptContent.length}`);
          scriptsWithListId.push({ index: scriptCount, content: scriptContent });
          
          // Log a sample of the script content around the list ID
          const listIdPos = scriptContent.indexOf(listId);
          if (listIdPos !== -1) {
            const sampleStart = Math.max(0, listIdPos - 200);
            const sampleEnd = Math.min(scriptContent.length, listIdPos + 1000);
            Logger.log(`Script ${scriptCount} context around list ID: ${scriptContent.substring(sampleStart, sampleEnd)}`);
          }
          
          // Try multiple extraction patterns
          const extractionPatterns = [
            // Pattern 1: Direct list object with items
            new RegExp(`"${listId}"\\s*:\\s*({[^}]*"items"\\s*:\\s*\\[[^\\]]+\\][^}]*})`, 's'),
            // Pattern 2: Items array directly after list ID
            new RegExp(`"${listId}"[^}]*"items"\\s*:\\s*(\\[[^\\]]+\\])`, 's'),
            // Pattern 3: List ID as key in a larger object
            new RegExp(`"${listId}"\\s*:\\s*({[^}]+})`, 's'),
            // Pattern 4: Look for listItems or items near the list ID
            new RegExp(`"${listId}"[^}]*"listItems"\\s*:\\s*(\\[[^\\]]+\\])`, 's'),
            // Pattern 5: Any array after the list ID
            new RegExp(`"${listId}"[^}]*\\[([^\\]]+)\\]`, 's')
          ];
          
          for (let i = 0; i < extractionPatterns.length; i++) {
            const pattern = extractionPatterns[i];
            const match = scriptContent.match(pattern);
            if (match) {
              Logger.log(`Script ${scriptCount}, pattern ${i} matched: ${match[0].substring(0, 200)}`);
              try {
                // Try to parse the matched content
                let parsed;
                if (match[1] && match[1].startsWith('{')) {
                  // It's an object, wrap it properly
                  parsed = JSON.parse('{' + `"${listId}":${match[1]}` + '}');
                  if (parsed[listId] && parsed[listId].items) {
                    Logger.log(`Found ${parsed[listId].items.length} items in pattern ${i}`);
                    return parsed[listId].items;
                  }
                } else if (match[1] && match[1].startsWith('[')) {
                  // It's an array
                  parsed = JSON.parse(match[1]);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    Logger.log(`Found ${parsed.length} items array in pattern ${i}`);
                    return parsed;
                  }
                }
              } catch (e) {
                Logger.log(`Error parsing pattern ${i} from script ${scriptCount}: ${e.toString()}`);
              }
            }
          }
        }
      }
      
      Logger.log(`Searched ${scriptCount} script tags, found list ID in ${scriptsWithListId.length} scripts`);
      
      // If we found scripts with the list ID but couldn't extract, log the full content of smaller scripts
      if (scriptsWithListId.length > 0) {
        for (let script of scriptsWithListId) {
          if (script.content.length < 10000) {
            Logger.log(`Full content of script ${script.index} (${script.content.length} chars): ${script.content}`);
          } else {
            Logger.log(`Script ${script.index} is too large (${script.content.length} chars), logging first 5000: ${script.content.substring(0, 5000)}`);
          }
        }
      }
      
      // Try to find any JSON data in the entire HTML that might contain list information
      // Look for large JSON objects that might be the app state
      const largeJsonMatches = html.match(/\{[^{}]{500,}\}/g);
      if (largeJsonMatches) {
        Logger.log(`Found ${largeJsonMatches.length} potential large JSON objects in HTML`);
        for (let i = 0; i < Math.min(largeJsonMatches.length, 5); i++) {
          try {
            const jsonObj = JSON.parse(largeJsonMatches[i]);
            const items = extractListItemsFromJSON(jsonObj, listId);
            if (items && items.length > 0) {
              Logger.log(`Found ${items.length} items in large JSON object ${i}`);
              return items;
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
      
      // Log a sample of HTML sections that might contain data
      const dataSectionMatches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>(.*?)<\/script>/gs);
      if (dataSectionMatches) {
        Logger.log(`Found ${dataSectionMatches.length} JSON-LD or JSON script tags`);
        for (let match of dataSectionMatches) {
          try {
            const jsonContent = match.match(/>(.*?)</);
            if (jsonContent && jsonContent[1]) {
              const jsonData = JSON.parse(jsonContent[1]);
              const items = extractListItemsFromJSON(jsonData, listId);
              if (items && items.length > 0) {
                Logger.log(`Found ${items.length} items in JSON script tag`);
                return items;
              }
            }
          } catch (e) {
            Logger.log(`Error parsing JSON script tag: ${e.toString()}`);
          }
        }
      }
      
      // Log sections of HTML that might contain the data
      const listIdIndex = html.indexOf(listId);
      if (listIdIndex !== -1) {
        const contextStart = Math.max(0, listIdIndex - 500);
        const contextEnd = Math.min(html.length, listIdIndex + 2000);
        Logger.log(`HTML context around list ID (chars ${contextStart}-${contextEnd}): ${html.substring(contextStart, contextEnd)}`);
      }
    }
    
    return [];
  } catch (error) {
    Logger.log('Error fetching list page HTML: ' + error.toString());
    return [];
  }
}

/**
 * Extract list items from parsed JSON data
 * @param {Object} jsonData - Parsed JSON object
 * @param {string} listId - List ID to find
 * @returns {Array} Array of list items
 */
function extractListItemsFromJSON(jsonData, listId) {
  try {
    // Try different possible structures
    const paths = [
      ['lists', listId, 'items'],
      ['lists', listId, 'data', 'items'],
      ['listItems', listId],
      ['items'],
      ['data', 'items'],
      ['result', 'items'],
      ['list', 'items'],
      ['lists', listId],
      ['entities', 'lists', listId, 'items']
    ];
    
    for (let path of paths) {
      let current = jsonData;
      let found = true;
      
      for (let key of path) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key];
        } else {
          found = false;
          break;
        }
      }
      
      if (found && Array.isArray(current)) {
        Logger.log(`Found items array at path: ${path.join('.')}`);
        return current;
      }
    }
    
    // If no direct path found, search recursively
    return searchForItemsRecursively(jsonData, listId);
  } catch (error) {
    Logger.log('Error extracting list items: ' + error.toString());
    return [];
  }
}

/**
 * Recursively search JSON for list items
 * @param {Object} obj - Object to search
 * @param {string} listId - List ID
 * @returns {Array} Array of items or empty
 */
function searchForItemsRecursively(obj, listId) {
  if (!obj || typeof obj !== 'object') {
    return [];
  }
  
  // If it's an array and looks like list items, return it
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0] && typeof obj[0] === 'object') {
      // Check if items have list-like properties
      const firstItem = obj[0];
      if (firstItem.id || firstItem.item_id || firstItem.text || firstItem.title || firstItem.description) {
        Logger.log(`Found potential items array with ${obj.length} items`);
        return obj;
      }
    }
    return [];
  }
  
  // Search in object properties
  for (let key in obj) {
    if (key === 'items' && Array.isArray(obj[key])) {
      return obj[key];
    }
    if (key === listId && obj[key] && obj[key].items && Array.isArray(obj[key].items)) {
      return obj[key].items;
    }
    
    const result = searchForItemsRecursively(obj[key], listId);
    if (result && result.length > 0) {
      return result;
    }
  }
  
  return [];
}

/**
 * Try accessing list with cookie token (xoxc-)
 * Cookie tokens work better for internal Slack endpoints
 * @param {string} listId - List ID
 * @param {string} cookieToken - Cookie token (xoxc-)
 * @returns {Array} Array of items or empty array
 */
function tryCookieTokenAccess(listId, cookieToken) {
  try {
    // Cookie tokens use cookie-based authentication
    const endpoints = [
      `https://leet-wru5565.slack.com/api/lists.info?list=${listId}`,
      `https://leet-wru5565.slack.com/api/lists.items?list=${listId}`,
      `https://app.slack.com/api/lists.info?list=${listId}`,
      `https://app.slack.com/api/lists.items?list=${listId}`,
      `https://leet-wru5565.slack.com/api/lists.get?list=${listId}`
    ];
    
    for (let endpoint of endpoints) {
      try {
        const options = {
          method: 'get',
          headers: {
            'Cookie': `d=${cookieToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'X-Slack-User': 'U099R9US3QW' // User ID from the token data
          },
          muteHttpExceptions: true
        };
        
        const response = UrlFetchApp.fetch(endpoint, options);
        Logger.log(`Cookie token endpoint ${endpoint}: ${response.getResponseCode()}`);
        
        if (response.getResponseCode() === 200) {
          const responseText = response.getContentText();
          Logger.log(`Cookie token response (first 1000 chars): ${responseText.substring(0, 1000)}`);
          
          try {
            const data = JSON.parse(responseText);
            if (data.ok !== false) {
              // Try different response structures
              if (data.items && Array.isArray(data.items)) {
                Logger.log(`Found ${data.items.length} items`);
                return data.items;
              }
              if (data.list && data.list.items && Array.isArray(data.list.items)) {
                Logger.log(`Found ${data.list.items.length} items in list object`);
                return data.list.items;
              }
              if (data.result && Array.isArray(data.result)) {
                Logger.log(`Found ${data.result.length} items in result`);
                return data.result;
              }
              if (Array.isArray(data)) {
                Logger.log(`Found ${data.length} items in array`);
                return data;
              }
              // Log full response for debugging
              Logger.log(`Full response structure: ${JSON.stringify(data).substring(0, 500)}`);
            } else if (data.error) {
              Logger.log(`API error: ${data.error}`);
            }
          } catch (e) {
            Logger.log('Error parsing cookie token response as JSON: ' + e.toString());
          }
        } else {
          Logger.log(`HTTP ${response.getResponseCode()}: ${response.getContentText().substring(0, 200)}`);
        }
      } catch (e) {
        Logger.log(`Error trying cookie endpoint ${endpoint}: ${e.toString()}`);
      }
    }
    
    return [];
  } catch (error) {
    Logger.log('Error in cookie token access: ' + error.toString());
    return [];
  }
}

/**
 * Try accessing list via web interface with authentication
 * Slack Lists are accessible via web, so we fetch the list page
 * @param {string} listId - List ID
 * @param {string} token - Slack token
 * @param {string} tokenType - Token type (bot, user, cookie)
 * @returns {Array} Array of items or empty array
 */
function tryWebListAccess(listId, token, tokenType) {
  try {
    // Construct the list URL
    const listUrl = `https://leet-wru5565.slack.com/api/lists.info?list=${listId}`;
    
    // Build headers based on token type
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    if (tokenType === 'cookie') {
      headers['Cookie'] = `d=${token}`;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const options = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(listUrl, options);
    Logger.log(`Web list access response code: ${response.getResponseCode()}`);
    
    if (response.getResponseCode() === 200) {
      const responseText = response.getContentText();
      Logger.log(`Web list access response (first 500 chars): ${responseText.substring(0, 500)}`);
      
      try {
        const data = JSON.parse(responseText);
        if (data.ok && data.list) {
          // Extract items from list
          if (data.list.items && Array.isArray(data.list.items)) {
            Logger.log(`Found ${data.list.items.length} items in list`);
            return data.list.items;
          }
        }
      } catch (e) {
        Logger.log('Error parsing web list response as JSON: ' + e.toString());
      }
    }
    
    // Alternative: Try accessing the list page HTML and parsing it
    return tryParseListPage(listId, token, tokenType);
    
  } catch (error) {
    Logger.log('Error in web list access: ' + error.toString());
    return [];
  }
}

/**
 * Try parsing the list page HTML/JSON
 * @param {string} listId - List ID
 * @param {string} token - Slack token
 * @param {string} tokenType - Token type
 * @returns {Array} Array of items or empty array
 */
function tryParseListPage(listId, token, tokenType) {
  try {
    // Try accessing the list page with different endpoints
    const endpoints = [
      `https://leet-wru5565.slack.com/api/lists.items?list=${listId}`,
      `https://leet-wru5565.slack.com/api/lists.get?list=${listId}`,
      `https://app.slack.com/api/lists.info?list=${listId}`,
      `https://app.slack.com/api/lists.items?list=${listId}`
    ];
    
    for (let endpoint of endpoints) {
      try {
        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        
        if (tokenType === 'cookie') {
          headers['Cookie'] = `d=${token}`;
        } else {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const options = {
          method: 'get',
          headers: headers,
          muteHttpExceptions: true
        };
        
        const response = UrlFetchApp.fetch(endpoint, options);
        Logger.log(`Trying endpoint ${endpoint}: ${response.getResponseCode()}`);
        
        if (response.getResponseCode() === 200) {
          const responseText = response.getContentText();
          Logger.log(`Response (first 1000 chars): ${responseText.substring(0, 1000)}`);
          
          try {
            const data = JSON.parse(responseText);
            if (data.ok) {
              // Try different response structures
              if (data.items && Array.isArray(data.items)) {
                return data.items;
              }
              if (data.list && data.list.items && Array.isArray(data.list.items)) {
                return data.list.items;
              }
              if (data.result && Array.isArray(data.result)) {
                return data.result;
              }
              if (Array.isArray(data)) {
                return data;
              }
            }
          } catch (e) {
            // Not JSON, might be HTML - try to extract JSON from HTML
            const jsonMatch = responseText.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
            if (jsonMatch) {
              try {
                const initialState = JSON.parse(jsonMatch[1]);
                Logger.log('Found initial state in HTML');
                // Try to extract list items from initial state
                if (initialState.lists && initialState.lists[listId]) {
                  return initialState.lists[listId].items || [];
                }
              } catch (e2) {
                Logger.log('Error parsing initial state: ' + e2.toString());
              }
            }
          }
        }
      } catch (e) {
        Logger.log(`Error trying endpoint ${endpoint}: ${e.toString()}`);
      }
    }
    
    return [];
  } catch (error) {
    Logger.log('Error parsing list page: ' + error.toString());
    return [];
  }
}

/**
 * Try direct list access: official Slack API slackLists.items.list with list_id (POST).
 * @param {string} listId - List ID
 * @param {string} token - Slack token (Bearer)
 * @returns {Array} Array of items or empty array
 */
function tryDirectListAccess(listId, token) {
  const result = trySlackListsItemsList(listId, token);
  if (result.items && result.items.length > 0) return result.items;
  return [];
}

/**
 * Get user info from Slack user ID. Results are cached per request so 232 items
 * with few unique users only trigger one API call per user (not 232 calls).
 * @param {string} userId - Slack user ID
 * @returns {Object} User information
 */
function getSlackUserInfo(userId) {
  var unknown = { name: 'Unknown', displayName: 'Unknown', email: null };
  if (!userId || typeof userId !== 'string' || !userId.trim()) return unknown;
  var key = userId.trim();
  try {
    if (typeof _slackUserInfoCache !== 'undefined' && _slackUserInfoCache[key]) {
      return _slackUserInfoCache[key];
    }
    if (!_slackTokenForUserInfo) _slackTokenForUserInfo = getSlackToken();
    var tokenObj = _slackTokenForUserInfo;
    if (!tokenObj || !tokenObj.token) return unknown;
    var token = tokenObj.token;
    var tokenType = tokenObj.type;
    var apiBase = (typeof SLACK_API_BASE !== 'undefined' && SLACK_API_BASE) ? SLACK_API_BASE : 'https://slack.com/api';
    var url = apiBase + '/users.info?user=' + encodeURIComponent(key);
    var headers = { 'Content-Type': 'application/json' };
    if (tokenType === 'cookie') headers['Cookie'] = 'd=' + token;
    else headers['Authorization'] = 'Bearer ' + token;
    var response = UrlFetchApp.fetch(url, { method: 'get', headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      if (typeof _slackUserInfoCache !== 'undefined') _slackUserInfoCache[key] = unknown;
      return unknown;
    }
    var data = JSON.parse(response.getContentText());
    var result = unknown;
    if (data.ok && data.user) {
      result = {
        name: data.user.real_name || data.user.name || 'Unknown',
        displayName: (data.user.profile && data.user.profile.display_name) ? data.user.profile.display_name : (data.user.real_name || data.user.name || 'Unknown'),
        email: (data.user.profile && data.user.profile.email) ? data.user.profile.email : null
      };
    }
    if (typeof _slackUserInfoCache !== 'undefined') _slackUserInfoCache[key] = result;
    return result;
  } catch (error) {
    Logger.log('Error getting Slack user info: ' + error.toString());
    if (typeof _slackUserInfoCache !== 'undefined') _slackUserInfoCache[key] = unknown;
    return unknown;
  }
}

/**
 * Resolve Slack channel ID (C0...) or option value that looks like channel ID to display name.
 * Uses Script Property SLACK_QA_CHANNEL_NAMES (JSON: channel_id -> name) and optionally
 * conversations.info. Returns original value if not a channel ID or no mapping.
 * @param {string} channelIdOrValue - Channel ID (e.g. C0ADKGD1B8W) or option value
 * @returns {string} Display name or original value
 */
function getSlackChannelName(channelIdOrValue) {
  if (!channelIdOrValue || typeof channelIdOrValue !== 'string') return channelIdOrValue || '';
  var key = channelIdOrValue.trim();
  if (!key) return channelIdOrValue;
  if (typeof _slackChannelNameCache !== 'undefined' && _slackChannelNameCache[key]) {
    return _slackChannelNameCache[key];
  }
  if (typeof ISSUES_ACTIONS_VM_LABELS !== 'undefined' && ISSUES_ACTIONS_VM_LABELS[key]) {
    _slackChannelNameCache[key] = ISSUES_ACTIONS_VM_LABELS[key];
    return ISSUES_ACTIONS_VM_LABELS[key];
  }
  var isChannelId = /^C[A-Z0-9]{8,}$/.test(key);
  try {
    var props = PropertiesService.getScriptProperties();
    var json = props.getProperty('SLACK_QA_CHANNEL_NAMES');
    if (json && json.trim()) {
      var map = {};
      try { map = JSON.parse(json); } catch (e) {}
      if (map[key]) {
        _slackChannelNameCache[key] = map[key];
        return map[key];
      }
    }
    if (isChannelId) {
      var tokenObj = getSlackToken();
      if (tokenObj && tokenObj.token) {
        var apiBase = (typeof SLACK_API_BASE !== 'undefined' && SLACK_API_BASE) ? SLACK_API_BASE : 'https://slack.com/api';
        var url = apiBase + '/conversations.info?channel=' + encodeURIComponent(key);
        var options = { headers: { Authorization: 'Bearer ' + tokenObj.token }, muteHttpExceptions: true };
        var resp = UrlFetchApp.fetch(url, options);
        var code = resp.getResponseCode();
        var body = resp.getContentText();
        if (code === 200 && body) {
          var data = JSON.parse(body);
          if (data && data.ok && data.channel && data.channel.name) {
            var name = data.channel.name;
            _slackChannelNameCache[key] = name;
            return name;
          }
        }
      }
    }
  } catch (e) {
    Logger.log('getSlackChannelName error: ' + e.toString());
  }
  _slackChannelNameCache[key] = key;
  return key;
}

/**
 * Determine priority based on hours pending
 * @param {number} hoursPending - Hours the task has been pending
 * @returns {string} Priority level
 */
function determinePriority(hoursPending) {
  if (hoursPending >= 72) {
    return 'critical'; // 3+ days
  } else if (hoursPending >= 48) {
    return 'high'; // 2-3 days
  } else if (hoursPending >= 24) {
    return 'medium'; // 1-2 days
  }
  return 'low';
}
