/**
 * Content Script
 * Runs in every page context. Injects the page-level script (injected.js)
 * to intercept fetch, XHR, and JS navigation events.
 * Also monitors for <meta http-equiv="refresh"> tags.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (window.__httpTrackerContentInjected) return;
  window.__httpTrackerContentInjected = true;

  // ========================================================================
  // INJECT PAGE-LEVEL SCRIPT
  // ========================================================================

  function injectPageScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.dataset.extensionId = chrome.runtime.id;
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  // Inject as early as possible
  injectPageScript();

  // ========================================================================
  // LISTEN FOR MESSAGES FROM INJECTED SCRIPT
  // ========================================================================

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== '__HTTP_TRACKER_INJECTED__') return;

    const msg = event.data;

    switch (msg.type) {
      case 'JS_REDIRECT':
        chrome.runtime.sendMessage({
          type: 'JS_REDIRECT',
          method: msg.method,
          from: msg.from,
          to: msg.to,
          timestamp: msg.timestamp,
        });
        break;

      case 'FETCH_INTERCEPT':
        chrome.runtime.sendMessage({
          type: 'FETCH_INTERCEPT',
          url: msg.url,
          method: msg.method,
          headers: msg.headers,
          body: msg.body,
          statusCode: msg.statusCode,
          responseHeaders: msg.responseHeaders,
          responseBody: msg.responseBody,
          requestType: msg.requestType,
          timestamp: msg.timestamp,
        });
        break;

      case 'META_REDIRECT':
        chrome.runtime.sendMessage({
          type: 'META_REDIRECT',
          from: msg.from,
          to: msg.to,
          delay: msg.delay,
          timestamp: msg.timestamp,
        });
        break;

      case 'FORM_SUBMIT':
        chrome.runtime.sendMessage({
          type: 'FORM_SUBMIT',
          url: msg.url,
          method: msg.method,
          enctype: msg.enctype,
          fields: msg.fields,
          formId: msg.formId,
          formName: msg.formName,
          formAction: msg.formAction,
          fieldCount: msg.fieldCount,
          programmatic: msg.programmatic || false,
          timestamp: msg.timestamp,
        });
        break;
    }
  });

  // ========================================================================
  // META REFRESH DETECTION
  // ========================================================================

  function checkMetaRefresh() {
    const metaTags = document.querySelectorAll('meta[http-equiv="refresh"]');
    for (const meta of metaTags) {
      const content = meta.getAttribute('content');
      if (!content) continue;

      const match = content.match(/^\s*(\d+)\s*;\s*url\s*=\s*['"]?\s*(.+?)\s*['"]?\s*$/i);
      if (match) {
        const delay = parseInt(match[1], 10);
        const url = match[2];

        chrome.runtime.sendMessage({
          type: 'META_REDIRECT',
          from: window.location.href,
          to: url,
          delay,
          timestamp: Date.now(),
        });
      }
    }
  }

  // Check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkMetaRefresh);
  } else {
    checkMetaRefresh();
  }

  // Also watch for dynamically added meta tags
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'META' && node.getAttribute('http-equiv')?.toLowerCase() === 'refresh') {
            checkMetaRefresh();
          }
          // Check children too
          const metas = node.querySelectorAll?.('meta[http-equiv="refresh"]');
          if (metas?.length > 0) {
            checkMetaRefresh();
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
