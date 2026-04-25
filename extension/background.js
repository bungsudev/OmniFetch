/**
 * Background Service Worker
 * Captures all network requests using chrome.webRequest and chrome.webNavigation APIs.
 * Acts as the central hub for data collection and communication.
 */

importScripts('utils/request-store.js');

const store = globalThis.__requestStore;

// ============================================================================
// TRACKING STATE
// ============================================================================

let trackingEnabled = true;

// Load saved state
chrome.storage.local.get('trackingEnabled', (result) => {
  trackingEnabled = result.trackingEnabled !== false; // Default: enabled
  // Update badge
  if (!trackingEnabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
  }
});

// ============================================================================
// WEB REQUEST LISTENERS
// ============================================================================

/**
 * Capture outgoing request details
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { requestId, url, method, tabId, type, timeStamp, initiator, requestBody } = details;

    if (tabId < 0) return; // Ignore non-tab requests
    if (!trackingEnabled) return; // Tracking is paused

    store.addRequest(requestId, {
      url,
      method,
      tabId,
      type,
      initiator: initiator || '',
      timestamp: timeStamp,
      requestBody: requestBody || null,
      phase: 'pending',
    });
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

/**
 * Capture request headers being sent
 */
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const { requestId, requestHeaders } = details;
    const entry = store.getRequest(requestId);
    if (entry) {
      store.addRequest(requestId, {
        ...entry,
        requestHeaders: requestHeaders || [],
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

/**
 * Capture actual sent headers (after Chrome modifications)
 */
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const { requestId, requestHeaders } = details;
    const entry = store.getRequest(requestId);
    if (entry) {
      store.addRequest(requestId, {
        ...entry,
        sentHeaders: requestHeaders || [],
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

/**
 * Capture response headers received
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const { requestId, statusCode, responseHeaders, statusLine } = details;
    const entry = store.getRequest(requestId);
    if (entry) {
      store.addRequest(requestId, {
        ...entry,
        statusCode,
        statusLine: statusLine || '',
        responseHeaders: responseHeaders || [],
        phase: 'headers-received',
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

/**
 * Detect server-side redirects (301, 302, 303, 307, 308)
 */
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    const { requestId, url, redirectUrl, statusCode, tabId } = details;

    if (tabId < 0) return;
    if (!trackingEnabled) return;

    store.addRedirect(requestId, url, redirectUrl, statusCode);

    // Update the request with redirect info
    const entry = store.getRequest(requestId);
    if (entry) {
      if (!entry.redirects) entry.redirects = [];
      entry.redirects.push({
        from: url,
        to: redirectUrl,
        statusCode,
        timestamp: Date.now(),
      });
      store.addRequest(requestId, entry);
    }
  },
  { urls: ['<all_urls>'] }
);

/**
 * Capture completed requests
 */
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const { requestId, statusCode, fromCache } = details;
    const entry = store.getRequest(requestId);
    if (entry) {
      store.addRequest(requestId, {
        ...entry,
        statusCode,
        fromCache: fromCache || false,
        phase: 'completed',
        completedAt: Date.now(),
        duration: Date.now() - (entry.timestamp || Date.now()),
      });
    }
  },
  { urls: ['<all_urls>'] }
);

/**
 * Capture request errors
 */
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const { requestId, error } = details;
    const entry = store.getRequest(requestId);
    if (entry) {
      store.addRequest(requestId, {
        ...entry,
        error: error || 'Unknown error',
        phase: 'error',
        completedAt: Date.now(),
        duration: Date.now() - (entry.timestamp || Date.now()),
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// ============================================================================
// WEB NAVIGATION LISTENERS (for navigation-based redirects)
// ============================================================================

/**
 * Track navigation events for redirect chain building
 */
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.tabId < 0) return;
  // Store navigation start for correlating with redirects
  const navKey = `nav-${details.tabId}-${details.frameId}`;
  store.addRequest(navKey, {
    url: details.url,
    tabId: details.tabId,
    frameId: details.frameId,
    type: 'navigation',
    method: 'NAVIGATE',
    timestamp: details.timeStamp,
    phase: 'navigating',
  });
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.tabId < 0 || details.frameId !== 0) return;
  // Navigation completed — main frame only
  const navKey = `nav-${details.tabId}-${details.frameId}`;
  const entry = store.getRequest(navKey);
  if (entry) {
    store.addRequest(navKey, {
      ...entry,
      phase: 'completed',
      completedAt: details.timeStamp,
    });
  }
});

// ============================================================================
// MESSAGE HANDLING (from content scripts and devtools panel)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id || message.tabId;

  switch (message.type) {

    // ---------- Content script / injected script messages ----------

    case 'JS_REDIRECT': {
      store.addJsRedirect(tabId, {
        method: message.method,
        from: message.from,
        to: message.to,
        timestamp: message.timestamp,
      });
      sendResponse({ ok: true });
      break;
    }

    case 'META_REDIRECT': {
      store.addMetaRedirect(tabId, {
        from: message.from,
        to: message.to,
        delay: message.delay,
        timestamp: message.timestamp,
      });
      sendResponse({ ok: true });
      break;
    }

    case 'FETCH_INTERCEPT': {
      // Enriched fetch/XHR data from injected script
      const reqId = `fetch-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      store.addRequest(reqId, {
        url: message.url,
        method: message.method,
        tabId,
        type: message.requestType || 'fetch',
        requestHeaders: message.headers || {},
        requestBody: message.body || null,
        statusCode: message.statusCode,
        responseHeaders: message.responseHeaders || {},
        responseBody: message.responseBody || null,
        timestamp: message.timestamp || Date.now(),
        phase: 'completed',
        source: 'injected',
      });
      sendResponse({ ok: true });
      break;
    }

    // ---------- Panel messages ----------

    case 'GET_REQUESTS': {
      const filter = message.filter || {};
      if (tabId !== undefined) filter.tabId = message.targetTabId;
      const requests = store.getAllRequests(filter);
      sendResponse({ requests });
      break;
    }

    case 'GET_REQUEST': {
      const request = store.getRequest(message.requestId);
      sendResponse({ request });
      break;
    }

    case 'GET_REDIRECT_CHAINS': {
      const chains = store.getRedirectChains(message.targetTabId);
      sendResponse({ chains });
      break;
    }

    case 'GET_UNIFIED_CHAIN': {
      const chain = store.buildUnifiedChain(message.targetTabId);
      sendResponse({ chain });
      break;
    }

    case 'EXPORT_DATA': {
      const data = store.exportData(message.targetTabId);
      sendResponse({ data });
      break;
    }

    case 'CLEAR_TAB': {
      store.clearTab(message.targetTabId);
      sendResponse({ ok: true });
      break;
    }

    case 'CLEAR_ALL': {
      store.clearAll();
      sendResponse({ ok: true });
      break;
    }

    // ---------- Popup messages ----------

    case 'SET_TRACKING': {
      trackingEnabled = message.enabled;
      chrome.storage.local.set({ trackingEnabled: message.enabled });
      console.log(`[HTTP Tracker Pro] Tracking ${message.enabled ? 'ENABLED' : 'DISABLED'}`);
      sendResponse({ ok: true, enabled: message.enabled });
      break;
    }

    case 'GET_STATS': {
      const allReqs = store.getAllRequests({});
      let tabCount = 0;
      // Get active tab count
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const tabReqs = store.getAllRequests({ tabId: tabs[0].id });
          tabCount = tabReqs.length;
        }
        sendResponse({
          total: allReqs.length,
          tabCount,
          enabled: trackingEnabled,
        });
      });
      break;
    }

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return true; // Keep channel open for async responses
});

// ============================================================================
// CONNECTION HANDLING (for persistent panel connection)
// ============================================================================

const panelConnections = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('panel-')) {
    const tabIdStr = port.name.replace('panel-', '');
    panelConnections.set(tabIdStr, port);

    // Forward store events to the panel
    const listener = (event, data) => {
      try {
        port.postMessage({ event, data });
      } catch {
        // Port disconnected
      }
    };
    store.addListener(listener);

    port.onDisconnect.addListener(() => {
      panelConnections.delete(tabIdStr);
      store.removeListener(listener);
    });

    // Send initial data
    const initialRequests = store.getAllRequests(
      tabIdStr !== 'undefined' ? { tabId: parseInt(tabIdStr, 10) } : {}
    );
    try {
      port.postMessage({
        event: 'initial-data',
        data: { requests: initialRequests },
      });
    } catch {
      // Port disconnected
    }
  }
});

// ============================================================================
// TAB LIFECYCLE
// ============================================================================

// Optionally clear data when a tab navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // We don't clear by default so the user can see the full flow
    // Uncomment below to auto-clear on navigation:
    // store.clearTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Clean up after a reasonable delay
  setTimeout(() => {
    store.clearTab(tabId);
  }, 60000); // Keep data for 1 minute after tab closes
});

// ============================================================================
// BACKEND SYNC - Send captured data to PostgreSQL via API
// ============================================================================

const BACKEND_URL = 'http://localhost:3847';
const API_KEY = 'htp-ext-key-8f3a9b2c4d5e6f7a';

const syncQueue = [];
const redirectSyncQueue = [];
let syncTimer = null;
const SYNC_INTERVAL = 2000;
const SYNC_BATCH_SIZE = 30;

/**
 * Queue a completed request for backend sync
 */
function queueForSync(requestData) {
  if (!requestData || !requestData.url) return;
  // Skip internal extension requests and backend requests
  if (requestData.url.startsWith('chrome-extension://')) return;
  if (requestData.url.startsWith(BACKEND_URL)) return;
  if (requestData.url.startsWith('chrome://')) return;

  syncQueue.push({
    id: requestData.id || `req-${Date.now()}`,
    url: requestData.url,
    method: requestData.method || 'GET',
    tabId: requestData.tabId,
    type: requestData.type,
    initiator: requestData.initiator,
    requestHeaders: requestData.requestHeaders || requestData.sentHeaders || {},
    responseHeaders: requestData.responseHeaders || {},
    requestBody: requestData.requestBody ?
      (typeof requestData.requestBody === 'string' ? requestData.requestBody : JSON.stringify(requestData.requestBody)) : null,
    responseBody: requestData.responseBody || null,
    statusCode: requestData.statusCode,
    statusLine: requestData.statusLine,
    requestType: requestData.type,
    duration: requestData.duration,
    fromCache: requestData.fromCache,
    responseSize: requestData.responseSize,
    redirectChainId: requestData.redirectChainId,
    jsRedirectFrom: requestData.jsRedirectFrom,
    metaRedirectFrom: requestData.metaRedirectFrom,
    source: requestData.source || 'webRequest',
    phase: requestData.phase,
    error: requestData.error,
    timestamp: requestData.timestamp,
  });

  scheduleSyncFlush();
}

function scheduleSyncFlush() {
  if (syncQueue.length >= SYNC_BATCH_SIZE) {
    flushSyncQueue();
  } else if (!syncTimer) {
    syncTimer = setTimeout(flushSyncQueue, SYNC_INTERVAL);
  }
}

/**
 * Queue a redirect chain for sync
 */
function queueRedirectForSync(chainData) {
  redirectSyncQueue.push(chainData);
  scheduleSyncFlush();
}

/**
 * Flush queued data to backend
 */
async function flushSyncQueue() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  // Flush requests
  if (syncQueue.length > 0) {
    const batch = syncQueue.splice(0, SYNC_BATCH_SIZE);
    console.log(`[Sync] Sending ${batch.length} requests to backend...`);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        body: JSON.stringify(batch),
      });
      if (resp.ok) {
        const result = await resp.json();
        console.log(`[Sync] ✅ Synced ${result.inserted} requests`);
      } else {
        console.warn(`[Sync] ⚠️ Server returned ${resp.status}`);
      }
    } catch (err) {
      console.warn('[Sync] ❌ Backend not available:', err.message);
    }
  }

  // Flush redirect chains
  if (redirectSyncQueue.length > 0) {
    const chains = redirectSyncQueue.splice(0);
    console.log(`[Sync] Sending ${chains.length} redirect chains...`);
    try {
      const resp = await fetch(`${BACKEND_URL}/api/redirects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        body: JSON.stringify(chains),
      });
      if (resp.ok) {
        console.log('[Sync] ✅ Redirect chains synced');
      }
    } catch (err) {
      console.warn('[Sync] ❌ Redirect sync failed:', err.message);
    }
  }

  // Schedule next flush if there's remaining data
  if (syncQueue.length > 0 || redirectSyncQueue.length > 0) {
    syncTimer = setTimeout(flushSyncQueue, SYNC_INTERVAL);
  }
}

