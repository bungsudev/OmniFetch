/**
 * Injected Script
 * Runs in the PAGE context (not extension context).
 * Intercepts: fetch, XMLHttpRequest, window.location changes, history API
 *
 * Communicates with content.js via window.postMessage.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (window.__httpTrackerInjected) return;
  window.__httpTrackerInjected = true;

  const SOURCE = '__HTTP_TRACKER_INJECTED__';

  function postToContentScript(data) {
    window.postMessage({ ...data, source: SOURCE }, '*');
  }

  // ========================================================================
  // INTERCEPT FETCH
  // ========================================================================

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input
      : (input instanceof Request ? input.url : String(input));
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const headers = {};
    let body = null;

    // Extract headers
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (typeof init.headers === 'object') {
        Object.assign(headers, init.headers);
      }
    } else if (input instanceof Request) {
      input.headers.forEach((v, k) => { headers[k] = v; });
    }

    // Extract body
    if (init?.body) {
      try {
        if (typeof init.body === 'string') {
          body = init.body;
        } else if (init.body instanceof URLSearchParams) {
          body = init.body.toString();
        } else if (init.body instanceof FormData) {
          body = '[FormData]';
        } else if (init.body instanceof ArrayBuffer || init.body instanceof Uint8Array) {
          body = '[Binary Data]';
        } else {
          body = String(init.body);
        }
      } catch {
        body = '[Unreadable Body]';
      }
    }

    const timestamp = Date.now();

    try {
      const response = await originalFetch.apply(this, args);

      // Clone to read body without consuming the stream
      const clonedResponse = response.clone();
      const responseHeaders = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      let responseBody = null;
      try {
        const contentType = responseHeaders['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml') || contentType.includes('html')) {
          const text = await clonedResponse.text();
          if (text.length < 100000) { // Limit body size to prevent memory issues
            responseBody = text;
          } else {
            responseBody = text.slice(0, 100000) + '\n[...truncated]';
          }
        } else {
          responseBody = `[Binary: ${contentType}]`;
        }
      } catch {
        responseBody = '[Could not read response body]';
      }

      postToContentScript({
        type: 'FETCH_INTERCEPT',
        requestType: 'fetch',
        url,
        method: method.toUpperCase(),
        headers,
        body,
        statusCode: response.status,
        responseHeaders,
        responseBody,
        timestamp,
      });

      return response;
    } catch (err) {
      postToContentScript({
        type: 'FETCH_INTERCEPT',
        requestType: 'fetch',
        url,
        method: method.toUpperCase(),
        headers,
        body,
        statusCode: 0,
        responseHeaders: {},
        responseBody: `[Error: ${err.message}]`,
        timestamp,
      });
      throw err;
    }
  };

  // ========================================================================
  // INTERCEPT XMLHttpRequest
  // ========================================================================

  const OriginalXHR = window.XMLHttpRequest;
  const xhrProto = OriginalXHR.prototype;
  const originalOpen = xhrProto.open;
  const originalSend = xhrProto.send;
  const originalSetRequestHeader = xhrProto.setRequestHeader;

  xhrProto.open = function (method, url, ...rest) {
    this.__trackerMethod = method?.toUpperCase() || 'GET';
    this.__trackerUrl = url;
    this.__trackerHeaders = {};
    this.__trackerTimestamp = Date.now();
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  xhrProto.setRequestHeader = function (name, value) {
    if (this.__trackerHeaders) {
      this.__trackerHeaders[name] = value;
    }
    return originalSetRequestHeader.apply(this, [name, value]);
  };

  xhrProto.send = function (body) {
    const xhr = this;
    const requestBody = body ? (typeof body === 'string' ? body : '[Complex Body]') : null;

    xhr.addEventListener('load', function () {
      const responseHeaders = {};
      const allHeaders = xhr.getAllResponseHeaders();
      if (allHeaders) {
        allHeaders.split('\r\n').forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) {
            responseHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
      }

      let responseBody = null;
      try {
        if (xhr.responseType === '' || xhr.responseType === 'text') {
          const text = xhr.responseText;
          if (text && text.length < 100000) {
            responseBody = text;
          } else if (text) {
            responseBody = text.slice(0, 100000) + '\n[...truncated]';
          }
        } else if (xhr.responseType === 'json') {
          responseBody = JSON.stringify(xhr.response);
        } else {
          responseBody = `[${xhr.responseType} response]`;
        }
      } catch {
        responseBody = '[Could not read response]';
      }

      postToContentScript({
        type: 'FETCH_INTERCEPT',
        requestType: 'xhr',
        url: xhr.__trackerUrl,
        method: xhr.__trackerMethod,
        headers: xhr.__trackerHeaders,
        body: requestBody,
        statusCode: xhr.status,
        responseHeaders,
        responseBody,
        timestamp: xhr.__trackerTimestamp,
      });
    });

    xhr.addEventListener('error', function () {
      postToContentScript({
        type: 'FETCH_INTERCEPT',
        requestType: 'xhr',
        url: xhr.__trackerUrl,
        method: xhr.__trackerMethod,
        headers: xhr.__trackerHeaders,
        body: requestBody,
        statusCode: 0,
        responseHeaders: {},
        responseBody: '[XHR Error]',
        timestamp: xhr.__trackerTimestamp,
      });
    });

    return originalSend.apply(this, [body]);
  };

  // ========================================================================
  // INTERCEPT NATIVE FORM SUBMISSIONS
  // ========================================================================

  // Capture native <form> submit (non-AJAX)
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;

    try {
      const formData = new FormData(form);
      const fields = {};
      for (const [key, value] of formData.entries()) {
        if (fields[key]) {
          // Multiple values (checkboxes, multi-select)
          if (Array.isArray(fields[key])) {
            fields[key].push(value instanceof File ? `[File: ${value.name}]` : value);
          } else {
            fields[key] = [fields[key], value instanceof File ? `[File: ${value.name}]` : value];
          }
        } else {
          fields[key] = value instanceof File ? `[File: ${value.name}, ${value.size} bytes, ${value.type}]` : value;
        }
      }

      const action = form.action || window.location.href;
      const method = (form.method || 'GET').toUpperCase();
      const enctype = form.enctype || 'application/x-www-form-urlencoded';

      postToContentScript({
        type: 'FORM_SUBMIT',
        url: action,
        method,
        enctype,
        fields,
        formId: form.id || null,
        formName: form.name || null,
        formAction: form.getAttribute('action') || null,
        fieldCount: Object.keys(fields).length,
        timestamp: Date.now(),
      });
    } catch {
      // Silently fail
    }
  }, true); // Use capture phase to fire before form submits

  // Also intercept form.submit() calls
  const originalFormSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    try {
      const formData = new FormData(this);
      const fields = {};
      for (const [key, value] of formData.entries()) {
        fields[key] = value instanceof File ? `[File: ${value.name}]` : value;
      }

      postToContentScript({
        type: 'FORM_SUBMIT',
        url: this.action || window.location.href,
        method: (this.method || 'GET').toUpperCase(),
        enctype: this.enctype || 'application/x-www-form-urlencoded',
        fields,
        formId: this.id || null,
        formName: this.name || null,
        programmatic: true,
        timestamp: Date.now(),
      });
    } catch {
      // Silently fail
    }
    return originalFormSubmit.call(this);
  };

  // ========================================================================
  // INTERCEPT WINDOW.LOCATION CHANGES
  // ========================================================================

  const currentLocation = window.location.href;

  // Intercept window.location.href setter
  const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  // Note: window.location is special and can't be fully overridden in all browsers.
  // We use a different approach: monitor via a proxy on document.location properties.

  // NOTE: location.assign and location.replace are non-configurable in Chrome
  // and CANNOT be overridden via Object.defineProperty or direct assignment.
  // Instead, we detect JS-based navigation via beforeunload + href change detection.

  let lastTrackedHref = window.location.href;

  // Detect any JS-initiated navigation via beforeunload
  window.addEventListener('beforeunload', () => {
    const newHref = window.location.href;
    if (newHref !== lastTrackedHref) {
      postToContentScript({
        type: 'JS_REDIRECT',
        method: 'js-navigation',
        from: lastTrackedHref,
        to: newHref,
        timestamp: Date.now(),
      });
    }
  });

  // Periodic href change detection (catches assign/replace/href changes)
  setInterval(() => {
    if (window.location.href !== lastTrackedHref) {
      postToContentScript({
        type: 'JS_REDIRECT',
        method: 'href-change',
        from: lastTrackedHref,
        to: window.location.href,
        timestamp: Date.now(),
      });
      lastTrackedHref = window.location.href;
    }
  }, 200);

  // ========================================================================
  // INTERCEPT HISTORY API
  // ========================================================================

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (state, title, url) {
    if (url) {
      postToContentScript({
        type: 'JS_REDIRECT',
        method: 'history.pushState',
        from: window.location.href,
        to: resolveUrl(url),
        timestamp: Date.now(),
      });
    }
    return originalPushState.apply(this, [state, title, url]);
  };

  history.replaceState = function (state, title, url) {
    if (url) {
      postToContentScript({
        type: 'JS_REDIRECT',
        method: 'history.replaceState',
        from: window.location.href,
        to: resolveUrl(url),
        timestamp: Date.now(),
      });
    }
    return originalReplaceState.apply(this, [state, title, url]);
  };

  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    postToContentScript({
      type: 'JS_REDIRECT',
      method: 'popstate',
      from: currentLocation,
      to: window.location.href,
      timestamp: Date.now(),
    });
  });

  // ========================================================================
  // INTERCEPT window.location.href SETTER via periodic check
  // ========================================================================

  // Since we can't easily override the location.href setter,
  // we also set up a beforeunload listener as a catch-all
  let lastKnownHref = window.location.href;

  // Use a setter trap on a commonly used redirect pattern
  const origLocationHrefDescriptor = Object.getOwnPropertyDescriptor(
    window.Location.prototype, 'href'
  );

  if (origLocationHrefDescriptor && origLocationHrefDescriptor.set) {
    try {
      Object.defineProperty(window.Location.prototype, 'href', {
        get: origLocationHrefDescriptor.get,
        set: function (value) {
          postToContentScript({
            type: 'JS_REDIRECT',
            method: 'location.href',
            from: window.location.href,
            to: resolveUrl(value),
            timestamp: Date.now(),
          });
          origLocationHrefDescriptor.set.call(this, value);
        },
        configurable: true,
        enumerable: true,
      });
    } catch {
      // Some browsers may block this; fall back to beforeunload
    }
  }

  // ========================================================================
  // HELPER FUNCTIONS
  // ========================================================================

  function resolveUrl(url) {
    if (!url) return '';
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }
})();
