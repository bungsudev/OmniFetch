/**
 * RequestFormatter - Format and parse request/response data for display
 */

const RequestFormatter = {
  /**
   * Parse URL into components
   */
  parseUrl(url) {
    try {
      const parsed = new URL(url);
      return {
        full: url,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
        origin: parsed.origin,
        queryParams: Object.fromEntries(parsed.searchParams),
      };
    } catch {
      return { full: url, pathname: url };
    }
  },

  /**
   * Get short display name for a URL
   */
  getUrlShortName(url) {
    try {
      const parsed = new URL(url);
      let path = parsed.pathname;
      if (path.length > 60) {
        path = '...' + path.slice(-57);
      }
      return `${parsed.hostname}${path}${parsed.search ? '?' + parsed.search.slice(1, 30) : ''}`;
    } catch {
      return url?.slice(0, 80) || '';
    }
  },

  /**
   * Format headers for display
   */
  formatHeaders(headers) {
    if (!headers) return [];
    if (Array.isArray(headers)) {
      return headers.map(h => ({ name: h.name, value: h.value }));
    }
    return Object.entries(headers).map(([name, value]) => ({ name, value }));
  },

  /**
   * Categorize a header
   */
  categorizeHeader(name) {
    const lower = name.toLowerCase();
    if (['cookie', 'set-cookie', 'authorization', 'www-authenticate', 'proxy-authorization'].includes(lower)) {
      return 'auth';
    }
    if (['content-type', 'content-length', 'content-encoding', 'content-language', 'content-disposition'].includes(lower)) {
      return 'content';
    }
    if (['cache-control', 'expires', 'pragma', 'etag', 'if-none-match', 'if-modified-since', 'last-modified'].includes(lower)) {
      return 'cache';
    }
    if (['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(lower) || lower.startsWith('access-control-')) {
      return 'cors';
    }
    if (['location', 'referer', 'origin', 'host'].includes(lower)) {
      return 'navigation';
    }
    return 'general';
  },

  /**
   * Format request body for display
   */
  formatBody(body, contentType) {
    if (!body) return null;

    if (typeof body === 'string') {
      // Try to parse as JSON
      if (contentType?.includes('json') || body.startsWith('{') || body.startsWith('[')) {
        try {
          return {
            type: 'json',
            parsed: JSON.parse(body),
            formatted: JSON.stringify(JSON.parse(body), null, 2),
          };
        } catch { /* not JSON */ }
      }

      // URL-encoded
      if (contentType?.includes('form-urlencoded') || body.includes('=')) {
        try {
          const params = new URLSearchParams(body);
          const parsed = Object.fromEntries(params);
          if (Object.keys(parsed).length > 0) {
            return { type: 'form', parsed, raw: body };
          }
        } catch { /* not form */ }
      }

      return { type: 'text', raw: body };
    }

    if (typeof body === 'object') {
      if (body.formData) {
        return { type: 'form', parsed: body.formData, raw: JSON.stringify(body.formData) };
      }
      if (body.raw) {
        // Chrome's raw body format
        try {
          const decoder = new TextDecoder();
          const text = body.raw.map(part => {
            if (part.bytes) {
              return decoder.decode(new Uint8Array(part.bytes));
            }
            return part.file || '';
          }).join('');
          return RequestFormatter.formatBody(text, contentType);
        } catch {
          return { type: 'binary', raw: '[Binary Data]' };
        }
      }
      return { type: 'json', parsed: body, formatted: JSON.stringify(body, null, 2) };
    }

    return { type: 'unknown', raw: String(body) };
  },

  /**
   * Get status code color class
   */
  getStatusColorClass(statusCode) {
    if (!statusCode) return 'status-unknown';
    if (statusCode >= 200 && statusCode < 300) return 'status-success';
    if (statusCode >= 300 && statusCode < 400) return 'status-redirect';
    if (statusCode >= 400 && statusCode < 500) return 'status-client-error';
    if (statusCode >= 500) return 'status-server-error';
    return 'status-unknown';
  },

  /**
   * Get method color class
   */
  getMethodColorClass(method) {
    const colors = {
      GET: 'method-get',
      POST: 'method-post',
      PUT: 'method-put',
      PATCH: 'method-patch',
      DELETE: 'method-delete',
      OPTIONS: 'method-options',
      HEAD: 'method-head',
      JS_REDIRECT: 'method-js',
      META_REDIRECT: 'method-meta',
    };
    return colors[method] || 'method-other';
  },

  /**
   * Get resource type icon
   */
  getTypeIcon(type) {
    const icons = {
      'xmlhttprequest': '⚡',
      'fetch': '⚡',
      'script': '📜',
      'stylesheet': '🎨',
      'image': '🖼️',
      'font': '🔤',
      'document': '📄',
      'websocket': '🔌',
      'media': '🎬',
      'other': '📎',
      'js-redirect': '↪️',
      'meta-redirect': '🔄',
    };
    return icons[type] || '📎';
  },

  /**
   * Format timestamp
   */
  formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  },

  /**
   * Format byte size
   */
  formatSize(bytes) {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  },

  /**
   * Format duration
   */
  formatDuration(ms) {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  },

  /**
   * Extract session info from headers
   */
  extractSessionInfo(headers) {
    const session = {
      cookies: null,
      authorization: null,
      setCookies: [],
    };

    if (!headers) return session;

    const headerList = Array.isArray(headers) ? headers : Object.entries(headers).map(([name, value]) => ({ name, value }));

    for (const h of headerList) {
      const lower = h.name.toLowerCase();
      if (lower === 'cookie') {
        session.cookies = parseCookies(h.value);
      } else if (lower === 'authorization') {
        session.authorization = parseAuthHeader(h.value);
      } else if (lower === 'set-cookie') {
        session.setCookies.push(h.value);
      }
    }

    return session;
  },
};

function parseCookies(cookieStr) {
  if (!cookieStr) return {};
  const cookies = {};
  const pairs = cookieStr.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      cookies[key] = value;
    }
  }
  return cookies;
}

function parseAuthHeader(value) {
  if (!value) return null;
  const parts = value.split(' ');
  const result = { type: parts[0], token: parts.slice(1).join(' ') };

  // Try to decode JWT
  if (result.type === 'Bearer' && result.token.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(result.token.split('.')[1]));
      result.jwtPayload = payload;
    } catch { /* not a valid JWT */ }
  }

  return result;
}

if (typeof globalThis !== 'undefined') {
  globalThis.RequestFormatter = RequestFormatter;
}