// ============================================================================
// SYNC HOOKS - Direct integration into request lifecycle
// ============================================================================

// Hook 1: Sync completed webRequest requests
const _originalOnCompleted = chrome.webRequest.onCompleted;
// We already have the listener above, but let's also hook the store
store.addListener((event, data) => {
  if (!data) return;

  switch (event) {
    case 'request-updated':
      // Sync when request is completed or errored
      if (data.phase === 'completed' || data.phase === 'error') {
        queueForSync(data);
      }
      break;

    case 'js-redirect':
    case 'meta-redirect':
      queueForSync(data);
      break;
  }
});

// Hook 2: Periodic redirect chain sync
setInterval(() => {
  const chains = store.getRedirectChains();
  if (chains.length > 0) {
    const newChains = chains.filter(c => !c._synced);
    for (const chain of newChains) {
      queueRedirectForSync(chain);
      chain._synced = true;
    }
  }
}, 10000);

// Hook 3: Sync on service worker shutdown (best effort)
self.addEventListener('activate', () => {
  console.log('[HTTP Tracker Pro] Service worker activated');
});

console.log('[HTTP Tracker Pro] Background service worker started');
console.log(`[HTTP Tracker Pro] Backend sync target: ${BACKEND_URL}`);
console.log(`[HTTP Tracker Pro] API Key: ${API_KEY.slice(0, 8)}...`);

