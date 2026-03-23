(function () {
  'use strict';

  const app = globalThis.__SYP_CONTENT__;
  const api = app.api;

  api.sleep = function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  api.extractHandleFromUrl = function extractHandleFromUrl(url) {
    const match = url.match(/\/@([^/?]+)/);
    if (match) return '@' + match[1];
    const channelMatch = url.match(/\/channel\/([^/?]+)/);
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
})();
