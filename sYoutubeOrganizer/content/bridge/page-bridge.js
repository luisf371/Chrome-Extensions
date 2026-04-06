// MAIN world script - captures yt-navigate-finish and relays to ISOLATED world
(function () {
  'use strict';
  const NAV_EVENT_SOURCE = 'syp-page-bridge';
  const HOME_NAV_INTENT_EVENT = 'SYP_HOME_NAV_INTENT';
  const HOME_REDIRECT_BYPASS_SESSION_KEY = 'syp-manual-home-nav';

  function postBridgeMessage(type) {
    window.postMessage({
      type,
      source: NAV_EVENT_SOURCE,
      url: window.location.href
    }, '*');
  }

  function postNav() {
    postBridgeMessage('SYP_NAV_EVENT');
  }

  function isManualHomeLink(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;

    try {
      const url = new URL(anchor.href, window.location.href);
      return url.origin === window.location.origin && url.pathname === '/' && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  function getManualHomeLink(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const node of path) {
      if (node instanceof HTMLAnchorElement && isManualHomeLink(node)) {
        return node;
      }
      if (node instanceof Element) {
        const anchor = node.closest('a[href]');
        if (isManualHomeLink(anchor)) {
          return anchor;
        }
      }
    }
    return null;
  }

  function markManualHomeIntent() {
    try {
      window.sessionStorage.setItem(HOME_REDIRECT_BYPASS_SESSION_KEY, String(Date.now()));
    } catch {}
    postBridgeMessage(HOME_NAV_INTENT_EVENT);
  }

  function onManualHomeClick(event) {
    if (
      !event.isTrusted ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const anchor = getManualHomeLink(event);
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
      return;
    }

    markManualHomeIntent();
  }

  // Primary: YouTube SPA navigation event
  document.addEventListener('yt-navigate-finish', postNav);

  // Fallback: also listen for yt-page-data-updated (fires on some navigations where yt-navigate-finish doesn't)
  document.addEventListener('yt-page-data-updated', postNav);

  // Ensure initial page load is captured even if yt-navigate-finish fires before content.js is ready.
  // content.js runs at document_idle, so we fire after a short delay to give it time to register.
  // Also fire on load in case document_idle hasn't happened yet.
  document.addEventListener('click', onManualHomeClick, true);
  window.addEventListener('load', () => setTimeout(postNav, 100));
  if (document.readyState === 'complete') {
    setTimeout(postNav, 100);
  }
})();
