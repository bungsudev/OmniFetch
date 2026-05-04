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

// Recorder state — persisted to chrome.storage.local to survive SW restarts
const recorderState = {
  isRecording: false,
  isPlaying: false,
  actions: [],
  tabId: null,
  playbackTabId: null,
  startUrl: '',
  startTime: null,
  pendingNavigation: false,
};

// Restore recorder state on SW startup
chrome.storage.local.get('_recorderState', (result) => {
  if (result._recorderState) {
    Object.assign(recorderState, result._recorderState);
    if (recorderState.isRecording) {
      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
    }
  }
});

function persistRecorderState() {
  chrome.storage.local.set({
    _recorderState: {
      isRecording: recorderState.isRecording,
      isPlaying: recorderState.isPlaying,
      actions: recorderState.actions,
      tabId: recorderState.tabId,
      startUrl: recorderState.startUrl,
      startTime: recorderState.startTime,
    }
  });
}

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
 * Parse Chrome's requestBody object into a readable string
 * Chrome provides: { formData: { key: [val1, val2] }, raw: [{ bytes: ArrayBuffer }] }
 */
function parseRequestBody(requestBody) {
  if (!requestBody) return null;

  // Form data (application/x-www-form-urlencoded or multipart/form-data)
  if (requestBody.formData) {
    const parsed = {};
    for (const [key, values] of Object.entries(requestBody.formData)) {
      parsed[key] = values.length === 1 ? values[0] : values;
    }
    return JSON.stringify(parsed, null, 2);
  }

  // Raw body (JSON, text, etc.)
  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder('utf-8');
      const parts = requestBody.raw.map(part => {
        if (part.bytes) {
          return decoder.decode(part.bytes);
        }
        return '';
      });
      const rawText = parts.join('');

      // Try to pretty-print JSON
      try {
        const jsonObj = JSON.parse(rawText);
        return JSON.stringify(jsonObj, null, 2);
      } catch {
        return rawText;
      }
    } catch {
      return '[Binary data]';
    }
  }

  return null;
}

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
      requestBody: parseRequestBody(requestBody),
      requestBodyRaw: requestBody || null,
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
      const updated = store.addRequest(requestId, {
        ...entry,
        statusCode,
        fromCache: fromCache || false,
        phase: 'completed',
        completedAt: Date.now(),
        duration: Date.now() - (entry.timestamp || Date.now()),
      });
      // Directly queue for backend sync
      queueForSync(updated);
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
      const updated = store.addRequest(requestId, {
        ...entry,
        error: error || 'Unknown error',
        phase: 'error',
        completedAt: Date.now(),
        duration: Date.now() - (entry.timestamp || Date.now()),
      });
      // Directly queue for backend sync
      queueForSync(updated);
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
      const fetchEntry = store.addRequest(reqId, {
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
      // Directly sync fetch-intercepted requests
      queueForSync(fetchEntry);
      sendResponse({ ok: true });
      break;
    }

    case 'FORM_SUBMIT': {
      // Native HTML form submission captured by injected script
      const formReqId = `form-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const formEntry = store.addRequest(formReqId, {
        url: message.url,
        method: message.method || 'POST',
        tabId,
        type: 'form-submit',
        requestHeaders: {
          'Content-Type': message.enctype || 'application/x-www-form-urlencoded',
        },
        requestBody: JSON.stringify(message.fields, null, 2),
        statusCode: null,
        responseHeaders: {},
        responseBody: null,
        timestamp: message.timestamp || Date.now(),
        phase: 'completed',
        source: 'form',
        formMetadata: {
          formId: message.formId,
          formName: message.formName,
          formAction: message.formAction,
          enctype: message.enctype,
          fieldCount: message.fieldCount,
          programmatic: message.programmatic || false,
        },
      });
      queueForSync(formEntry);
      console.log(`[OmniFetch] 📝 Form submit captured: ${message.method} ${message.url} (${message.fieldCount} fields)`);
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
      console.log(`[OmniFetch] Tracking ${message.enabled ? 'ENABLED' : 'DISABLED'}`);
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

    // ---------- Recorder & Player messages ----------

    case 'START_RECORDING': {
      recorderState.isRecording = true;
      recorderState.actions = [];
      recorderState.tabId = message.tabId || null;
      recorderState.startUrl = message.url || '';
      recorderState.startTime = Date.now();
      persistRecorderState();
      // Inject recorder into the active tab
      if (recorderState.tabId) {
        chrome.tabs.sendMessage(recorderState.tabId, { type: 'INJECT_RECORDER' });
      }
      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
      console.log('[OmniFetch] 🔴 Recording started');
      sendResponse({ ok: true });
      break;
    }

    case 'STOP_RECORDING': {
      recorderState.isRecording = false;
      persistRecorderState();
      // Tell content script to stop recorder
      if (recorderState.tabId) {
        chrome.tabs.sendMessage(recorderState.tabId, { type: 'STOP_RECORDER' });
      }
      chrome.action.setBadgeText({ text: trackingEnabled ? '' : 'OFF' });
      if (!trackingEnabled) {
        chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
      }
      console.log(`[OmniFetch] ⏹ Recording stopped (${recorderState.actions.length} actions)`);
      sendResponse({ ok: true, actions: recorderState.actions });
      break;
    }

    case 'RECORDER_EVENT': {
      // Forward from content.js → recorder.js events
      if (message.event === 'RECORDER_ACTION' && message.action) {
        recorderState.actions.push(message.action);
        persistRecorderState(); // Save each action immediately
      } else if (message.event === 'RECORDER_STOPPED' && message.actions) {
        recorderState.actions = message.actions;
        persistRecorderState();
      } else if (message.event === 'RECORDER_BEFOREUNLOAD' && message.actions) {
        recorderState.actions = message.actions;
        recorderState.pendingNavigation = true;
        persistRecorderState();
      }
      sendResponse({ ok: true });
      break;
    }

    case 'SAVE_RECORDING': {
      const recording = {
        id: `rec-${Date.now()}`,
        name: message.name || `Recording ${new Date().toLocaleString()}`,
        actions: message.actions || recorderState.actions,
        startUrl: message.startUrl || recorderState.startUrl,
        createdAt: new Date().toISOString(),
        actionCount: (message.actions || recorderState.actions).length,
      };
      chrome.storage.local.get('recordings', (result) => {
        const recordings = result.recordings || [];
        recordings.unshift(recording);
        chrome.storage.local.set({ recordings }, () => {
          // Clear recorder state after save
          recorderState.actions = [];
          persistRecorderState();
          console.log(`[OmniFetch] 💾 Recording saved: "${recording.name}" (${recording.actionCount} actions)`);

          // Sync to server (fire & forget)
          fetch(`${BACKEND_URL}/api/recordings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
            body: JSON.stringify(recording),
          }).then(r => {
            if (r.ok) console.log('[OmniFetch] 📡 Recording synced to server');
          }).catch(() => { /* offline — OK */ });

          sendResponse({ ok: true, recording });
        });
      });
      break;
    }

    case 'GET_RECORDINGS': {
      chrome.storage.local.get('recordings', (result) => {
        sendResponse({ recordings: result.recordings || [] });
      });
      break;
    }

    case 'DELETE_RECORDING': {
      chrome.storage.local.get('recordings', (result) => {
        const recordings = (result.recordings || []).filter(r => r.id !== message.recordingId);
        chrome.storage.local.set({ recordings }, () => {
          sendResponse({ ok: true });
        });
      });
      break;
    }

    case 'PLAY_RECORDING': {
      recorderState.isPlaying = true;
      recorderState.playbackTabId = message.tabId;
      // Navigate to start URL first, then inject player
      if (message.startUrl && message.tabId) {
        chrome.tabs.update(message.tabId, { url: message.startUrl }, () => {
          // Wait for page load, then inject player
          const onComplete = (tabId, info) => {
            if (tabId === message.tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(onComplete);
              setTimeout(() => {
                chrome.tabs.sendMessage(message.tabId, {
                  type: 'INJECT_PLAYER',
                  actions: message.actions,
                  speed: message.speed || 1,
                });
              }, 500);
            }
          };
          chrome.tabs.onUpdated.addListener(onComplete);
        });
      } else if (message.tabId) {
        chrome.tabs.sendMessage(message.tabId, {
          type: 'INJECT_PLAYER',
          actions: message.actions,
          speed: message.speed || 1,
        });
      }
      chrome.action.setBadgeText({ text: '▶' });
      chrome.action.setBadgeBackgroundColor({ color: '#3fb950' });
      sendResponse({ ok: true });
      break;
    }

    case 'STOP_PLAYBACK': {
      recorderState.isPlaying = false;
      if (recorderState.playbackTabId) {
        chrome.tabs.sendMessage(recorderState.playbackTabId, { type: 'STOP_PLAYER' });
      }
      chrome.action.setBadgeText({ text: trackingEnabled ? '' : 'OFF' });
      sendResponse({ ok: true });
      break;
    }

    case 'PLAYER_EVENT': {
      // Player status updates — forward to popup if open
      if (message.event === 'PLAYER_COMPLETED' || message.event === 'PLAYER_ERROR' || message.event === 'PLAYER_STOPPED') {
        recorderState.isPlaying = false;
        chrome.action.setBadgeText({ text: trackingEnabled ? '' : 'OFF' });
      }
      sendResponse({ ok: true });
      break;
    }

    case 'GET_RECORDER_STATE': {
      sendResponse({
        isRecording: recorderState.isRecording,
        isPlaying: recorderState.isPlaying,
        actionCount: recorderState.actions.length,
      });
      break;
    }

    case 'EXPORT_PUPPETEER': {
      const script = generatePuppeteerScript(message.recording);
      sendResponse({ script });
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
  console.log('[OmniFetch] Service worker activated');
});

