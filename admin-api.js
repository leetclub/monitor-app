/**
 * Admin Panel API - Server-side proxy for Apps Script
 * Calls the external admin API. Uses Script Property ADMIN_API_URL if set; otherwise uses default below.
 */

var ADMIN_API_URL_DEFAULT = 'https://vendon-api.theleetclub.com';

function getAdminApiUrl() {
  var url = PropertiesService.getScriptProperties().getProperty('ADMIN_API_URL');
  if (url && url.trim()) return url.replace(/\/$/, '').trim();
  return ADMIN_API_URL_DEFAULT;
}

function getAdminSessionCookie() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_SESSION_COOKIE') || '';
}

function getAdminSessionToken() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_SESSION_TOKEN') || '';
}

function setAdminSession(cookieStr, tokenStr) {
  var props = PropertiesService.getScriptProperties();
  if (tokenStr) {
    props.setProperty('ADMIN_SESSION_TOKEN', tokenStr);
    if (cookieStr) props.setProperty('ADMIN_SESSION_COOKIE', cookieStr);
    else props.deleteProperty('ADMIN_SESSION_COOKIE');
  } else {
    props.deleteProperty('ADMIN_SESSION_COOKIE');
    props.deleteProperty('ADMIN_SESSION_TOKEN');
  }
}

function setAdminSessionCookie(cookieStr) {
  if (cookieStr) {
    PropertiesService.getScriptProperties().setProperty('ADMIN_SESSION_COOKIE', cookieStr);
  } else {
    PropertiesService.getScriptProperties().deleteProperty('ADMIN_SESSION_COOKIE');
  }
}

function parseSetCookieFromHeaders(headers) {
  var setCookie = headers['Set-Cookie'] || headers['set-cookie'];
  if (!setCookie) return '';
  if (typeof setCookie === 'string') {
    var first = setCookie.split(',')[0];
    var eq = first.indexOf('=');
    if (eq === -1) return '';
    return first.substring(0, eq + 1) + first.substring(eq + 1).split(';')[0].trim();
  }
  if (Array.isArray(setCookie) && setCookie.length > 0) {
    var s = setCookie[0];
    var eq2 = s.indexOf('=');
    if (eq2 === -1) return '';
    return s.substring(0, eq2 + 1) + s.substring(eq2 + 1).split(';')[0].trim();
  }
  return '';
}

/**
 * Use only the cookie/token THIS browser sent. Never use server-stored session.
 * So other browsers/users cannot access admin; session is local to the browser that logged in.
 */
function getCookieForRequest(clientCookieOrToken) {
  var s = (typeof clientCookieOrToken === 'string' && clientCookieOrToken) ? clientCookieOrToken.trim() : '';
  if (!s) return '';
  if (s.indexOf('tk_') === 0) return '';
  return s;
}

/**
 * Login: POST to admin API, return session cookie to THIS client only. No server-side session storage
 * so other browsers/users cannot access admin; session is local to the browser that logged in.
 */
function adminApiLogin(username, password) {
  var base = getAdminApiUrl();
  if (!base) {
    return { success: false, error: 'ADMIN_API_URL not set. Add it in Project Settings > Script Properties.' };
  }
  try {
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ username: username, password: password }),
      muteHttpExceptions: true,
      headers: {}
    };
    var response = UrlFetchApp.fetch(base + '/api/admin/login', options);
    var code = response.getResponseCode();
    var headers = response.getHeaders();
    var allHeaders = response.getAllHeaders ? response.getAllHeaders() : headers;
    var cookie = parseSetCookieFromHeaders(headers) || parseSetCookieFromHeaders(allHeaders);
    var data = {};
    try {
      data = JSON.parse(response.getContentText());
    } catch (e) {}
    if (data.sessionCookie) cookie = data.sessionCookie;
    if (data.session) cookie = (typeof data.session === 'string') ? data.session : (data.session.value || '');
    if (code === 200 && data.success) {
      return { success: true, username: data.username, sessionToken: '', sessionCookie: cookie || '' };
    }
    if (code === 401) return { success: false, error: data.error || 'Invalid credentials' };
    if (code === 400) return { success: false, error: data.error || 'Bad request' };
    if (code >= 500) return { success: false, error: data.error || 'Server error' };
    return { success: false, error: data.error || 'Login failed' };
  } catch (e) {
    return { success: false, error: e.message || 'Network error' };
  }
}

