/**
 * Popup Controller
 * Toggle tracking on/off, show stats, quick actions
 */

(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:3847';

  const toggleInput = document.getElementById('toggle-input');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statusSub = document.getElementById('status-sub');
  const statRequests = document.getElementById('stat-requests');
  const statTab = document.getElementById('stat-tab');
  const serverStatus = document.getElementById('server-status');

  // ================================================================
  // INIT - Load saved state
  // ================================================================

  async function init() {
    // Load tracking state
    const { trackingEnabled } = await chrome.storage.local.get('trackingEnabled');
    const isEnabled = trackingEnabled !== false; // Default: enabled
    toggleInput.checked = isEnabled;
    updateUI(isEnabled);

    // Load stats
    loadStats();

    // Check server
    checkServer();
  }

  // ================================================================
  // TOGGLE TRACKING
  // ================================================================

  toggleInput.addEventListener('change', async () => {
    const enabled = toggleInput.checked;
    await chrome.storage.local.set({ trackingEnabled: enabled });

    // Notify background
    chrome.runtime.sendMessage({ type: 'SET_TRACKING', enabled });

    updateUI(enabled);

    // Update icon badge
    if (enabled) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#f85149' });
    }
  });

  function updateUI(enabled) {
    if (enabled) {
      statusDot.className = 'status-dot on';
      statusText.textContent = 'Tracking Active';
      statusSub.textContent = 'Capturing all HTTP requests';
      statusSub.className = 'label-sub active';
    } else {
      statusDot.className = 'status-dot off';
      statusText.textContent = 'Tracking Paused';
      statusSub.textContent = 'Not capturing requests';
      statusSub.className = 'label-sub inactive';
    }
  }

  // ================================================================
  // STATS
  // ================================================================

  async function loadStats() {
    try {
      // Get total from background
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (response) {
        statRequests.textContent = formatNum(response.total || 0);
        statTab.textContent = formatNum(response.tabCount || 0);
      }
    } catch {
      statRequests.textContent = '—';
      statTab.textContent = '—';
    }
  }

  // ================================================================
  // SERVER STATUS
  // ================================================================

  async function checkServer() {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        serverStatus.textContent = '🟢 Server online';
        serverStatus.style.color = '#3fb950';
      } else {
        serverStatus.textContent = '🟠 Server error';
        serverStatus.style.color = '#d29922';
      }
    } catch {
      serverStatus.textContent = '🔴 Server offline';
      serverStatus.style.color = '#f85149';
    }
  }

  // ================================================================
  // QUICK ACTIONS
  // ================================================================

  // Open DevTools hint
  document.getElementById('btn-devtools').addEventListener('click', () => {
    // Can't programmatically open DevTools, show instructions
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Try to inject a notification
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            alert('Press F12 or Cmd+Opt+I to open DevTools, then click the "HTTP Tracker" tab.');
          }
        });
      }
    });
    window.close();
  });

  // Open Admin Dashboard
  document.getElementById('btn-admin').addEventListener('click', () => {
    chrome.tabs.create({ url: BACKEND_URL });
    window.close();
  });

  // Clear tab data
  document.getElementById('btn-clear').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TAB', targetTabId: tab.id });
      statTab.textContent = '0';
    }
  });

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (confirm('Clear ALL tracked data?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
      statRequests.textContent = '0';
      statTab.textContent = '0';
    }
  });

  // ================================================================
  // HELPERS
  // ================================================================

  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // Start
  init();
})();
