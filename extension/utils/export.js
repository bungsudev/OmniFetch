/**
 * Export utilities - Convert tracked requests to various formats
 */

const ExportUtils = {
  /**
   * Export a single request as cURL command
   */
  toCurl(request) {
    const parts = ['curl'];

    // Method
    if (request.method && request.method !== 'GET') {
      parts.push(`-X ${request.method}`);
    }

    // URL
    parts.push(`'${escapeShell(request.url)}'`);

    // Headers
    if (request.requestHeaders) {
      const headers = Array.isArray(request.requestHeaders)
        ? request.requestHeaders
        : Object.entries(request.requestHeaders).map(([name, value]) => ({ name, value }));

      for (const header of headers) {
        parts.push(`-H '${escapeShell(header.name)}: ${escapeShell(header.value)}'`);
      }
    }

    // Body
    if (request.requestBody) {
      let body = request.requestBody;
      if (typeof body === 'object') {
        body = JSON.stringify(body);
      }
      parts.push(`-d '${escapeShell(body)}'`);
    }

    // Follow redirects
    parts.push('-L');

    // Include response headers
    parts.push('-i');

    return parts.join(' \\\n  ');
  },

  /**
   * Export multiple requests as JSON
   */
  toJSON(requests, pretty = true) {
    const data = requests.map(req => ({
      url: req.url,
      method: req.method,
      statusCode: req.statusCode,
      type: req.type,
      timestamp: req.timestamp,
      initiator: req.initiator,
      requestHeaders: formatHeaders(req.requestHeaders),
      responseHeaders: formatHeaders(req.responseHeaders),
      requestBody: req.requestBody || null,
      responseBody: req.responseBody || null,
      redirectChainId: req.redirectChainId || null,
      timing: req.timing || null,
    }));

    return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  },

  /**
   * Export as Postman Collection v2.1
   */
  toPostmanCollection(requests, collectionName = 'OmniFetch Export') {
    const collection = {
      info: {
        name: collectionName,
        description: `Exported from OmniFetch by BungsuDev on ${new Date().toISOString()}`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [],
    };

    // Group by domain
    const domainGroups = {};
    for (const req of requests) {
      if (!req.url || req.method === 'JS_REDIRECT' || req.method === 'META_REDIRECT') continue;

      let domain;
      try {
        domain = new URL(req.url).hostname;
      } catch {
        domain = 'unknown';
      }

      if (!domainGroups[domain]) {
        domainGroups[domain] = [];
      }
      domainGroups[domain].push(req);
    }

    for (const [domain, reqs] of Object.entries(domainGroups)) {
      const folder = {
        name: domain,
        item: reqs.map(req => {
          let urlObj;
          try {
            urlObj = new URL(req.url);
          } catch {
            urlObj = { protocol: 'https:', hostname: domain, pathname: req.url, search: '' };
          }

          const item = {
            name: `${req.method} ${urlObj.pathname}`,
            request: {
              method: req.method,
              header: [],
              url: {
                raw: req.url,
                protocol: urlObj.protocol?.replace(':', '') || 'https',
                host: urlObj.hostname?.split('.') || [domain],
                path: urlObj.pathname?.split('/').filter(Boolean) || [],
                query: [],
              },
            },
            response: [],
          };

          // Parse query params
          if (urlObj.search) {
            const params = new URLSearchParams(urlObj.search);
            for (const [key, value] of params) {
              item.request.url.query.push({ key, value });
            }
          }

          // Headers
          if (req.requestHeaders) {
            const headers = Array.isArray(req.requestHeaders)
              ? req.requestHeaders
              : Object.entries(req.requestHeaders).map(([name, value]) => ({ name, value }));

            item.request.header = headers.map(h => ({
              key: h.name,
              value: h.value,
              type: 'text',
            }));
          }

          // Request body
          if (req.requestBody) {
            let body = req.requestBody;
            if (typeof body === 'object' && body.formData) {
              item.request.body = {
                mode: 'urlencoded',
                urlencoded: Object.entries(body.formData).map(([key, value]) => ({
                  key,
                  value: Array.isArray(value) ? value[0] : value,
                  type: 'text',
                })),
              };
            } else {
              item.request.body = {
                mode: 'raw',
                raw: typeof body === 'string' ? body : JSON.stringify(body),
                options: {
                  raw: {
                    language: 'json',
                  },
                },
              };
            }
          }

          return item;
        }),
      };

      collection.item.push(folder);
    }

    return JSON.stringify(collection, null, 2);
  },

  /**
   * Export redirect chains as readable text
   */
  toRedirectChainText(chains) {
    const lines = [];

    for (const chain of chains) {
      lines.push(`━━━ Redirect Chain: ${chain.id} ━━━`);
      lines.push(`  Tab: ${chain.tabId}`);
      lines.push(`  Time: ${new Date(chain.timestamp).toISOString()}`);
      lines.push('');

      chain.steps.forEach((step, i) => {
        const prefix = i === 0 ? '  [START]' : `  [${i + 1}]`;

        if (step.type === 'http') {
          lines.push(`${prefix} ${step.statusCode} Redirect`);
          lines.push(`    FROM: ${step.from}`);
          lines.push(`    TO:   ${step.to}`);
        } else if (step.type === 'js') {
          lines.push(`${prefix} JS Redirect (${step.method})`);
          lines.push(`    FROM: ${step.from}`);
          lines.push(`    TO:   ${step.to}`);
        } else if (step.type === 'meta') {
          lines.push(`${prefix} Meta Refresh (${step.delay}s)`);
          lines.push(`    FROM: ${step.from}`);
          lines.push(`    TO:   ${step.to}`);
        }

        if (i < chain.steps.length - 1) {
          lines.push('    ↓');
        }
      });

      if (chain.steps.length > 0) {
        const lastStep = chain.steps[chain.steps.length - 1];
        lines.push(`  [FINAL] → ${lastStep.to}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  },

  /**
   * Download data as a file
   */
  downloadFile(content, filename, mimeType = 'application/json') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

function escapeShell(str) {
  if (!str) return '';
  return str.replace(/'/g, "'\\''");
}

function formatHeaders(headers) {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    const obj = {};
    for (const h of headers) {
      obj[h.name] = h.value;
    }
    return obj;
  }
  return headers;
}

// Make available in both module and script contexts
if (typeof globalThis !== 'undefined') {
  globalThis.ExportUtils = ExportUtils;
}
