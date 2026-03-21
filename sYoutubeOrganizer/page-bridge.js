// MAIN world script - captures yt-navigate-finish and relays to ISOLATED world
(function () {
  'use strict';

  function postNav() {
    window.postMessage({
      type: 'SYO_NAV_EVENT',
      url: window.location.href
    }, '*');
  }

  // Primary: YouTube SPA navigation event
  document.addEventListener('yt-navigate-finish', postNav);

  // Fallback: also listen for yt-page-data-updated (fires on some navigations where yt-navigate-finish doesn't)
  document.addEventListener('yt-page-data-updated', postNav);

  // Ensure initial page load is captured even if yt-navigate-finish fires before content.js is ready.
  // content.js runs at document_idle, so we fire after a short delay to give it time to register.
  // Also fire on load in case document_idle hasn't happened yet.
  window.addEventListener('load', () => setTimeout(postNav, 100));
  if (document.readyState === 'complete') {
    setTimeout(postNav, 100);
  }
})();
