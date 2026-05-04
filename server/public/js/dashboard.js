/**
 * Dashboard Controller - Main admin panel logic
 */

(function () {
  'use strict';

  // Auth guard
  if (!api.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // State
  const state = {
    currentPage: 'overview',
    requestsPage: 1,
    requestsLimit: 50,
    filters: {},
    sort: 'captured_at',
    order: 'DESC',
    websites: [],
  };

  // ====================================================================
  // INIT
  // ====================================================================

  async function init() {
    // Verify token
    const user = await api.verifyToken();
    if (!user) {
      window.location.href = '/login.html';
      return;
    }

    // Set user name
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = user.name || user.email;

    setupNavigation();
    setupEventListeners();
    loadOverview();
  }

  // ====================================================================
  // NAVIGATION
  // ====================================================================

  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(item.dataset.page);
      });
    });

    document.querySelectorAll('[data-navigate]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.navigate);
      });
    });
  }

  function navigateTo(page) {
    state.currentPage = page;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });

    // Update pages
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update header
    const titles = {
      overview: ['Overview', 'Dashboard statistics and recent activity'],
      websites: ['Websites', 'All tracked websites and their request data'],
      requests: ['All Requests', 'Browse and filter all captured HTTP requests'],
      redirects: ['Redirects', 'Redirect chains captured from all websites'],
    };

    const [title, subtitle] = titles[page] || ['', ''];
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle;

    // Load data
    switch (page) {
      case 'overview': loadOverview(); break;
      case 'websites': loadWebsites(); break;
      case 'requests': loadRequests(); break;
      case 'redirects': loadRedirects(); break;
    }
  }

  // ====================================================================
  // OVERVIEW PAGE
  // ====================================================================

  async function loadOverview() {
    try {
      const stats = await api.get('/stats');

      document.getElementById('stat-websites').textContent = formatNumber(stats.totalWebsites);
      document.getElementById('stat-requests').textContent = formatNumber(stats.totalRequests);
      document.getElementById('stat-redirects').textContent = formatNumber(stats.totalRedirects);

      // Today's count
      const today = new Date().toISOString().split('T')[0];
      const todayData = stats.recentActivity.find(a => a.date.startsWith(today));
      document.getElementById('stat-today').textContent = formatNumber(todayData ? parseInt(todayData.count) : 0);

      // Load recent websites
      const websitesData = await api.get('/websites');
      const websites = websitesData.websites.slice(0, 8);

      const tbody = document.getElementById('recent-websites-tbody');
      const emptyEl = document.getElementById('overview-empty');

      if (websites.length === 0) {
        tbody.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      tbody.innerHTML = websites.map(w => `
        <tr data-website-id="${w.id}">
          <td>
            <span class="badge-domain">${escapeHtml(w.domain)}</span>
          </td>
          <td>${formatNumber(parseInt(w.actual_requests || w.request_count))}</td>
          <td class="time-text">${formatDate(w.last_seen)}</td>
          <td>
            <button class="btn-action" title="View requests" onclick="viewWebsiteRequests(${w.id})">📋</button>
            <button class="btn-action btn-danger" title="Delete" onclick="deleteWebsite(${w.id})">🗑️</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  }

  // ====================================================================
  // WEBSITES PAGE
  // ====================================================================

  async function loadWebsites(search = '') {
    try {
      const endpoint = search ? `/websites?search=${encodeURIComponent(search)}` : '/websites';
      const data = await api.get(endpoint);
      state.websites = data.websites;

      const tbody = document.getElementById('websites-tbody');

      if (data.websites.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-msg">No websites found</td></tr>`;
        return;
      }

      tbody.innerHTML = data.websites.map(w => `
        <tr>
          <td><span class="badge-domain">${escapeHtml(w.domain)}</span></td>
          <td><span class="badge badge-get">${w.get_count || 0}</span></td>
          <td><span class="badge badge-post">${w.post_count || 0}</span></td>
          <td><span class="badge badge-4xx">${w.error_count || 0}</span></td>
          <td>${w.redirect_count || 0}</td>
          <td><strong>${formatNumber(parseInt(w.actual_requests || w.request_count))}</strong></td>
          <td class="time-text">${formatDate(w.last_seen)}</td>
          <td>
            <button class="btn-action" title="View requests" onclick="viewWebsiteRequests(${w.id})">📋</button>
            <button class="btn-action btn-danger" title="Delete" onclick="deleteWebsite(${w.id})">🗑️</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load websites:', err);
    }
  }

  // ====================================================================
  // REQUESTS PAGE
  // ====================================================================

  async function loadRequests() {
    try {
      const params = new URLSearchParams();
      params.set('page', state.requestsPage);
      params.set('limit', state.requestsLimit);
      params.set('sort', state.sort);
      params.set('order', state.order);

      if (state.filters.method) params.set('method', state.filters.method);
      if (state.filters.status) params.set('status', state.filters.status);
      if (state.filters.website_id) params.set('website_id', state.filters.website_id);
      if (state.filters.search) params.set('search', state.filters.search);

      // Update sort UI indicators
      updateSortUI();

      const data = await api.get(`/requests?${params}`);
      const tbody = document.getElementById('requests-tbody');

      if (data.requests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-msg">No requests found</td></tr>`;
        renderPagination(data.pagination);
        return;
      }

      tbody.innerHTML = data.requests.map(r => {
        const methodBadge = getMethodBadge(r.method);
        const statusBadge = getStatusBadge(r.status_code);
        const urlShort = shortenUrl(r.url);

        return `
          <tr onclick="showRequestDetail(${r.id})">
            <td>${r.id}</td>
            <td>${methodBadge}</td>
            <td class="url-text" title="${escapeHtml(r.url)}">${escapeHtml(urlShort)}</td>
            <td>${statusBadge}</td>
            <td>${getTypeBadge(r.request_type, r.source)}</td>
            <td class="time-text">${r.duration_ms ? Math.round(r.duration_ms) + 'ms' : '-'}</td>
            <td><span class="badge-domain">${escapeHtml(r.domain || '-')}</span></td>
            <td class="time-text">${formatDate(r.captured_at)}</td>
            <td>
              <button class="btn-action" title="View detail" onclick="event.stopPropagation(); showRequestDetail(${r.id})">🔍</button>
              <button class="btn-action btn-danger" title="Delete" onclick="event.stopPropagation(); deleteRequest(${r.id})">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');

      renderPagination(data.pagination);

      // Populate website filter
      await populateWebsiteFilter();
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  }

  function renderPagination(pagination) {
    const el = document.getElementById('requests-pagination');
    if (!pagination || pagination.totalPages <= 1) {
      el.innerHTML = `<span class="page-info">${pagination?.total || 0} total</span>`;
      return;
    }

    let html = '';
    html += `<button ${pagination.page <= 1 ? 'disabled' : ''} onclick="goToPage(${pagination.page - 1})">← Prev</button>`;

    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);

    for (let i = start; i <= end; i++) {
      html += `<button class="${i === pagination.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    html += `<button ${pagination.page >= pagination.totalPages ? 'disabled' : ''} onclick="goToPage(${pagination.page + 1})">Next →</button>`;
    html += `<span class="page-info">${pagination.total} total</span>`;

    el.innerHTML = html;
  }

  async function populateWebsiteFilter() {
    const select = document.getElementById('req-filter-website');
    if (select.options.length > 1) return; // Already populated

    try {
      const data = await api.get('/websites');
      for (const w of data.websites) {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.domain;
        select.appendChild(opt);
      }
    } catch { /* ignore */ }
  }

  // ====================================================================
  // REDIRECTS PAGE
  // ====================================================================

  async function loadRedirects() {
    try {
      const data = await api.get('/redirects');
      const container = document.getElementById('redirects-container');

      if (!data.chains || data.chains.length === 0) {
        container.innerHTML = '<div class="empty-msg"><p>No redirect chains captured yet.</p></div>';
        return;
      }

      container.innerHTML = data.chains.map(chain => {
        const stepsHtml = chain.steps.map((step, i) => `
          <div class="chain-step-admin">
            <div class="step-num ${step.redirect_type}">${i + 1}</div>
            <div class="step-detail">
              <div class="step-label ${step.redirect_type}">
                ${step.redirect_type === 'http' ? `HTTP ${step.status_code}` :
                  step.redirect_type === 'js' ? `JS (${step.method || 'unknown'})` :
                  `Meta Refresh (${step.delay_seconds || 0}s)`}
              </div>
              <div>FROM: ${escapeHtml(step.from_url || '-')}</div>
              <div>→ TO: ${escapeHtml(step.to_url || '-')}</div>
            </div>
          </div>
        `).join('');

        return `
          <div class="chain-card-admin">
            <div class="chain-header-admin">
              <span class="chain-id">🔗 Chain #${chain.id}</span>
              <span class="chain-meta">${chain.step_count} steps • ${escapeHtml(chain.domain || '')} • ${formatDate(chain.captured_at)}</span>
            </div>
            ${stepsHtml}
            <div class="chain-step-admin">
              <div class="step-num" style="background:rgba(63,185,80,.15);color:var(--green);border:1px solid var(--green);">✓</div>
              <div class="step-detail">
                <div class="step-label" style="color:var(--green);">FINAL</div>
                <div style="color:var(--green);font-weight:600;">${escapeHtml(chain.final_url || '-')}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load redirects:', err);
    }
  }

  // ====================================================================
  // REQUEST DETAIL MODAL
  // ====================================================================

  window.showRequestDetail = async function (id) {
    try {
      const data = await api.get(`/requests/${id}`);
      const req = data.request;

      document.getElementById('modal-title').textContent = `${req.method} ${shortenUrl(req.url)}`;

      // General tab
      const generalRows = [
        ['URL', req.url],
        ['Method', req.method],
        ['Status', `${req.status_code || 'pending'} ${req.status_line || ''}`],
        ['Type', req.request_type || '-'],
        ['Domain', req.domain || '-'],
        ['Initiator', req.initiator || '-'],
        ['Duration', req.duration_ms ? `${Math.round(req.duration_ms)}ms` : '-'],
        ['Cached', req.from_cache ? 'Yes' : 'No'],
        ['Source', req.source || '-'],
        ['Captured', formatDate(req.captured_at)],
      ];

      document.getElementById('modal-general-table').innerHTML = generalRows.map(([k, v]) =>
        `<tr><td class="dt-key">${k}</td><td class="dt-val">${escapeHtml(String(v || '-'))}</td></tr>`
      ).join('');

      // Headers
      renderHeaderTable('modal-req-headers', req.request_headers);
      renderHeaderTable('modal-res-headers', req.response_headers);

      // Payload
      const payloadEl = document.getElementById('modal-payload');
      if (req.request_body) {
        try {
          payloadEl.textContent = JSON.stringify(JSON.parse(req.request_body), null, 2);
        } catch {
          payloadEl.textContent = req.request_body;
        }
      } else {
        payloadEl.textContent = 'No request body';
      }

      // Response
      const responseEl = document.getElementById('modal-response');
      if (req.response_body) {
        try {
          responseEl.textContent = JSON.stringify(JSON.parse(req.response_body), null, 2);
        } catch {
          responseEl.textContent = req.response_body;
        }
      } else {
        responseEl.textContent = 'Response body not captured';
      }

      // Export Postman (single)
      document.getElementById('modal-export-postman').onclick = () => {
        const collection = buildPostmanCollection([req], `${req.method} ${shortenUrl(req.url)}`);
        downloadFile(`postman_${req.id}.json`, JSON.stringify(collection, null, 2));
      };

      // Copy cURL
      document.getElementById('modal-copy-curl').onclick = () => {
        const curl = buildCurl(req);
        copyToClipboard(curl);
        showToast('cURL copied to clipboard!');
      };

      // Copy JSON
      document.getElementById('modal-copy-json').onclick = () => {
        copyToClipboard(JSON.stringify(req, null, 2));
        showToast('JSON copied to clipboard!');
      };

      // Delete
      document.getElementById('modal-delete').onclick = async () => {
        if (confirm('Delete this request?')) {
          await api.delete(`/requests/${id}`);
          closeModal();
          loadRequests();
        }
      };

      // Show modal
      document.getElementById('detail-modal').classList.remove('hidden');

      // Reset tabs
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.m-tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelector('.modal-tab[data-tab="m-general"]').classList.add('active');
      document.getElementById('m-general').classList.add('active');
    } catch (err) {
      console.error('Failed to load request detail:', err);
    }
  };

  function renderHeaderTable(tableId, headers) {
    const table = document.getElementById(tableId);
    if (!headers || typeof headers !== 'object') {
      table.innerHTML = '<tr><td colspan="2" style="color: var(--text-4);">No headers</td></tr>';
      return;
    }

    const entries = Array.isArray(headers)
      ? headers.map(h => [h.name, h.value])
      : Object.entries(headers);

    if (entries.length === 0) {
      table.innerHTML = '<tr><td colspan="2" style="color: var(--text-4);">No headers</td></tr>';
      return;
    }

    table.innerHTML = entries.map(([k, v]) =>
      `<tr><td class="dt-key">${escapeHtml(k)}</td><td class="dt-val">${escapeHtml(String(v))}</td></tr>`
    ).join('');
  }

  function closeModal() {
    document.getElementById('detail-modal').classList.add('hidden');
  }

  // ====================================================================
  // GLOBAL ACTIONS
  // ====================================================================

  window.viewWebsiteRequests = function (websiteId) {
    state.filters.website_id = websiteId;
    state.requestsPage = 1;

    // Set filter dropdown
    const select = document.getElementById('req-filter-website');
    select.value = websiteId;

    navigateTo('requests');
  };

  window.deleteWebsite = async function (id) {
    if (!confirm('Delete this website and ALL its requests?')) return;
    try {
      await api.delete(`/websites/${id}`);
      // Reload current page
      if (state.currentPage === 'overview') loadOverview();
      else if (state.currentPage === 'websites') loadWebsites();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  window.deleteRequest = async function (id) {
    if (!confirm('Delete this request?')) return;
    try {
      await api.delete(`/requests/${id}`);
      loadRequests();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  window.goToPage = function (page) {
    state.requestsPage = page;
    loadRequests();
  };

  // ====================================================================
  // EVENT LISTENERS
  // ====================================================================

  function setupEventListeners() {
    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      api.clearAuth();
      window.location.href = '/login.html';
    });

    // Close modal
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Modal tabs
    document.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.m-tab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Website search
    const websiteSearch = document.getElementById('website-search');
    let wsDebounce;
    websiteSearch?.addEventListener('input', () => {
      clearTimeout(wsDebounce);
      wsDebounce = setTimeout(() => loadWebsites(websiteSearch.value), 300);
    });

    // Request filters
    document.getElementById('req-filter-apply')?.addEventListener('click', () => {
      state.filters.method = document.getElementById('req-filter-method').value;
      state.filters.status = document.getElementById('req-filter-status').value;
      state.filters.website_id = document.getElementById('req-filter-website').value;
      state.filters.search = document.getElementById('req-filter-search').value;
      state.requestsPage = 1;
      loadRequests();
    });

    document.getElementById('req-filter-clear')?.addEventListener('click', () => {
      state.filters = {};
      document.getElementById('req-filter-method').value = '';
      document.getElementById('req-filter-status').value = '';
      document.getElementById('req-filter-website').value = '';
      document.getElementById('req-filter-search').value = '';
      state.requestsPage = 1;
      loadRequests();
    });

    // Global search
    const globalSearch = document.getElementById('global-search');
    let gsDebounce;
    globalSearch?.addEventListener('input', () => {
      clearTimeout(gsDebounce);
      gsDebounce = setTimeout(() => {
        state.filters.search = globalSearch.value;
        state.requestsPage = 1;
        navigateTo('requests');
      }, 400);
    });

    // Bulk export buttons
    document.getElementById('btn-export-postman')?.addEventListener('click', exportAllPostman);
    document.getElementById('btn-export-json')?.addEventListener('click', exportAllJSON);
    document.getElementById('btn-export-curl')?.addEventListener('click', exportAllCurl);

    // Sort controls
    document.getElementById('req-sort-field')?.addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.requestsPage = 1;
      loadRequests();
    });

    document.getElementById('req-sort-order')?.addEventListener('click', () => {
      state.order = state.order === 'DESC' ? 'ASC' : 'DESC';
      state.requestsPage = 1;
      loadRequests();
    });
  }

  // ====================================================================
  // SORT HELPERS
  // ====================================================================

  // Called from table header clicks
  window.sortColumn = function (field) {
    if (state.sort === field) {
      state.order = state.order === 'DESC' ? 'ASC' : 'DESC';
    } else {
      state.sort = field;
      state.order = 'DESC';
    }
    // Sync the dropdown
    const sortField = document.getElementById('req-sort-field');
    if (sortField) sortField.value = state.sort;
    state.requestsPage = 1;
    loadRequests();
  };

  function updateSortUI() {
    // Update order button text
    const orderBtn = document.getElementById('req-sort-order');
    if (orderBtn) {
      orderBtn.textContent = state.order === 'DESC' ? '↓ Newest' : '↑ Oldest';
    }
    // Update sort dropdown
    const sortField = document.getElementById('req-sort-field');
    if (sortField) sortField.value = state.sort;

    // Update table header indicators
    document.querySelectorAll('.sortable-th').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === state.sort) {
        th.classList.add(state.order === 'ASC' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  // ====================================================================
  // UTILITIES
  // ====================================================================

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(n) {
    if (n === undefined || n === null) return '0';
    return new Intl.NumberFormat().format(n);
  }

  function formatDate(d) {
    if (!d) return '-';
    const date = new Date(d);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function shortenUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      let path = parsed.pathname;
      if (path.length > 50) path = '...' + path.slice(-47);
      return `${parsed.hostname}${path}`;
    } catch {
      return url.slice(0, 80);
    }
  }

  function getMethodBadge(method) {
    const cls = {
      GET: 'badge-get',
      POST: 'badge-post',
      PUT: 'badge-put',
      DELETE: 'badge-delete',
    }[method] || 'badge-other';
    return `<span class="badge ${cls}">${method || '-'}</span>`;
  }

  function getStatusBadge(status) {
    if (!status) return `<span class="badge badge-other">-</span>`;
    let cls = 'badge-other';
    if (status >= 200 && status < 300) cls = 'badge-2xx';
    else if (status >= 300 && status < 400) cls = 'badge-3xx';
    else if (status >= 400 && status < 500) cls = 'badge-4xx';
    else if (status >= 500) cls = 'badge-5xx';
    return `<span class="badge ${cls}">${status}</span>`;
  }

  function getTypeBadge(type, source) {
    if (type === 'form-submit' || source === 'form') {
      return '<span class="badge badge-form">📝 FORM</span>';
    }
    if (source === 'injected' && (type === 'fetch' || type === 'xhr')) {
      return `<span class="badge badge-source-injected">${type}</span>`;
    }
    return `<span class="badge badge-other">${type || '-'}</span>`;
  }

  function buildCurl(req) {
    const parts = ['curl'];
    if (req.method && req.method !== 'GET') parts.push(`-X ${req.method}`);
    parts.push(`'${req.url}'`);

    if (req.request_headers && typeof req.request_headers === 'object') {
      const entries = Array.isArray(req.request_headers)
        ? req.request_headers.map(h => [h.name, h.value])
        : Object.entries(req.request_headers);
      for (const [k, v] of entries) {
        parts.push(`-H '${k}: ${v}'`);
      }
    }

    if (req.request_body) {
      parts.push(`-d '${req.request_body.replace(/'/g, "\\'")}'`);
    }

    parts.push('-L -i');
    return parts.join(' \\\n  ');
  }

  // ====================================================================
  // POSTMAN COLLECTION BUILDER
  // ====================================================================

  function buildPostmanCollection(requests, name) {
    // Group by domain
    const groups = {};
    for (const req of requests) {
      const domain = req.domain || 'unknown';
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(req);
    }

    const folders = Object.entries(groups).map(([domain, reqs]) => ({
      name: domain,
      item: reqs.map(req => buildPostmanItem(req)),
    }));

    return {
      info: {
        name: name || `HTTP Tracker Export - ${new Date().toISOString().slice(0, 16)}`,
        description: `Exported ${requests.length} requests from OmniFetch by BungsuDev`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: folders.length === 1 ? folders[0].item : folders,
    };
  }

  function buildPostmanItem(req) {
    // Parse URL
    let urlObj;
    try { urlObj = new URL(req.url); } catch { urlObj = null; }

    // Parse headers
    const headerEntries = parseHeaders(req.request_headers);

    // Build Postman URL object
    const postmanUrl = urlObj ? {
      raw: req.url,
      protocol: urlObj.protocol.replace(':', ''),
      host: urlObj.hostname.split('.'),
      port: urlObj.port || '',
      path: urlObj.pathname.split('/').filter(Boolean),
      query: Array.from(urlObj.searchParams.entries()).map(([k, v]) => ({
        key: k, value: v,
      })),
    } : { raw: req.url };

    // Build body
    let body = undefined;
    if (req.request_body) {
      const contentType = headerEntries.find(([k]) => k.toLowerCase() === 'content-type');
      const ct = contentType ? contentType[1] : '';

      if (ct.includes('application/json')) {
        body = {
          mode: 'raw',
          raw: typeof req.request_body === 'string' ? req.request_body : JSON.stringify(req.request_body),
          options: { raw: { language: 'json' } },
        };
      } else if (ct.includes('x-www-form-urlencoded')) {
        body = {
          mode: 'urlencoded',
          urlencoded: parseFormBody(req.request_body),
        };
      } else {
        body = {
          mode: 'raw',
          raw: typeof req.request_body === 'string' ? req.request_body : JSON.stringify(req.request_body),
        };
      }
    }

    const pathShort = urlObj ? urlObj.pathname.slice(0, 60) : req.url.slice(0, 60);

    return {
      name: `${req.method} ${pathShort}`,
      request: {
        method: req.method || 'GET',
        header: headerEntries.map(([key, value]) => ({ key, value, type: 'text' })),
        url: postmanUrl,
        body,
        description: `Status: ${req.status_code || '-'} | Type: ${req.request_type || '-'} | Duration: ${req.duration_ms ? Math.round(req.duration_ms) + 'ms' : '-'}`,
      },
      response: [],
    };
  }

  function parseHeaders(headers) {
    if (!headers || typeof headers !== 'object') return [];
    if (Array.isArray(headers)) return headers.map(h => [h.name, h.value]);
    return Object.entries(headers);
  }

  function parseFormBody(body) {
    if (!body || typeof body !== 'string') return [];
    try {
      return body.split('&').map(pair => {
        const [key, ...rest] = pair.split('=');
        return {
          key: decodeURIComponent(key),
          value: decodeURIComponent(rest.join('=')),
          type: 'text',
        };
      });
    } catch {
      return [{ key: 'body', value: body, type: 'text' }];
    }
  }

  // ====================================================================
  // BULK EXPORT FUNCTIONS
  // ====================================================================

  async function fetchAllFilteredRequests() {
    // Fetch up to 500 requests with current filters for export
    const params = new URLSearchParams();
    params.set('page', 1);
    params.set('limit', 500);

    if (state.filters.method) params.set('method', state.filters.method);
    if (state.filters.status) params.set('status', state.filters.status);
    if (state.filters.website_id) params.set('website_id', state.filters.website_id);
    if (state.filters.search) params.set('search', state.filters.search);

    const data = await api.get(`/requests?${params}`);
    return data.requests;
  }

  async function exportAllPostman() {
    try {
      const requests = await fetchAllFilteredRequests();
      if (requests.length === 0) { showToast('No requests to export'); return; }
      const collection = buildPostmanCollection(requests, 'HTTP Tracker Export');
      downloadFile('http_tracker_collection.json', JSON.stringify(collection, null, 2));
      showToast(`Exported ${requests.length} requests as Postman Collection`);
    } catch (err) {
      showToast('Export failed: ' + err.message);
    }
  }

  async function exportAllJSON() {
    try {
      const requests = await fetchAllFilteredRequests();
      if (requests.length === 0) { showToast('No requests to export'); return; }
      downloadFile('http_tracker_export.json', JSON.stringify(requests, null, 2));
      showToast(`Exported ${requests.length} requests as JSON`);
    } catch (err) {
      showToast('Export failed: ' + err.message);
    }
  }

  async function exportAllCurl() {
    try {
      const requests = await fetchAllFilteredRequests();
      if (requests.length === 0) { showToast('No requests to export'); return; }
      const curlCommands = requests.map(r => buildCurl(r)).join('\n\n# ─────────────────────────\n\n');
      const header = `#!/bin/bash\n# OmniFetch by BungsuDev - cURL Export\n# ${requests.length} requests exported at ${new Date().toISOString()}\n\n`;
      downloadFile('http_tracker_requests.sh', header + curlCommands);
      showToast(`Exported ${requests.length} requests as cURL`);
    } catch (err) {
      showToast('Export failed: ' + err.message);
    }
  }

  // ====================================================================
  // DOWNLOAD & CLIPBOARD HELPERS
  // ====================================================================

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function showToast(msg) {
    // Remove existing toast
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ====================================================================
  // START
  // ====================================================================

  document.addEventListener('DOMContentLoaded', init);
})();
