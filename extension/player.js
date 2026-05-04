/**
 * OmniFetch Player — Playback Engine
 * Injected into the PAGE context to replay recorded actions.
 * Communicates with content.js via window.postMessage.
 */

(function () {
  'use strict';

  if (window.__omnifetchPlayerActive) return;
  window.__omnifetchPlayerActive = true;

  const SOURCE = '__OMNIFETCH_PLAYER__';
  let isPlaying = false;
  let currentStep = 0;
  let actions = [];
  let speed = 1;
  let highlightEl = null;

  function post(data) {
    window.postMessage({ ...data, source: SOURCE }, '*');
  }

  // ========================================================================
  // ELEMENT FINDER (Smart wait)
  // ========================================================================

  async function findElement(action, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      let el = null;

      // Try CSS selector first
      if (action.selector) {
        try { el = document.querySelector(action.selector); } catch {}
      }

      // Try XPath if CSS didn't work
      if (!el && action.xpath) {
        try {
          const result = document.evaluate(
            action.xpath, document, null,
            XPathResult.FIRST_ORDERED_NODE_TYPE, null
          );
          el = result.singleNodeValue;
        } catch {}
      }

      // Try fallback: find by text for buttons/links
      if (!el && action.text && action.tagName) {
        const candidates = document.querySelectorAll(action.tagName);
        for (const c of candidates) {
          if (c.textContent.trim().includes(action.text.trim())) {
            el = c;
            break;
          }
        }
      }

      if (el) return el;

      // Wait 100ms before retrying
      await sleep(100);
    }

    return null; // Element not found within timeout
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================================================
  // VISUAL HIGHLIGHT
  // ========================================================================

  function createHighlight() {
    if (highlightEl) return highlightEl;
    highlightEl = document.createElement('div');
    highlightEl.id = '__omnifetch-highlight';
    highlightEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      border: 3px solid #58a6ff;
      border-radius: 4px;
      background: rgba(88,166,255,0.1);
      box-shadow: 0 0 20px rgba(88,166,255,0.4);
      transition: all 200ms ease;
      display: none;
    `;
    document.body.appendChild(highlightEl);
    return highlightEl;
  }

  function highlightElement(el) {
    if (!el) return;
    const hl = createHighlight();
    const rect = el.getBoundingClientRect();
    hl.style.top = rect.top - 3 + 'px';
    hl.style.left = rect.left - 3 + 'px';
    hl.style.width = rect.width + 6 + 'px';
    hl.style.height = rect.height + 6 + 'px';
    hl.style.display = 'block';
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.style.display = 'none';
  }

  // ========================================================================
  // ACTION EXECUTORS
  // ========================================================================

  async function executeAction(action) {
    switch (action.type) {
      case 'click': {
        const el = await findElement(action);
        if (!el) throw new Error(`Element not found: ${action.selector}`);
        highlightElement(el);
        await sleep(300 / speed);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200 / speed);
        el.click();
        break;
      }

      case 'input': {
        const el = await findElement(action);
        if (!el) throw new Error(`Input not found: ${action.selector}`);
        highlightElement(el);
        await sleep(200 / speed);
        el.focus();
        el.value = '';
        // Type character by character for realism
        for (const char of action.value) {
          el.value += char;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(30 / speed);
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }

      case 'select': {
        const el = await findElement(action);
        if (!el) throw new Error(`Select not found: ${action.selector}`);
        highlightElement(el);
        await sleep(200 / speed);
        el.value = action.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }

      case 'check': {
        const el = await findElement(action);
        if (!el) throw new Error(`Checkbox not found: ${action.selector}`);
        highlightElement(el);
        await sleep(200 / speed);
        if (el.checked !== action.checked) {
          el.click();
        }
        break;
      }

      case 'keypress': {
        const el = action.selector ? await findElement(action) : document.activeElement;
        if (el) highlightElement(el);
        const opts = {
          key: action.key,
          code: action.code,
          ctrlKey: action.ctrlKey,
          shiftKey: action.shiftKey,
          altKey: action.altKey,
          metaKey: action.metaKey,
          bubbles: true,
        };
        (el || document).dispatchEvent(new KeyboardEvent('keydown', opts));
        (el || document).dispatchEvent(new KeyboardEvent('keyup', opts));
        break;
      }

      case 'scroll': {
        window.scrollTo({
          left: action.scrollX,
          top: action.scrollY,
          behavior: 'smooth',
        });
        await sleep(300 / speed);
        break;
      }

      case 'submit': {
        const form = await findElement(action);
        if (form && form.tagName === 'FORM') {
          highlightElement(form);
          await sleep(300 / speed);
          form.submit();
        }
        break;
      }

      case 'navigate': {
        window.location.href = action.url;
        break;
      }

      default:
        console.warn(`[OmniFetch Player] Unknown action type: ${action.type}`);
    }
  }

  // ========================================================================
  // PLAYBACK CONTROLLER
  // ========================================================================

  async function playActions(actionList, playbackSpeed) {
    actions = actionList;
    speed = playbackSpeed || 1;
    isPlaying = true;
    currentStep = 0;

    post({ type: 'PLAYER_STARTED', total: actions.length });

    for (let i = 0; i < actions.length; i++) {
      if (!isPlaying) {
        post({ type: 'PLAYER_STOPPED', step: i, total: actions.length, reason: 'user' });
        hideHighlight();
        return;
      }

      currentStep = i;
      const action = actions[i];

      // Apply delay between actions (scaled by speed)
      const delay = Math.max(100, (action.delay || 500) / speed);
      await sleep(delay);

      post({
        type: 'PLAYER_STEP',
        step: i + 1,
        total: actions.length,
        action: action.type,
        selector: action.selector || '',
        text: action.text || action.value || '',
      });

      try {
        await executeAction(action);
      } catch (err) {
        post({
          type: 'PLAYER_ERROR',
          step: i + 1,
          total: actions.length,
          error: err.message,
          action,
        });
        hideHighlight();
        isPlaying = false;
        window.__omnifetchPlayerActive = false;
        return;
      }
    }

    hideHighlight();
    isPlaying = false;
    window.__omnifetchPlayerActive = false;
    post({ type: 'PLAYER_COMPLETED', total: actions.length });
    console.log(`[OmniFetch] ✅ Playback completed (${actions.length} actions)`);
  }

  // ========================================================================
  // CONTROL MESSAGES (from content.js)
  // ========================================================================

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source !== '__OMNIFETCH_PLAYER_CONTROL__') return;

    switch (e.data.command) {
      case 'PLAY':
        playActions(e.data.actions, e.data.speed);
        break;

      case 'STOP':
        isPlaying = false;
        window.__omnifetchPlayerActive = false;
        hideHighlight();
        post({ type: 'PLAYER_STOPPED', step: currentStep, total: actions.length, reason: 'user' });
        break;

      case 'STATUS':
        post({
          type: 'PLAYER_STATUS',
          isPlaying,
          step: currentStep,
          total: actions.length,
        });
        break;
    }
  });

  post({ type: 'PLAYER_READY' });
  console.log('[OmniFetch] ▶ Player loaded');
})();
