/**
 * Panel.js - DevTools Panel Controller
 * 
 * Manages the UI for the HTTP Tracker DevTools panel.
 * Handles request display, filtering, detail views, redirect chain visualization,
 * timeline rendering, and export operations.
 */

(function () {
  'use strict';

  // ========================================================================
  // STATE
  // ========================================================================

  const state = {
    requests: [],
    filteredRequests: [],
    selectedRequestId: null,
    recording: true,
    preserveLog: false,
    currentView: 'requests',
    filters: {
      method: 'all',
      status: 'all',
      type: 'all',
      domain: '',
      search: '',
    },
    sortField: null,
    sortDirection: 'asc',
    autoScroll: true,
    tabId: chrome.devtools.inspectedWindow.tabId,
    port: null,
    maxWaterfallDuration: 0,
  };

  // ========================================================================
  // INITIALIZATION
  // ========================================================================

  function init() {
    setupConnection();
    setupEventListeners();
    setupHARListener();
    requestAllData();
  }

  /**
   * Set up persistent connection to background
   */
  function setupConnection() {
    state.port = chrome.runtime.connect({ name: `panel-${state.tabId}` });

    state.port.onMessage.addListener((msg) => {
      if (!state.recording) return;

      switch (msg.event) {
        case 'initial-data':
          state.requests = msg.data.requests || [];
          applyFilters();
          renderRequestTable();
          updateRequestCount();
          break;

        case 'request-updated':
          handleRequestUpdate(msg.data);
          break;

        case 'redirect':
        case 'js-redirect':
        case 'meta-redirect':
          handleRequestUpdate(msg.data);
          if (state.currentView === 'redirects') {
            refreshRedirectChains();
          }
          break;

        case 'cleared':
          if (!msg.data.tabId || msg.data.tabId === state.tabId) {
            state.requests = [];
            applyFilters();
            renderRequestTable();
            updateRequestCount();
          }
          break;
      }
    });

    state.port.onDisconnect.addListener(() => {
      // Try to reconnect
      setTimeout(setupConnection, 1000);
    });
  }

  /**
   * Also use chrome.devtools.network for additional request data
   */
  function setupHARListener() {
    if (chrome.devtools.network) {
      chrome.devtools.network.onRequestFinished.addListener((harEntry) => {
        // Enrich existing requests with HAR data (timing, size, etc.)
        enrichFromHAR(harEntry);
      });

      // Get existing requests
      chrome.devtools.network.getHAR((harLog) => {
        if (harLog && harLog.entries) {
          for (const entry of harLog.entries) {
            enrichFromHAR(entry);
          }
        }
      });
    }
  }

  function enrichFromHAR(harEntry) {
    if (!harEntry || !harEntry.request) return;

    const url = harEntry.request.url;
    const method = harEntry.request.method;

    // Find matching request in our store
    const existing = state.requests.find(r =>
      r.url === url && r.method === method && !r.harEnriched
    );

    if (existing) {
      existing.harEnriched = true;
      existing.timing = harEntry.timings;
      existing.totalTime = harEntry.time;

      if (harEntry.response) {
        existing.statusCode = existing.statusCode || harEntry.response.status;
        existing.responseSize = harEntry.response.bodySize;
        existing.responseMimeType = harEntry.response.content?.mimeType;

        // Try to get response body
        if (!existing.responseBody) {
          try {
            harEntry.getContent((body, encoding) => {
              if (body && body.length < 100000) {
                existing.responseBody = body;
              }
            });
          } catch { /* not available */ }
        }
      }

      renderRequestRow(existing);
    }
  }

  /**
   * Request all existing data from background
   */
  function requestAllData() {
    chrome.runtime.sendMessage(
      { type: 'GET_REQUESTS', targetTabId: state.tabId },
      (response) => {
        if (response && response.requests) {
          state.requests = response.requests;
          applyFilters();
          renderRequestTable();
          updateRequestCount();
        }
      }
    );
  }

  // ========================================================================
  // REQUEST HANDLING
  // ========================================================================

  function handleRequestUpdate(data) {
    if (!data || !data.id) return;
    if (data.tabId !== undefined && data.tabId !== state.tabId) return;

    const idx = state.requests.findIndex(r => r.id === data.id);
    if (idx >= 0) {
      state.requests[idx] = { ...state.requests[idx], ...data };
    } else {
      state.requests.push(data);
    }

    applyFilters();
    updateRequestCount();

    // Only render the single row if possible, otherwise full render
    const filteredIdx = state.filteredRequests.findIndex(r => r.id === data.id);
    if (filteredIdx >= 0) {
      renderRequestRow(state.filteredRequests[filteredIdx], filteredIdx);
    } else {
      // Maybe just filtered out, no need to render
    }

    // Update detail if this request is selected
    if (state.selectedRequestId === data.id) {
      showRequestDetail(data);
    }

    // Auto-scroll
    if (state.autoScroll && idx < 0) {
      const container = document.getElementById('request-table-container');
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    }
  }

  // ========================================================================
  // FILTERING & SORTING
  // ========================================================================

  function applyFilters() {
    let results = [...state.requests];

    // Filter by tab
    results = results.filter(r => r.tabId === state.tabId || r.tabId === undefined);

    // Method filter
    if (state.filters.method !== 'all') {
      if (state.filters.method === 'OTHER') {
        const knownMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'];
        results = results.filter(r => !knownMethods.includes(r.method));
      } else {
        results = results.filter(r => r.method === state.filters.method);
      }
    }

    // Status filter
    if (state.filters.status !== 'all') {
      results = results.filter(r => {
        if (!r.statusCode) return false;
        const s = String(r.statusCode);
        switch (state.filters.status) {
          case '2xx': return s.startsWith('2');
          case '3xx': return s.startsWith('3');
          case '4xx': return s.startsWith('4');
          case '5xx': return s.startsWith('5');
          default: return true;
        }
      });
    }

    // Type filter
    if (state.filters.type !== 'all') {
      results = results.filter(r => r.type === state.filters.type);
    }

    // Domain filter
    if (state.filters.domain) {
      const domain = state.filters.domain.toLowerCase();
      results = results.filter(r => {
        try {
          return new URL(r.url).hostname.toLowerCase().includes(domain);
        } catch {
          return false;
        }
      });
    }

    // Search filter
    if (state.filters.search) {
      const search = state.filters.search.toLowerCase();
      results = results.filter(r =>
        (r.url && r.url.toLowerCase().includes(search)) ||
        (r.method && r.method.toLowerCase().includes(search)) ||
        (r.type && r.type.toLowerCase().includes(search)) ||
        (r.statusCode && String(r.statusCode).includes(search))
      );
    }

    // Sort
    if (state.sortField) {
      results.sort((a, b) => {
        let va = a[state.sortField] ?? '';
        let vb = b[state.sortField] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') {
          return state.sortDirection === 'asc' ? va - vb : vb - va;
        }
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
        if (va < vb) return state.sortDirection === 'asc' ? -1 : 1;
        if (va > vb) return state.sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Calculate max waterfall duration
    state.maxWaterfallDuration = Math.max(
      1,
      ...results.map(r => r.duration || r.totalTime || 0)
    );

    state.filteredRequests = results;
  }

  // ========================================================================
  // RENDERING - REQUEST TABLE
  // ========================================================================

  function renderRequestTable() {
    const tbody = document.getElementById('request-tbody');
    const emptyState = document.getElementById('empty-state');

    if (state.filteredRequests.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    // Use document fragment for performance
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < state.filteredRequests.length; i++) {
      const row = createRequestRow(state.filteredRequests[i], i);
      fragment.appendChild(row);
    }

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function createRequestRow(req, index) {
    const tr = document.createElement('tr');
    tr.dataset.requestId = req.id;
    tr.className = 'row-enter';

    if (req.id === state.selectedRequestId) {
      tr.classList.add('selected');
    }
    if (req.error) {
      tr.classList.add('error');
    }
    if (req.statusCode >= 300 && req.statusCode < 400) {
      tr.classList.add('redirect');
    }

    // Status
    const statusClass = RequestFormatter.getStatusColorClass(req.statusCode);
    const statusText = req.statusCode || (req.error ? 'ERR' : '...');

    // Method
    const methodClass = RequestFormatter.getMethodColorClass(req.method || 'GET');

    // URL
    const urlInfo = RequestFormatter.parseUrl(req.url || '');
    const urlShort = RequestFormatter.getUrlShortName(req.url || '');

    // Type icon
    const typeIcon = RequestFormatter.getTypeIcon(req.type);

    // Duration
    const duration = req.duration || req.totalTime;
    const durationText = RequestFormatter.formatDuration(duration);

    // Size
    const sizeText = RequestFormatter.formatSize(req.responseSize);

    // Waterfall
    const waterfallPct = duration
      ? Math.max(2, Math.min(100, (duration / state.maxWaterfallDuration) * 100))
      : 0;
    const waterfallClass = duration < 200 ? 'fast' : duration < 1000 ? 'medium' : 'slow';

    // Redirect badge
    const hasRedirects = (req.redirects && req.redirects.length > 0) || req.redirectChainId;
    const redirectBadge = hasRedirects
      ? `<span class="url-redirect-badge">↪ ${req.redirects?.length || 1}</span>`
      : '';

    tr.innerHTML = `
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td><span class="method-badge ${methodClass}">${req.method || 'GET'}</span></td>
      <td title="${escapeHtml(req.url || '')}">
        <div class="url-cell">
          ${redirectBadge}
          <span class="url-path">${escapeHtml(urlShort)}</span>
        </div>
      </td>
      <td><span class="type-badge">${typeIcon} ${req.type || ''}</span></td>
      <td>${sizeText}</td>
      <td>${durationText}</td>
      <td>
        <div class="waterfall-bar" style="background: var(--bg-tertiary);">
          <div class="waterfall-fill ${waterfallClass}" style="width: ${waterfallPct}%;"></div>
        </div>
      </td>
    `;

    tr.addEventListener('click', () => {
      selectRequest(req.id);
    });

    return tr;
  }

  function renderRequestRow(req, index) {
    const tbody = document.getElementById('request-tbody');
    if (!tbody) return;

    const existingRow = tbody.querySelector(`tr[data-request-id="${req.id}"]`);
    if (existingRow) {
      const idx = state.filteredRequests.findIndex(r => r.id === req.id);
      const newRow = createRequestRow(req, idx);
      existingRow.replaceWith(newRow);
    } else {
      // New row — append
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.style.display = 'none';
      const newRow = createRequestRow(req, state.filteredRequests.length - 1);
      tbody.appendChild(newRow);
    }
  }

  function updateRequestCount() {
    const el = document.getElementById('request-count-value');
    if (el) el.textContent = state.filteredRequests.length;
  }

  // ========================================================================
  // RENDERING - REQUEST DETAIL
  // ========================================================================

  function selectRequest(requestId) {
    state.selectedRequestId = requestId;

    // Highlight row
    const tbody = document.getElementById('request-tbody');
    if (tbody) {
      tbody.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
      const row = tbody.querySelector(`tr[data-request-id="${requestId}"]`);
      if (row) row.classList.add('selected');
    }

    // Find request data
    const req = state.requests.find(r => r.id === requestId);
    if (req) {
      showRequestDetail(req);
    }
  }

  function showRequestDetail(req) {
    const panel = document.getElementById('detail-panel');
    const resizeHandle = document.getElementById('resize-handle');

    panel.classList.remove('hidden');
    resizeHandle.classList.remove('hidden');
    document.body.classList.add('detail-open');

    // Header
    const methodColor = RequestFormatter.getMethodColorClass(req.method);
    document.getElementById('detail-method').className = `detail-method method-badge ${methodColor}`;
    document.getElementById('detail-method').textContent = req.method || 'GET';
    document.getElementById('detail-url').textContent = req.url || '';

    // Position resize handle
    const detailWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--detail-width'));
    resizeHandle.style.right = `${detailWidth}px`;

    // Render tabs content
    renderGeneralInfo(req);
    renderRequestHeaders(req);
    renderResponseHeaders(req);
    renderPayload(req);
    renderResponse(req);
    renderCookies(req);
    renderSession(req);
    renderTiming(req);
  }

  function hideDetail() {
    document.getElementById('detail-panel').classList.add('hidden');
    document.getElementById('resize-handle').classList.add('hidden');
    document.body.classList.remove('detail-open');
    state.selectedRequestId = null;

    const tbody = document.getElementById('request-tbody');
    if (tbody) {
      tbody.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
    }
  }

  function renderGeneralInfo(req) {
    const table = document.getElementById('general-info-table');
    const rows = [
      ['Request URL', req.url],
      ['Request Method', req.method],
      ['Status Code', `${req.statusCode || '(pending)'} ${req.statusLine || ''}`],
      ['Type', req.type || '-'],
      ['Initiator', req.initiator || '-'],
      ['From Cache', req.fromCache ? 'Yes' : 'No'],
    ];

    if (req.error) {
      rows.push(['Error', req.error]);
    }
    if (req.redirectChainId) {
      rows.push(['Redirect Chain', req.redirectChainId]);
    }
    if (req.jsRedirectMethod) {
      rows.push(['JS Redirect Method', req.jsRedirectMethod]);
      rows.push(['Redirect From', req.jsRedirectFrom]);
    }
    if (req.metaRedirectFrom) {
      rows.push(['Meta Redirect From', req.metaRedirectFrom]);
      rows.push(['Meta Delay', `${req.metaDelay}s`]);
    }

    table.innerHTML = rows.map(([name, value]) => `
      <tr>
        <td class="header-name">${escapeHtml(name)}</td>
        <td class="header-value">${escapeHtml(String(value || '-'))}</td>
      </tr>
    `).join('');
  }

  function renderRequestHeaders(req) {
    const table = document.getElementById('request-headers-table');
    const headers = RequestFormatter.formatHeaders(req.requestHeaders || req.sentHeaders);

    if (headers.length === 0) {
      table.innerHTML = '<tr><td colspan="2" style="color: var(--text-tertiary);">No request headers captured</td></tr>';
      return;
    }

    table.innerHTML = headers.map(h => {
      const cat = RequestFormatter.categorizeHeader(h.name);
      const valueClass = cat === 'auth' ? 'header-value auth' : 'header-value';
      return `
        <tr>
          <td class="header-name">${escapeHtml(h.name)}</td>
          <td class="${valueClass}">${escapeHtml(h.value)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderResponseHeaders(req) {
    const table = document.getElementById('response-headers-table');
    const headers = RequestFormatter.formatHeaders(req.responseHeaders);

    if (headers.length === 0) {
      table.innerHTML = '<tr><td colspan="2" style="color: var(--text-tertiary);">No response headers captured</td></tr>';
      return;
    }

    table.innerHTML = headers.map(h => {
      const cat = RequestFormatter.categorizeHeader(h.name);
      const valueClass = cat === 'auth' ? 'header-value auth' : 'header-value';
      return `
        <tr>
          <td class="header-name">${escapeHtml(h.name)}</td>
          <td class="${valueClass}">${escapeHtml(h.value)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderPayload(req) {
    const payloadEl = document.getElementById('payload-content');
    const queryTable = document.getElementById('query-params-table');

    // Request body
    if (req.requestBody) {
      const contentType = getHeaderValue(req.requestHeaders, 'content-type');
      const formatted = RequestFormatter.formatBody(req.requestBody, contentType);

      if (formatted) {
        if (formatted.type === 'json') {
          payloadEl.textContent = formatted.formatted;
        } else if (formatted.type === 'form') {
          payloadEl.innerHTML = Object.entries(formatted.parsed).map(([k, v]) =>
            `<span style="color: var(--accent-purple);">${escapeHtml(k)}</span>: <span>${escapeHtml(String(v))}</span>`
          ).join('\n');
        } else {
          payloadEl.textContent = formatted.raw || '';
        }
      } else {
        payloadEl.textContent = 'No request body';
      }
    } else {
      payloadEl.textContent = 'No request body';
    }

    // Query parameters
    const urlInfo = RequestFormatter.parseUrl(req.url || '');
    const params = urlInfo.queryParams;

    if (params && Object.keys(params).length > 0) {
      queryTable.innerHTML = Object.entries(params).map(([k, v]) => `
        <tr>
          <td class="header-name">${escapeHtml(k)}</td>
          <td class="header-value">${escapeHtml(v)}</td>
        </tr>
      `).join('');
    } else {
      queryTable.innerHTML = '<tr><td colspan="2" style="color: var(--text-tertiary);">No query parameters</td></tr>';
    }
  }

  function renderResponse(req) {
    const el = document.getElementById('response-content');

    if (req.responseBody) {
      // Try to pretty-print JSON
      try {
        const parsed = JSON.parse(req.responseBody);
        el.textContent = JSON.stringify(parsed, null, 2);
      } catch {
        el.textContent = req.responseBody;
      }
    } else {
      el.textContent = 'Response body not captured.\n\nNote: Response bodies are captured from injected fetch/XHR interceptors.\nSome requests (images, scripts, etc.) may not have body data.';
      el.style.color = 'var(--text-tertiary)';
    }
  }

  function renderCookies(req) {
    const requestCookiesTable = document.getElementById('request-cookies-table');
    const setCookieList = document.getElementById('set-cookie-list');

    // Request cookies
    const cookieHeader = getHeaderValue(req.requestHeaders, 'cookie');
    if (cookieHeader) {
      const cookies = RequestFormatter.extractSessionInfo(
        [{ name: 'Cookie', value: cookieHeader }]
      ).cookies;

      requestCookiesTable.innerHTML = Object.entries(cookies).map(([k, v]) => `
        <tr>
          <td class="header-name">${escapeHtml(k)}</td>
          <td class="header-value">${escapeHtml(v)}</td>
        </tr>
      `).join('');
    } else {
      requestCookiesTable.innerHTML = '<tr><td colspan="2" style="color: var(--text-tertiary);">No cookies sent</td></tr>';
    }

    // Set-Cookie headers
    const headers = RequestFormatter.formatHeaders(req.responseHeaders);
    const setCookies = headers.filter(h => h.name.toLowerCase() === 'set-cookie');

    if (setCookies.length > 0) {
      setCookieList.innerHTML = setCookies.map(h =>
        `<div class="code-block" style="margin-bottom: 8px; font-size: 11px;">${escapeHtml(h.value)}</div>`
      ).join('');
    } else {
      setCookieList.innerHTML = '<p style="color: var(--text-tertiary); font-size: 12px;">No Set-Cookie headers</p>';
    }
  }

  function renderSession(req) {
    const authEl = document.getElementById('auth-info');
    const jwtEl = document.getElementById('jwt-info');

    const sessionInfo = RequestFormatter.extractSessionInfo(req.requestHeaders);

    if (sessionInfo.authorization) {
      authEl.innerHTML = `
        <div class="auth-badge">
          🔑 ${escapeHtml(sessionInfo.authorization.type)}
        </div>
        <div class="code-block" style="margin-top: 8px; font-size: 11px;">
          ${escapeHtml(sessionInfo.authorization.token)}
        </div>
      `;

      if (sessionInfo.authorization.jwtPayload) {
        jwtEl.textContent = JSON.stringify(sessionInfo.authorization.jwtPayload, null, 2);
        jwtEl.style.display = 'block';
      } else {
        jwtEl.textContent = 'Not a JWT token or could not decode.';
        jwtEl.style.color = 'var(--text-tertiary)';
      }
    } else {
      authEl.innerHTML = '<p style="color: var(--text-tertiary); font-size: 12px;">No Authorization header found</p>';
      jwtEl.textContent = '';
    }

    // Copy session button
    document.getElementById('btn-copy-session').onclick = () => {
      const sessionData = {
        url: req.url,
        method: req.method,
        authorization: sessionInfo.authorization,
        cookies: sessionInfo.cookies,
      };
      copyToClipboard(JSON.stringify(sessionData, null, 2));
      showToast('Session info copied!', 'success');
    };

    // Copy as cURL button
    document.getElementById('btn-copy-curl').onclick = () => {
      const curl = ExportUtils.toCurl(req);
      copyToClipboard(curl);
      showToast('cURL command copied!', 'success');
    };
  }

  function renderTiming(req) {
    const el = document.getElementById('timing-info');

    const duration = req.duration || req.totalTime;

    if (req.timing) {
      const timings = req.timing;
      const total = duration || Object.values(timings).reduce((s, v) => s + Math.max(0, v), 0);

      const phases = [
        { name: 'DNS Lookup', value: timings.dns, color: 'var(--accent-cyan)' },
        { name: 'TCP Connect', value: timings.connect, color: 'var(--accent-green)' },
        { name: 'TLS/SSL', value: timings.ssl, color: 'var(--accent-purple)' },
        { name: 'Request Sent', value: timings.send, color: 'var(--accent-blue)' },
        { name: 'Waiting (TTFB)', value: timings.wait, color: 'var(--accent-yellow)' },
        { name: 'Content Download', value: timings.receive, color: 'var(--accent-orange)' },
      ];

      el.innerHTML = phases.map(p => {
        const ms = Math.max(0, p.value || 0);
        const pct = total ? (ms / total) * 100 : 0;
        return `
          <div class="timing-bar-container">
            <div class="timing-label">
              <span>${p.name}</span>
              <span>${RequestFormatter.formatDuration(ms)}</span>
            </div>
            <div class="timing-bar">
              <div class="timing-bar-fill" style="width: ${Math.max(1, pct)}%; background: ${p.color};"></div>
            </div>
          </div>
        `;
      }).join('') + `
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-default);">
          <div class="timing-label" style="font-weight: 600;">
            <span>Total</span>
            <span>${RequestFormatter.formatDuration(total)}</span>
          </div>
        </div>
      `;
    } else if (duration) {
      el.innerHTML = `
        <div class="timing-bar-container">
          <div class="timing-label">
            <span>Total Duration</span>
            <span>${RequestFormatter.formatDuration(duration)}</span>
          </div>
          <div class="timing-bar">
            <div class="timing-bar-fill" style="width: 100%; background: var(--accent-blue);"></div>
          </div>
        </div>
        <p style="color: var(--text-tertiary); font-size: 11px; margin-top: 8px;">
          Detailed timing breakdown not available for this request.
        </p>
      `;
    } else {
      el.innerHTML = '<p style="color: var(--text-tertiary); font-size: 12px;">No timing data available</p>';
    }
  }

  // ========================================================================
  // RENDERING - REDIRECT CHAINS
  // ========================================================================

  function refreshRedirectChains() {
    chrome.runtime.sendMessage(
      { type: 'GET_REDIRECT_CHAINS', targetTabId: state.tabId },
      (response) => {
        if (response && response.chains) {
          renderRedirectChains(response.chains);
        }
      }
    );
  }

  function renderRedirectChains(chains) {
    const container = document.getElementById('redirect-chains-list');
    const emptyState = document.getElementById('redirect-empty');

    if (!chains || chains.length === 0) {
      container.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    container.innerHTML = chains.map(chain => {
      const stepsHtml = chain.steps.map((step, i) => {
        const isLast = i === chain.steps.length - 1;
        let typeLabel, indicatorClass, details;

        if (step.type === 'http') {
          typeLabel = `HTTP ${step.statusCode} Redirect`;
          indicatorClass = 'http';
          details = `
            <div class="step-from"><span>FROM:</span> ${escapeHtml(step.from)}</div>
            <div class="step-arrow">↓</div>
            <div class="step-to"><span>TO:</span> ${escapeHtml(step.to)}</div>
          `;
        } else if (step.type === 'js') {
          typeLabel = `JS Redirect (${step.method})`;
          indicatorClass = 'js';
          details = `
            <div class="step-from"><span>FROM:</span> ${escapeHtml(step.from)}</div>
            <div class="step-arrow">↓</div>
            <div class="step-to"><span>TO:</span> ${escapeHtml(step.to)}</div>
          `;
        } else if (step.type === 'meta') {
          typeLabel = `Meta Refresh (${step.delay}s delay)`;
          indicatorClass = 'meta';
          details = `
            <div class="step-from"><span>FROM:</span> ${escapeHtml(step.from)}</div>
            <div class="step-arrow">↓</div>
            <div class="step-to"><span>TO:</span> ${escapeHtml(step.to)}</div>
          `;
        }

        return `
          <div class="chain-step">
            <div class="step-indicator ${indicatorClass}">${i + 1}</div>
            <div class="step-content">
              <div class="step-type-label ${indicatorClass}">${typeLabel}</div>
              ${details}
            </div>
          </div>
        `;
      }).join('');

      // Final destination
      const lastStep = chain.steps[chain.steps.length - 1];
      const finalUrl = lastStep ? lastStep.to : 'Unknown';
      const finalStepHtml = `
        <div class="chain-step">
          <div class="step-indicator final">✓</div>
          <div class="step-content">
            <div class="step-type-label final">FINAL DESTINATION</div>
            <div class="step-to" style="color: var(--accent-green); font-weight: 500;">${escapeHtml(finalUrl)}</div>
          </div>
        </div>
      `;

      return `
        <div class="chain-card fade-in">
          <div class="chain-header">
            <div class="chain-title">
              <span>🔗</span>
              <span>${chain.id}</span>
            </div>
            <div class="chain-meta">
              <span>${chain.steps.length} step${chain.steps.length !== 1 ? 's' : ''}</span>
              <span>${RequestFormatter.formatTimestamp(chain.timestamp)}</span>
            </div>
          </div>
          <div class="chain-steps">
            ${stepsHtml}
            ${finalStepHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  // ========================================================================
  // RENDERING - TIMELINE VIEW
  // ========================================================================

  function renderTimeline() {
    const canvas = document.getElementById('timeline-canvas');
    const wrapper = document.getElementById('timeline-canvas-wrapper');
    const emptyState = document.getElementById('timeline-empty');

    if (state.filteredRequests.length === 0) {
      emptyState.style.display = 'flex';
      canvas.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const requests = state.filteredRequests.filter(r => r.timestamp);
    if (requests.length === 0) return;

    const rowHeight = 24;
    const leftPadding = 80;
    const rightPadding = 20;
    const topPadding = 40;

    const canvasWidth = wrapper.clientWidth;
    const canvasHeight = Math.max(300, topPadding + requests.length * rowHeight + 20);

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Time range
    const minTime = Math.min(...requests.map(r => r.timestamp));
    const maxTime = Math.max(...requests.map(r => (r.timestamp + (r.duration || r.totalTime || 100))));
    const timeRange = maxTime - minTime || 1;
    const timeWidth = canvasWidth - leftPadding - rightPadding;

    // Draw time axis
    ctx.fillStyle = '#8b949e';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';

    const numTicks = 8;
    for (let i = 0; i <= numTicks; i++) {
      const x = leftPadding + (i / numTicks) * timeWidth;
      const time = (i / numTicks) * timeRange;

      ctx.strokeStyle = '#21262d';
      ctx.beginPath();
      ctx.moveTo(x, topPadding - 10);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();

      ctx.fillStyle = '#6e7681';
      ctx.fillText(formatTimelineTime(time), x, topPadding - 16);
    }

    // Draw requests
    const methodColors = {
      GET: '#3fb950',
      POST: '#58a6ff',
      PUT: '#d29922',
      PATCH: '#db6d28',
      DELETE: '#f85149',
      OPTIONS: '#8b949e',
      JS_REDIRECT: '#f778ba',
      META_REDIRECT: '#39d2c0',
    };

    requests.forEach((req, i) => {
      const y = topPadding + i * rowHeight;
      const startX = leftPadding + ((req.timestamp - minTime) / timeRange) * timeWidth;
      const duration = req.duration || req.totalTime || 50;
      const width = Math.max(3, (duration / timeRange) * timeWidth);

      // Bar
      const color = methodColors[req.method] || '#8b949e';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.roundRect(startX, y + 3, width, rowHeight - 6, 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      ctx.fillStyle = '#e6edf3';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      const label = `${req.method} ${(req.url || '').split('?')[0].split('/').pop() || '/'}`;
      ctx.fillText(label.slice(0, 60), leftPadding - 75, y + rowHeight / 2 + 3.5, 70);
    });
  }

  function formatTimelineTime(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // ========================================================================
  // EVENT LISTENERS
  // ========================================================================

  function setupEventListeners() {
    // Clear button
    document.getElementById('btn-clear').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_TAB', targetTabId: state.tabId });
      state.requests = [];
      state.selectedRequestId = null;
      applyFilters();
      renderRequestTable();
      updateRequestCount();
      hideDetail();
      showToast('All requests cleared', 'info');
    });

    // Record toggle
    document.getElementById('btn-toggle-record').addEventListener('click', (e) => {
      state.recording = !state.recording;
      e.currentTarget.classList.toggle('active', state.recording);
      e.currentTarget.querySelector('.btn-label').textContent = state.recording ? 'Recording' : 'Paused';
      showToast(state.recording ? 'Recording resumed' : 'Recording paused', 'info');
    });

    // Preserve log
    document.getElementById('btn-preserve-log').addEventListener('click', (e) => {
      state.preserveLog = !state.preserveLog;
      e.currentTarget.classList.toggle('active', state.preserveLog);
      showToast(state.preserveLog ? 'Log will be preserved' : 'Log will clear on navigation', 'info');
    });

    // Search
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    let searchDebouncer;

    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebouncer);
      searchClear.style.display = searchInput.value ? 'block' : 'none';
      searchDebouncer = setTimeout(() => {
        state.filters.search = searchInput.value;
        applyFilters();
        renderRequestTable();
        updateRequestCount();
      }, 200);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      state.filters.search = '';
      applyFilters();
      renderRequestTable();
      updateRequestCount();
    });

    // View tabs
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        switchView(view);
      });
    });

    // Method filter pills
    document.getElementById('method-filters').addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;

      document.querySelectorAll('#method-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.filters.method = pill.dataset.method;
      applyFilters();
      renderRequestTable();
      updateRequestCount();
    });

    // Status filter pills
    document.getElementById('status-filters').addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;

      document.querySelectorAll('#status-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.filters.status = pill.dataset.status;
      applyFilters();
      renderRequestTable();
      updateRequestCount();
    });

    // Type filter pills
    document.getElementById('type-filters').addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;

      document.querySelectorAll('#type-filters .filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.filters.type = pill.dataset.type;
      applyFilters();
      renderRequestTable();
      updateRequestCount();
    });

    // Domain filter
    const domainInput = document.getElementById('domain-filter');
    let domainDebouncer;
    domainInput.addEventListener('input', () => {
      clearTimeout(domainDebouncer);
      domainDebouncer = setTimeout(() => {
        state.filters.domain = domainInput.value;
        applyFilters();
        renderRequestTable();
        updateRequestCount();
      }, 300);
    });

    // Table header sort
    document.querySelectorAll('#request-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (state.sortField === field) {
          state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortField = field;
          state.sortDirection = 'asc';
        }
        applyFilters();
        renderRequestTable();
      });
    });

    // Detail close
    document.getElementById('detail-close').addEventListener('click', hideDetail);

    // Detail tabs
    document.querySelectorAll('.detail-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        const content = document.getElementById(`tab-${tab.dataset.tab}`);
        if (content) content.classList.add('active');
      });
    });

    // Section collapse
    document.querySelectorAll('.section-header.collapsible').forEach(header => {
      header.addEventListener('click', () => {
        const targetId = header.dataset.target;
        const body = document.getElementById(targetId);
        if (body) {
          header.classList.toggle('collapsed');
          body.classList.toggle('collapsed');
        }
      });
    });

    // Export menu
    const exportBtn = document.getElementById('btn-export');
    const exportMenu = document.getElementById('export-menu');

    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      exportMenu.classList.remove('show');
    });

    exportMenu.querySelectorAll('button[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleExport(btn.dataset.export);
        exportMenu.classList.remove('show');
      });
    });

    // Resize handle for detail panel
    setupResizeHandle();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape to close detail
      if (e.key === 'Escape') {
        hideDetail();
      }
      // Ctrl+F to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput.focus();
      }
      // Ctrl+L to clear
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        document.getElementById('btn-clear').click();
      }
    });
  }

  // ========================================================================
  // VIEW SWITCHING
  // ========================================================================

  function switchView(view) {
    state.currentView = view;

    document.querySelectorAll('.view-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.view === view);
    });

    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${view}`);
    });

    if (view === 'redirects') {
      refreshRedirectChains();
    } else if (view === 'timeline') {
      setTimeout(renderTimeline, 50);
    }
  }

  // ========================================================================
  // EXPORT
  // ========================================================================

  function handleExport(format) {
    const requests = state.filteredRequests;

    if (requests.length === 0) {
      showToast('No requests to export', 'error');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    switch (format) {
      case 'json': {
        const json = ExportUtils.toJSON(requests);
        ExportUtils.downloadFile(json, `http-tracker-${timestamp}.json`);
        showToast(`Exported ${requests.length} requests as JSON`, 'success');
        break;
      }

      case 'curl': {
        const curls = requests
          .filter(r => r.url && r.method !== 'JS_REDIRECT' && r.method !== 'META_REDIRECT')
          .map(r => `# ${r.method} ${r.url}\n${ExportUtils.toCurl(r)}`)
          .join('\n\n---\n\n');
        ExportUtils.downloadFile(curls, `http-tracker-${timestamp}.sh`, 'text/plain');
        showToast(`Exported as cURL commands`, 'success');
        break;
      }

      case 'postman': {
        const collection = ExportUtils.toPostmanCollection(requests, `OmniFetch - ${timestamp}`);
        ExportUtils.downloadFile(collection, `http-tracker-${timestamp}.postman_collection.json`);
        showToast(`Exported as Postman Collection`, 'success');
        break;
      }

      case 'redirects': {
        chrome.runtime.sendMessage(
          { type: 'GET_REDIRECT_CHAINS', targetTabId: state.tabId },
          (response) => {
            if (response && response.chains && response.chains.length > 0) {
              const text = ExportUtils.toRedirectChainText(response.chains);
              ExportUtils.downloadFile(text, `redirect-chains-${timestamp}.txt`, 'text/plain');
              showToast(`Exported ${response.chains.length} redirect chains`, 'success');
            } else {
              showToast('No redirect chains to export', 'error');
            }
          }
        );
        break;
      }
    }
  }

  // ========================================================================
  // RESIZE HANDLE
  // ========================================================================

  function setupResizeHandle() {
    const handle = document.getElementById('resize-handle');
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      handle.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;

      const newWidth = Math.max(300, Math.min(800, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--detail-width', `${newWidth}px`);
      handle.style.right = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        handle.classList.remove('dragging');
      }
    });
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getHeaderValue(headers, name) {
    if (!headers) return null;
    const list = Array.isArray(headers) ? headers : Object.entries(headers).map(([k, v]) => ({ name: k, value: v }));
    const header = list.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : null;
  }

  function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 200ms ease forwards';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }

  // ========================================================================
  // INIT
  // ========================================================================

  document.addEventListener('DOMContentLoaded', init);
})();
