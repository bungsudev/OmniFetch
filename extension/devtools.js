/**
 * DevTools Script
 * Creates the "HTTP Tracker" panel in Chrome DevTools
 */

chrome.devtools.panels.create(
  'HTTP Tracker',   // Panel title
  'icons/icon16.png',  // Icon
  'panel.html',        // Panel page
  (panel) => {
    console.log('[HTTP Tracker Pro] DevTools panel created');
  }
);
