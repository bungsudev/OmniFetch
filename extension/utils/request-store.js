/**
 * RequestStore - Central data store for all tracked requests and redirect chains.
 * Runs in the background service worker context.
 */

const MAX_REQUESTS = 5000;
const MAX_CHAIN_LENGTH = 50;

class RequestStore {
  constructor() {
    this.requests = new Map();
    this.redirectChains = new Map();
    this.jsRedirects = [];
    this.metaRedirects = [];
    this.requestOrder = [];
    this.chainCounter = 0;
    this.listeners = new Set();
  }

  /**
   * Add or update a request entry
   */
  addRequest(requestId, data) {
    const entry = this.requests.get(requestId) || {
      id: requestId,
      timestamp: Date.now(),
      tabId: data.tabId,
      type: data.type || 'xmlhttprequest',
      initiator: data.initiator || '',
      redirectChainId: null,
      redirects: [],
    };

    Object.assign(entry, data);
    this.requests.set(requestId, entry);

    if (!this.requestOrder.includes(requestId)) {
      this.requestOrder.push(requestId);
    }

    // Enforce max size
    while (this.requestOrder.length > MAX_REQUESTS) {
      const oldId = this.requestOrder.shift();
      this.requests.delete(oldId);
    }

    this.notifyListeners('request-updated', entry);
    return entry;
  }

  /**
   * Get a request by ID
   */
  getRequest(requestId) {
    return this.requests.get(requestId);
  }

