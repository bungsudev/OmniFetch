/**
 * OmniFetch Recorder — Event Capture Engine
 * Injected into the PAGE context to record user interactions.
 * Communicates with content.js via window.postMessage.
 */

(function () {
  'use strict';

  if (window.__omnifetchRecorderActive) return;
  window.__omnifetchRecorderActive = true;

  const SOURCE = '__OMNIFETCH_RECORDER__';
  const actions = [];
  let lastActionTime = Date.now();
  let isRecording = true;

  function post(data) {
    window.postMessage({ ...data, source: SOURCE }, '*');
  }

  // ========================================================================
  // SMART SELECTOR GENERATOR
  // ========================================================================

  function getSelector(el) {
    if (!el || el === document || el === document.body) return 'body';

    // 1. ID (most reliable)
    if (el.id) return `#${CSS.escape(el.id)}`;

    // 2. data-testid / data-cy / data-test
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'data-qa']) {
      if (el.getAttribute(attr)) {
        return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
      }
    }

    // 3. name attribute (great for form fields)
    if (el.name && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) {
      const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // 4. aria-label
    if (el.getAttribute('aria-label')) {
      const sel = `[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // 5. Button/link by text content (short text only)
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.textContent.trim().length < 50) {
      const text = el.textContent.trim();
      // We'll store this for xpath fallback
    }

    // 6. type + placeholder for inputs
    if (el.tagName === 'INPUT') {
      if (el.placeholder) {
        const sel = `input[placeholder="${CSS.escape(el.placeholder)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      if (el.type && el.type !== 'text') {
        const sel = `input[type="${el.type}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // 7. Unique class combination
    if (el.classList.length > 0) {
      const classSelector = el.tagName.toLowerCase() + '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
      if (document.querySelectorAll(classSelector).length === 1) return classSelector;
    }

    // 8. CSS path from root (fallback)
    return buildCSSPath(el);
  }

  function buildCSSPath(el) {
    const path = [];
    let current = el;
    while (current && current !== document.body && current !== document) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      // nth-child
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  }

  function getXPath(el) {
    if (!el) return '';
    // Simple text-based xpath for buttons/links
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.textContent.trim().length < 50) {
      const text = el.textContent.trim();
      return `//${el.tagName.toLowerCase()}[contains(text(),"${text.replace(/"/g, '\\"')}")]`;
    }
    // ID-based
    if (el.id) return `//*[@id="${el.id}"]`;
    // Name-based
    if (el.name) return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;

    return '';
  }

  // ========================================================================
  // ACTION RECORDER
  // ========================================================================

  function recordAction(action) {
    if (!isRecording) return;

    const now = Date.now();
    action.delay = now - lastActionTime;
    action.timestamp = now;
    action.url = window.location.href;
    lastActionTime = now;

    actions.push(action);
    post({ type: 'RECORDER_ACTION', action, actionCount: actions.length });
  }

  // ── CLICK ──────────────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el) return;

    recordAction({
      type: 'click',
      selector: getSelector(el),
      xpath: getXPath(el),
      tagName: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 100),
      x: e.clientX,
      y: e.clientY,
    });
  }, true);

  // ── INPUT / CHANGE ─────────────────────────────────────────────────────

  // Debounced input capture (capture final value, not every keystroke)
  const inputTimers = new Map();

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !('value' in el)) return;

    const selector = getSelector(el);

    // Debounce: wait 500ms after last keystroke
    clearTimeout(inputTimers.get(selector));
    inputTimers.set(selector, setTimeout(() => {
      recordAction({
        type: 'input',
        selector,
        xpath: getXPath(el),
        tagName: el.tagName.toLowerCase(),
        inputType: el.type || 'text',
        value: el.value,
        name: el.name || null,
        placeholder: el.placeholder || null,
      });
      inputTimers.delete(selector);
    }, 500));
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el) return;

    // For select, checkbox, radio — capture immediately
    if (el.tagName === 'SELECT') {
      recordAction({
        type: 'select',
        selector: getSelector(el),
        xpath: getXPath(el),
        value: el.value,
        selectedText: el.options[el.selectedIndex]?.text || '',
        name: el.name || null,
      });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      recordAction({
        type: 'check',
        selector: getSelector(el),
        xpath: getXPath(el),
        checked: el.checked,
        value: el.value,
        name: el.name || null,
      });
    }
  }, true);

  // ── KEYBOARD (Special keys only) ───────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!specialKeys.includes(e.key)) return;

    // Skip if inside input/textarea (Enter in forms is handled by submit)
    const el = e.target;
    if (e.key === 'Enter' && el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

    recordAction({
      type: 'keypress',
      selector: getSelector(el),
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
  }, true);

  // ── SCROLL (Debounced) ──────────────────────────────────────────────────

  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      recordAction({
        type: 'scroll',
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
    }, 300);
  }, true);

  // ── FORM SUBMIT ─────────────────────────────────────────────────────────

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;

    recordAction({
      type: 'submit',
      selector: getSelector(form),
      action: form.action || window.location.href,
      method: (form.method || 'GET').toUpperCase(),
    });
  }, true);

  // ── NAVIGATION ──────────────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    if (!isRecording) return;
    // Flush all pending input timers
    for (const [selector, timer] of inputTimers.entries()) {
      clearTimeout(timer);
    }
    // Send final batch
    post({ type: 'RECORDER_BEFOREUNLOAD', actions, url: window.location.href });
  });

  // ========================================================================
  // CONTROL MESSAGES (from content.js)
  // ========================================================================

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source !== '__OMNIFETCH_RECORDER_CONTROL__') return;

    switch (e.data.command) {
      case 'STOP':
        isRecording = false;
        window.__omnifetchRecorderActive = false;
        post({ type: 'RECORDER_STOPPED', actions, totalActions: actions.length });
        break;

      case 'GET_ACTIONS':
        post({ type: 'RECORDER_ACTIONS', actions, totalActions: actions.length });
        break;
    }
  });

  // Notify that recorder is ready
  post({ type: 'RECORDER_READY', url: window.location.href });
  console.log('[OmniFetch] 🔴 Recorder started');
})();