/**
 * Logout: POST to admin API with this browser's cookie only.
 */
function adminApiLogout(clientCookie) {
  var base = getAdminApiUrl();
  var cookie = getCookieForRequest(clientCookie);
  if (base && cookie) {
    try {
      UrlFetchApp.fetch(base + '/api/admin/logout', {
        method: 'post',
        muteHttpExceptions: true,
        headers: { Cookie: cookie }
      });
    } catch (e) {}
  }
}

/**
 * Get current user: GET /api/admin/me with cookie. clientCookie optional (from client storage so session survives refresh).
 */
function adminApiGetCurrentUser(clientCookie) {
  var base = getAdminApiUrl();
  if (!base) return { success: false };
  var cookie = getCookieForRequest(clientCookie);
  if (!cookie) return { success: false };
  try {
    var response = UrlFetchApp.fetch(base + '/api/admin/me', {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Cookie: cookie }
    });
    if (response.getResponseCode() !== 200) return { success: false };
    var data = JSON.parse(response.getContentText());
    return {
      success: true,
      username: data.username,
      user_id: data.user_id,
      sessionCookie: clientCookie || ''
    };
  } catch (e) {
    return { success: false };
  }
}

/**
 * Get alerts: GET /api/admin/alerts. clientCookie optional (from client storage).
 */
function adminApiGetAlerts(level, source, resolved, clientCookie) {
  var base = getAdminApiUrl();
  var cookie = getCookieForRequest(clientCookie);
  if (!base || !cookie) return { success: false, error: 'Not authenticated' };
  try {
    var params = [];
    if (level) params.push('level=' + encodeURIComponent(level));
    if (source) params.push('source=' + encodeURIComponent(source));
    if (resolved !== undefined && resolved !== null && resolved !== '') params.push('resolved=' + encodeURIComponent(resolved));
    var qs = params.length ? '?' + params.join('&') : '';
    var response = UrlFetchApp.fetch(base + '/api/admin/alerts' + qs, {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Cookie: cookie }
    });
    if (response.getResponseCode() === 401) {
      setAdminSession('', '');
      return { success: false, error: 'Session expired' };
    }
    var data = JSON.parse(response.getContentText());
    if (data.success !== true) return { success: false, error: data.error || 'Failed to load alerts' };
    return data;
  } catch (e) {
    return { success: false, error: e.message || 'Request failed' };
  }
}

/**
 * Resolve alert: POST /api/admin/alerts/<alertId>/resolve. clientCookie optional.
 */
function adminApiResolveAlert(alertId, clientCookie) {
  var base = getAdminApiUrl();
  var cookie = getCookieForRequest(clientCookie);
  if (!base || !cookie) return { success: false, error: 'Not authenticated' };
  try {
    var response = UrlFetchApp.fetch(base + '/api/admin/alerts/' + encodeURIComponent(alertId) + '/resolve', {
      method: 'post',
      muteHttpExceptions: true,
      headers: { Cookie: cookie }
    });
    if (response.getResponseCode() === 401) {
      setAdminSession('', '');
      return { success: false, error: 'Session expired' };
    }
    return JSON.parse(response.getContentText());
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Get verification results: GET /api/admin/verification-results. clientCookie optional.
 */
function adminApiGetVerificationResults(clientCookie) {
  var base = getAdminApiUrl();
  var cookie = getCookieForRequest(clientCookie);
  if (!base || !cookie) return { success: false, error: 'Not authenticated' };
  try {
    var response = UrlFetchApp.fetch(base + '/api/admin/verification-results?days=7', {
      method: 'get',
      muteHttpExceptions: true,
      headers: { Cookie: cookie }
    });
    if (response.getResponseCode() === 401) {
      setAdminSession('', '');
      return { success: false, error: 'Session expired' };
    }
    var data = JSON.parse(response.getContentText());
    if (data.success !== true) return { success: false, error: data.error || 'Failed to load verification results' };
    return data;
  } catch (e) {
    return { success: false, error: e.message || 'Request failed' };
  }
}