  /**
   * Get all requests, optionally filtered
   */
  getAllRequests(filter = {}) {
    let results = Array.from(this.requests.values());

    if (filter.tabId !== undefined) {
      results = results.filter(r => r.tabId === filter.tabId);
    }
    if (filter.method) {
      results = results.filter(r => r.method === filter.method);
    }
    if (filter.statusCode) {
      results = results.filter(r => r.statusCode === filter.statusCode);
    }
    if (filter.domain) {
      results = results.filter(r => {
        try {
          const url = new URL(r.url);
          return url.hostname.includes(filter.domain);
        } catch {
          return false;
        }
      });
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      results = results.filter(r =>
        (r.url && r.url.toLowerCase().includes(searchLower)) ||
        (r.method && r.method.toLowerCase().includes(searchLower))
      );
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Track a server-side redirect
   */
  addRedirect(requestId, fromUrl, toUrl, statusCode) {
    const entry = this.requests.get(requestId);
    if (!entry) return;

    if (!entry.redirectChainId) {
      entry.redirectChainId = `chain-${++this.chainCounter}`;
      this.redirectChains.set(entry.redirectChainId, {
        id: entry.redirectChainId,
        tabId: entry.tabId,
        timestamp: entry.timestamp,
        steps: [],
      });
    }

    const chain = this.redirectChains.get(entry.redirectChainId);
    if (chain && chain.steps.length < MAX_CHAIN_LENGTH) {
      chain.steps.push({
        type: 'http',
        from: fromUrl,
        to: toUrl,
        statusCode,
        timestamp: Date.now(),
      });
    }

    this.notifyListeners('redirect', { requestId, fromUrl, toUrl, statusCode });
  }

  /**
   * Track a JS redirect
   */
  addJsRedirect(tabId, data) {
    const redirect = {
      id: `js-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      tabId,
      type: 'js',
      method: data.method,
      from: data.from,
      to: data.to,
      timestamp: data.timestamp || Date.now(),
    };

    this.jsRedirects.push(redirect);

    // Try to attach to existing chain or create new one
    const chainId = `chain-${++this.chainCounter}`;
    this.redirectChains.set(chainId, {
      id: chainId,
      tabId,
      timestamp: redirect.timestamp,
      steps: [{
        type: 'js',
        method: data.method,
        from: data.from,
        to: data.to,
        timestamp: redirect.timestamp,
      }],
    });

    // Also add as a pseudo-request for the panel
    this.addRequest(redirect.id, {
      url: data.to,
      method: 'JS_REDIRECT',
      tabId,
      statusCode: null,
      type: 'js-redirect',
      jsRedirectMethod: data.method,
      jsRedirectFrom: data.from,
      redirectChainId: chainId,
    });

    this.notifyListeners('js-redirect', redirect);
    return redirect;
  }

  /**
   * Track a meta refresh redirect
   */
  addMetaRedirect(tabId, data) {
    const redirect = {
      id: `meta-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      tabId,
      type: 'meta',
      from: data.from,
      to: data.to,
      delay: data.delay,
      timestamp: data.timestamp || Date.now(),
    };

    this.metaRedirects.push(redirect);

    const chainId = `chain-${++this.chainCounter}`;
    this.redirectChains.set(chainId, {
      id: chainId,
      tabId,
      timestamp: redirect.timestamp,
      steps: [{
        type: 'meta',
        from: data.from,
        to: data.to,
        delay: data.delay,
        timestamp: redirect.timestamp,
      }],
    });

    this.addRequest(redirect.id, {
      url: data.to,
      method: 'META_REDIRECT',
      tabId,
      statusCode: null,
      type: 'meta-redirect',
      metaRedirectFrom: data.from,
      metaDelay: data.delay,
      redirectChainId: chainId,
    });

    this.notifyListeners('meta-redirect', redirect);
    return redirect;
  }

  /**
   * Get all redirect chains for a tab
   */
  getRedirectChains(tabId) {
    const chains = [];
    for (const chain of this.redirectChains.values()) {
      if (tabId === undefined || chain.tabId === tabId) {
        chains.push(chain);
      }
    }
    return chains.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Build a unified redirect chain for display
   */
  buildUnifiedChain(tabId) {
    const allEvents = [];

    // Gather HTTP redirects
    for (const chain of this.redirectChains.values()) {
      if (tabId === undefined || chain.tabId === tabId) {
        for (const step of chain.steps) {
          allEvents.push({ ...step, chainId: chain.id });
        }
      }
    }

    return allEvents.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear all data for a specific tab
   */
  clearTab(tabId) {
    for (const [id, req] of this.requests.entries()) {
      if (req.tabId === tabId) {
        this.requests.delete(id);
        this.requestOrder = this.requestOrder.filter(x => x !== id);
      }
    }
    for (const [id, chain] of this.redirectChains.entries()) {
      if (chain.tabId === tabId) {
        this.redirectChains.delete(id);
      }
    }
    this.jsRedirects = this.jsRedirects.filter(r => r.tabId !== tabId);
    this.metaRedirects = this.metaRedirects.filter(r => r.tabId !== tabId);
    this.notifyListeners('cleared', { tabId });
  }

  /**
   * Clear all data
   */
  clearAll() {
    this.requests.clear();
    this.redirectChains.clear();
    this.jsRedirects = [];
    this.metaRedirects = [];
    this.requestOrder = [];
    this.notifyListeners('cleared', {});
  }

  /**
   * Register a listener for store changes
   */
  addListener(fn) {
    this.listeners.add(fn);
  }

  removeListener(fn) {
    this.listeners.delete(fn);
  }

  notifyListeners(event, data) {
    for (const fn of this.listeners) {
      try {
        fn(event, data);
      } catch (e) {
        console.error('Store listener error:', e);
      }
    }
  }

  /**
   * Export data for serialization
   */
  exportData(tabId) {
    return {
      requests: this.getAllRequests(tabId !== undefined ? { tabId } : {}),
      redirectChains: this.getRedirectChains(tabId),
      jsRedirects: tabId !== undefined
        ? this.jsRedirects.filter(r => r.tabId === tabId)
        : [...this.jsRedirects],
      metaRedirects: tabId !== undefined
        ? this.metaRedirects.filter(r => r.tabId === tabId)
        : [...this.metaRedirects],
      exportedAt: new Date().toISOString(),
    };
  }
}

// Singleton export
if (typeof globalThis.__requestStore === 'undefined') {
  globalThis.__requestStore = new RequestStore();
}