// ============================================================================
// PUPPETEER SCRIPT GENERATOR
// ============================================================================

function generatePuppeteerScript(recording) {
  const lines = [
    `const puppeteer = require('puppeteer');`,
    ``,
    `// Auto-generated by OmniFetch Pro`,
    `// Recording: ${recording.name}`,
    `// Created: ${recording.createdAt}`,
    `// Actions: ${recording.actionCount}`,
    ``,
    `(async () => {`,
    `  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });`,
    `  const page = await browser.newPage();`,
    ``,
    `  // Navigate to starting page`,
    `  await page.goto('${recording.startUrl}', { waitUntil: 'networkidle2' });`,
    ``,
  ];

  for (const action of recording.actions) {
    const delay = Math.max(100, action.delay || 500);
    lines.push(`  await page.waitForTimeout(${delay});`);

    switch (action.type) {
      case 'click':
        lines.push(`  await page.waitForSelector('${action.selector.replace(/'/g, "\\'")}');`);
        lines.push(`  await page.click('${action.selector.replace(/'/g, "\\'")}');`);
        break;
      case 'input':
        lines.push(`  await page.waitForSelector('${action.selector.replace(/'/g, "\\'")}');`);
        lines.push(`  await page.type('${action.selector.replace(/'/g, "\\'")}', '${(action.value || '').replace(/'/g, "\\'")}', { delay: 30 });`);
        break;
      case 'select':
        lines.push(`  await page.select('${action.selector.replace(/'/g, "\\'")}', '${(action.value || '').replace(/'/g, "\\'")}');`);
        break;
      case 'check':
        lines.push(`  const el = await page.$('${action.selector.replace(/'/g, "\\'")}');`);
        lines.push(`  if (el) await el.click();`);
        break;
      case 'keypress':
        lines.push(`  await page.keyboard.press('${action.key}');`);
        break;
      case 'scroll':
        lines.push(`  await page.evaluate(() => window.scrollTo(${action.scrollX}, ${action.scrollY}));`);
        break;
      case 'submit':
        lines.push(`  await page.$eval('${action.selector.replace(/'/g, "\\'")}', form => form.submit());`);
        break;
      case 'navigate':
        lines.push(`  await page.goto('${action.url}', { waitUntil: 'networkidle2' });`);
        break;
    }
    lines.push('');
  }

  lines.push(`  console.log('✅ Automation completed!');`);
  lines.push(`  // await browser.close();`);
  lines.push(`})();`);

  return lines.join('\n');
}

console.log('[OmniFetch] Background service worker started');
console.log(`[OmniFetch] Backend sync target: ${BACKEND_URL}`);
console.log(`[OmniFetch] API Key: ${API_KEY.slice(0, 8)}...`);

