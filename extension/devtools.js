/**
 * DevTools Script
 * Creates the "OmniFetch" panel in Chrome DevTools
 */

chrome.devtools.panels.create(
  'OmniFetch',   // Panel title
  'icons/icon16.png',  // Icon
  'panel.html',        // Panel page
  (panel) => {
    console.log('[OmniFetch] DevTools panel created');
  }
);
