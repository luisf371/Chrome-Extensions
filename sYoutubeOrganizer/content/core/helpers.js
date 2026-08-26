(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const api = app.api;

  api.sleep = function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  api.extractHandleFromUrl = function extractHandleFromUrl(url) {
    // Exclude '#' as well as '/' and '?' so URL fragments (e.g. /@Linus#about)
    // don't leak into the handle and get rejected by normalizeStoredHandle.
    const match = url.match(/\/@([^/?#]+)/);
    if (match) return '@' + match[1];
    const channelMatch = url.match(/\/channel\/([^/?#]+)/);
    if (channelMatch) return channelMatch[1];
    return null;
  };

  api.waitForElement = function waitForElement(selectorOrGetter, timeout = 10000) {
    const getElement = typeof selectorOrGetter === 'function'
      ? selectorOrGetter
      : () => document.querySelector(selectorOrGetter);

    return new Promise((resolve) => {
      const el = getElement();
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const next = getElement();
        if (next) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(next);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  api.clearDocumentCloseListener = function clearDocumentCloseListener(state) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.handler) {
      document.removeEventListener('click', state.handler, true);
      state.handler = null;
    }
  };

  api.armDocumentCloseListener = function armDocumentCloseListener(state, handler) {
    api.clearDocumentCloseListener(state);
    state.handler = handler;
    state.timer = setTimeout(() => {
      if (state.handler !== handler) return;
      document.addEventListener('click', handler, true);
      state.timer = null;
    }, 0);
  };

  api.escapeHtml = function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  api.isVisibleElement = function isVisibleElement(el) {
    return Boolean(
      el &&
      el.isConnected &&
      !el.hasAttribute('hidden') &&
      el.getClientRects().length > 0
    );
  };

  // --- Subscription state ---
  //
  // Detection relies on language-independent DOM signals only: YouTube sets a
  // `subscribed` attribute on the subscribe control. Notification renderers
  // can remain mounted after unsubscribe, so they are not state signals.
  // Button label text is deliberately not matched because it is localized.
  //
  // Live-DOM reality (verified 2026-08, signed out): watch pages still use
  // `#subscribe-button > ytd-subscribe-button-renderer` with a `subscribed`
  // attribute, while modern channel headers render Subscribe as a plain
  // filled `button-view-model` inside `yt-flexible-actions-view-model` (the
  // Join button next to it is NOT filled), with no stable id. Explicit
  // subscribed shapes win, a decisive native Subscribe button means
  // unsubscribed, and every ambiguous host fails closed as unknown.
  const SUBSCRIBED_SIGNAL_SELECTOR = [
    '[subscribed]:not([subscribed="false"])',
    '[subscribe-button-invisible]',
    'yt-notification-request-button-renderer',
    'yt-notification-request-button-view-model',
    'yt-subscription-notification-toggle-button-view-model',
    'yt-flexible-actions-view-model button[class*="IconLeadingTrailing"]',
    'yt-flexible-actions-view-model button[class*="icon-leading-trailing"]'
  ].join(', ');
  const UNSUBSCRIBED_BUTTON_SELECTOR = [
    'ytd-subscribe-button-renderer:not([subscribed]) #subscribe-button-shape button',
    'ytd-subscribe-button-renderer[subscribed="false"] #subscribe-button-shape button',
    'yt-flexible-actions-view-model button[class*="Filled"]',
    'yt-flexible-actions-view-model button[class*="filled"]'
  ].join(', ');

  api.getSubscriptionState = function getSubscriptionState(scope) {
    if (!scope || !scope.isConnected) return 'unknown';

    const hasVisible = (el) => api.isVisibleElement(el);
    // Match the scope itself or any descendant, so callers may pass either
    // the header, the actions container, or a subscribe control directly.
    const matchesOrContains = (selector) => (
      scope.matches(selector) ? [scope] : Array.from(scope.querySelectorAll(selector))
    );

    // Subscribed signals first: they outrank any control-shape heuristic.
    if (matchesOrContains(SUBSCRIBED_SIGNAL_SELECTOR).some(hasVisible)) return 'subscribed';

    // Only a decisive native Subscribe button means unsubscribed. Generic
    // hosts exist in multiple states and must fail closed instead of causing
    // an already-subscribed notification control to be clicked.
    if (matchesOrContains(UNSUBSCRIBED_BUTTON_SELECTOR).some(hasVisible)) {
      return 'unsubscribed';
    }

    return 'unknown';
  };

  // Resolves once the scoped control's state becomes determinable. YouTube
  // hydrates the subscribe control lazily (especially on watch pages, which
  // have no remount observer), so an initial 'unknown' is retried briefly.
  // Resolves 'unknown' on timeout so callers fail closed.
  api.waitForSubscriptionState = function waitForSubscriptionState(
    getScope,
    { gen, intervalMs = 300, timeoutMs = 15000 } = {}
  ) {
    const state = app.state;
    const isStale = () => typeof gen === 'number' && gen !== state.initGeneration;

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (isStale()) return resolve('unknown');
        const scope = typeof getScope === 'function' ? getScope() : null;
        const nextState = api.getSubscriptionState(scope);
        if (nextState !== 'unknown') return resolve(nextState);
        if (Date.now() - startedAt >= timeoutMs) return resolve('unknown');
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  };

  api.triggerSubscribeControl = function triggerSubscribeControl(scope) {
    if (!scope || !scope.isConnected) return false;
    const candidates = scope.matches(UNSUBSCRIBED_BUTTON_SELECTOR)
      ? [scope]
      : Array.from(scope.querySelectorAll(UNSUBSCRIBED_BUTTON_SELECTOR));
    const button = candidates.find(api.isVisibleElement);
    if (!button) return false;
    button.click();
    return true;
  };

  // After an explicit subscribe click, wait for the scoped control to report
  // the target state. A sign-in dialog, rejection, or silent failure all end
  // in a timeout so the caller can revert the optimistic UI. `isStale`
  // aborts immediately when the caller's page context is gone (SPA
  // navigation), so a different channel's control can never be mistaken for
  // confirmation.
  api.awaitSubscriptionState = function awaitSubscriptionState(
    getScope,
    target = 'subscribed',
    { timeoutMs = 8000, intervalMs = 250, isStale } = {}
  ) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        if (typeof isStale === 'function' && isStale()) return resolve(false);
        const scope = typeof getScope === 'function' ? getScope() : null;
        if (api.getSubscriptionState(scope) === target) return resolve(true);
        if (Date.now() - startedAt >= timeoutMs) return resolve(false);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  };
})();
