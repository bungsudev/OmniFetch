/**
 * Popup Controller
 * Toggle tracking on/off, show stats, quick actions, recorder controls
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

  // Recorder elements
  const btnRecord = document.getElementById('btn-record');
  const btnPlayLast = document.getElementById('btn-play-last');
  const playbackSpeed = document.getElementById('playback-speed');
  const recCounter = document.getElementById('rec-counter');
  const recActionCount = document.getElementById('rec-action-count');
  const recList = document.getElementById('rec-list');

  let isRecording = false;
  let isPlaying = false;
  let actionCountInterval = null;

  // ================================================================
  // INIT
  // ================================================================

  async function init() {
    const { trackingEnabled } = await chrome.storage.local.get('trackingEnabled');
    const isEnabled = trackingEnabled !== false;
    toggleInput.checked = isEnabled;
    updateUI(isEnabled);

    loadStats();
    checkServer();
    loadRecorderState();
    loadRecordings();
  }

  // ================================================================
  // TOGGLE TRACKING
  // ================================================================

  toggleInput.addEventListener('change', async () => {
    const enabled = toggleInput.checked;
    await chrome.storage.local.set({ trackingEnabled: enabled });
    chrome.runtime.sendMessage({ type: 'SET_TRACKING', enabled });
    updateUI(enabled);
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

  document.getElementById('btn-devtools').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            alert('Press F12 or Cmd+Opt+I to open DevTools, then click the "OmniFetch" tab.');
          }
        });
      }
    });
    window.close();
  });

  document.getElementById('btn-admin').addEventListener('click', () => {
    chrome.tabs.create({ url: BACKEND_URL });
    window.close();
  });

  document.getElementById('btn-clear').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TAB', targetTabId: tab.id });
      statTab.textContent = '0';
    }
  });

  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (confirm('Clear ALL tracked data?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
      statRequests.textContent = '0';
      statTab.textContent = '0';
    }
  });

  // ================================================================
  // RECORDER CONTROLS
  // ================================================================

  async function loadRecorderState() {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_RECORDER_STATE' });
      if (state.isRecording) {
        setRecordingUI(true, state.actionCount);
      }
      if (state.isPlaying) {
        setPlayingUI(true);
      }
    } catch {}
  }

  btnRecord.addEventListener('click', async () => {
    if (isRecording) {
      // Stop recording
      const result = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      setRecordingUI(false);

      if (result.actions && result.actions.length > 0) {
        // Prompt for name
        const name = prompt('Name this recording:', `Recording ${new Date().toLocaleTimeString()}`);
        if (name !== null) {
          await chrome.runtime.sendMessage({
            type: 'SAVE_RECORDING',
            name: name || `Recording ${new Date().toLocaleTimeString()}`,
          });
          loadRecordings();
        }
      }
    } else {
      // Start recording
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: tab.id,
        url: tab.url,
      });
      setRecordingUI(true, 0);

      // Poll action count while popup is open
      actionCountInterval = setInterval(async () => {
        try {
          const state = await chrome.runtime.sendMessage({ type: 'GET_RECORDER_STATE' });
          if (state.isRecording) {
            recActionCount.textContent = state.actionCount;
          } else {
            clearInterval(actionCountInterval);
          }
        } catch {
          clearInterval(actionCountInterval);
        }
      }, 500);

      // Close popup so user can interact with the page
      setTimeout(() => window.close(), 300);
    }
  });

  function setRecordingUI(recording, count = 0) {
    isRecording = recording;
    if (recording) {
      btnRecord.innerHTML = '<span>⏹</span> Stop';
      btnRecord.classList.add('recording');
      recCounter.style.display = 'block';
      recActionCount.textContent = count;
      btnPlayLast.disabled = true;
    } else {
      btnRecord.innerHTML = '<span>🔴</span> Record';
      btnRecord.classList.remove('recording');
      recCounter.style.display = 'none';
      if (actionCountInterval) {
        clearInterval(actionCountInterval);
        actionCountInterval = null;
      }
    }
  }

  function setPlayingUI(playing) {
    isPlaying = playing;
    if (playing) {
      btnPlayLast.innerHTML = '<span>⏹</span> Stop';
      btnPlayLast.classList.add('playing');
      btnRecord.disabled = true;
    } else {
      btnPlayLast.innerHTML = '<span>▶</span> Play Last';
      btnPlayLast.classList.remove('playing');
      btnRecord.disabled = false;
    }
  }

  // Play last recording
  btnPlayLast.addEventListener('click', async () => {
    if (isPlaying) {
      await chrome.runtime.sendMessage({ type: 'STOP_PLAYBACK' });
      setPlayingUI(false);
      return;
    }

    const result = await chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' });
    if (!result.recordings || result.recordings.length === 0) return;

    const latest = result.recordings[0];
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    setPlayingUI(true);
    await chrome.runtime.sendMessage({
      type: 'PLAY_RECORDING',
      tabId: tab.id,
      actions: latest.actions,
      startUrl: latest.startUrl,
      speed: parseFloat(playbackSpeed.value),
    });

    setTimeout(() => window.close(), 300);
  });

  // ================================================================
  // RECORDINGS LIST
  // ================================================================

  async function loadRecordings() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' });
      const recordings = result.recordings || [];

      if (recordings.length === 0) {
        recList.innerHTML = '<div class="rec-empty">No recordings yet</div>';
        btnPlayLast.disabled = true;
        return;
      }

      btnPlayLast.disabled = isRecording;

      recList.innerHTML = recordings.map(rec => `
        <div class="rec-item" data-id="${rec.id}">
          <span class="rec-item-name" title="${escapeHtml(rec.name)}">${escapeHtml(rec.name)}</span>
          <span class="rec-item-count">${rec.actionCount} actions</span>
          <div class="rec-item-actions">
            <button class="rec-action-btn" title="Play" data-play="${rec.id}">▶</button>
            <button class="rec-action-btn" title="Export Puppeteer" data-export="${rec.id}">📤</button>
            <button class="rec-action-btn" title="Delete" data-delete="${rec.id}">🗑</button>
          </div>
        </div>
      `).join('');

      // Attach events
      recList.querySelectorAll('[data-play]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          playRecording(btn.dataset.play);
        });
      });

      recList.querySelectorAll('[data-export]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          exportRecording(btn.dataset.export);
        });
      });

      recList.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteRecording(btn.dataset.delete);
        });
      });
    } catch (err) {
      recList.innerHTML = '<div class="rec-empty">Error loading recordings</div>';
    }
  }

  async function playRecording(id) {
    const result = await chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' });
    const rec = (result.recordings || []).find(r => r.id === id);
    if (!rec) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    setPlayingUI(true);
    await chrome.runtime.sendMessage({
      type: 'PLAY_RECORDING',
      tabId: tab.id,
      actions: rec.actions,
      startUrl: rec.startUrl,
      speed: parseFloat(playbackSpeed.value),
    });

    setTimeout(() => window.close(), 300);
  }

  async function exportRecording(id) {
    const result = await chrome.runtime.sendMessage({ type: 'GET_RECORDINGS' });
    const rec = (result.recordings || []).find(r => r.id === id);
    if (!rec) return;

    const resp = await chrome.runtime.sendMessage({ type: 'EXPORT_PUPPETEER', recording: rec });
    if (resp.script) {
      // Download as file
      const blob = new Blob([resp.script], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.name.replace(/[^a-z0-9]/gi, '_')}_puppeteer.js`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function deleteRecording(id) {
    if (!confirm('Delete this recording?')) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_RECORDING', recordingId: id });
    loadRecordings();
  }

  // ================================================================
  // HELPERS
  // ================================================================

  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Start
  init();
})();
