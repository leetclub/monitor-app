// Helper: read secrets from Script Properties (Extensions > Apps Script > Project Settings > Script properties). No secrets in code.
function _prop(key) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    return (v && v.trim()) ? v.trim() : '';
  } catch (e) { return ''; }
}

const API_BASE = "https://cloud.vendon.net/rest/v1.9.0";
const API_KEY = _prop('API_KEY') || ''; // Set API_KEY in Script Properties
  
const MAINTENANCE_API_URL = 'https://cloud.vendon.net/rest/head/maintenance/preventativeMaintenanceSchedules';
const CACHE_DURATION = 300; // 5 minutes in seconds
  
const EXCLUDED_EVENT_NAMES = [
  "Telemetry communication with machine",
  "EVA-DTS failed"
];

const EVENT_NAME_MAPPING = {
  // REFILL events
  "Component at critical level": "REFILL", 
  "Component is empty": "REFILL",
  
  // Machine OFF events
  "Power Supply Interrupted": "Machine OFF",
  "Machine out of order due to power failure": "Machine OFF",
  
  // KNet OFF events
  "Cashless": "KNet OFF",
  "Cashless status: Inhibit": "KNet OFF",
  "Cashless status: OFF": "KNet OFF",
  
  // Vendon OFF events
  "vBox offline": "Vendon OFF",
  "Connection to vBox lost": "Vendon OFF",
  
  // Dispense Failed events
  "Product dispense/vend failed": "Dispense Failed",
  
  // Other events we want to show but not map
  "All Products refilled": "All Products refilled" // Keep original name
};

// Session management
let VENDON_SESSION = {
  allCookies: null,
  lastRefresh: 0,
  refreshInterval: 30 * 60 * 1000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
};

const VENDON_CONFIG = {
  baseUrl: 'https://cloud.vendon.net',
  loginUrl: 'https://cloud.vendon.net/auth/login'
};

// Safety Culture API Configuration
const SAFETY_CULTURE_API_BASE = "https://api.safetyculture.io";
const SAFETY_CULTURE_API_TOKEN = _prop('SAFETY_CULTURE_API_TOKEN') || ''; // Set in Script Properties

// Slack Configuration - set SLACK_* in Script Properties
const SLACK_WEBHOOK_URL = _prop('SLACK_WEBHOOK_URL') || '';
const SLACK_PROXY_URL = "https://surveyapi.theleetclub.com/?url=";
const SLACK_WORKSPACE_ID = _prop('SLACK_WORKSPACE_ID') || '';
const SLACK_STAFF_REQUESTS_LIST_ID = _prop('SLACK_STAFF_REQUESTS_LIST_ID') || '';
const SLACK_API_BASE = "https://slack.com/api";

// Order Ratings API Configuration
const ORDER_RATINGS_API_BASE = "https://subapi.theleetclub.com/api/external";
const ORDER_RATINGS_API_TOKEN = _prop('ORDER_RATINGS_API_TOKEN') || ''; // Set in Script Properties

// Waste Analysis Reasons API (people-analytics API - same app as people-analytics, vendon-sales)
const WASTE_REASONS_API_BASE = "https://people-api.theleetclub.com";
